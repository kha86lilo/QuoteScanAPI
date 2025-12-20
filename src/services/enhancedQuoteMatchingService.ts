/**
 * Enhanced Quote Matching Service
 * Domain-aware matching algorithm for shipping and transportation quotes
 */

import * as db from '../config/db.js';
import type { QuoteFeedbackData } from '../config/db.js';
import { getAIService } from './ai/aiServiceFactory.js';
import { calculateQuoteDistance, type RouteDistance } from './googleMapsService.js';
import { getPromptForTask } from '../prompts/shippingQuotePrompts.js';
import type {
  Quote,
  QuoteMatch,
  MatchCriteria,
  MatchResult,
  MatchDetail,
  AIPricingDetails,
  WeightRange,
  LanePricingStats,
  SmartPricing,
  PriceRange,
  MatchMetadata,
} from '../types/index.js';
import trailerConfigsData from '../config/trailerConfigs.json' with { type: 'json' };

// Trailer configuration types
interface TrailerConfig {
  id: string;
  name: string;
  category: string;
  deckLength: number;  // feet
  deckWidth: number;   // feet
  deckHeight: number;  // feet (deck height from ground)
  maxCargoHeight: number;  // feet (max cargo height that fits)
  maxWeight: number;   // lbs
  bestFor: string[];
}

interface LegalLimits {
  maxHeight: number;   // feet (total height including trailer)
  maxWidth: number;    // feet
  maxLength: number;   // feet
  maxWeight: number;   // lbs (total gross weight)
  units: {
    dimensions: string;
    weight: string;
  };
}

interface TrailerConfigsFile {
  trailerConfigs: TrailerConfig[];
  legalLimits: LegalLimits;
}

// Load trailer configurations
const trailerConfigs: TrailerConfigsFile = trailerConfigsData as TrailerConfigsFile;
const TRAILER_CONFIGS = trailerConfigs.trailerConfigs;
const LEGAL_LIMITS = trailerConfigs.legalLimits;

// Service Type Normalization
const SERVICE_TYPE_MAPPING: Record<string, string> = {
  'ground': 'GROUND', 'ftl': 'GROUND', 'ltl': 'GROUND', 'trucking': 'GROUND',
  'flatbed': 'GROUND', 'dry van': 'GROUND',
  'drayage': 'DRAYAGE', 'port drayage': 'DRAYAGE', 'rail drayage': 'DRAYAGE',
  'container drayage': 'DRAYAGE', 'container pickup': 'DRAYAGE', 'container delivery': 'DRAYAGE',
  'port pickup': 'DRAYAGE', 'pier pickup': 'DRAYAGE', 'terminal': 'DRAYAGE',
  'ocean': 'OCEAN', 'sea freight': 'OCEAN', 'fcl': 'OCEAN', 'lcl': 'OCEAN',
  'roro': 'OCEAN', 'ro-ro': 'OCEAN', 'breakbulk': 'OCEAN',
  'intermodal': 'INTERMODAL', 'multimodal': 'INTERMODAL',
  'transloading': 'TRANSLOAD', 'transload': 'TRANSLOAD', 'cross-dock': 'TRANSLOAD',
  'devanning': 'TRANSLOAD', 'stripping': 'TRANSLOAD', 'stuffing': 'TRANSLOAD',
  'container loading': 'TRANSLOAD',
  'air': 'AIR', 'air freight': 'AIR',
  'storage': 'STORAGE', 'warehousing': 'STORAGE', 'warehouse': 'STORAGE',
};

// Service compatibility - be strict to avoid mixing different pricing models
const SERVICE_COMPATIBILITY: Record<string, string[]> = {
  'GROUND': ['GROUND', 'DRAYAGE'],  // Ground can match drayage (both trucking-based)
  'DRAYAGE': ['DRAYAGE', 'GROUND'],  // Drayage can match ground
  'OCEAN': ['OCEAN'],  // STRICT: Ocean only matches ocean (pricing is very different)
  'INTERMODAL': ['INTERMODAL', 'OCEAN'],  // Intermodal can match ocean or itself
  'TRANSLOAD': ['TRANSLOAD', 'DRAYAGE'],
  'AIR': ['AIR'],
  'STORAGE': ['STORAGE'],
};

/**
 * CRITICAL: Correct service type based on route distance
 * Ocean freight can't have 5-mile routes - that's clearly drayage
 */
function correctServiceTypeByDistance(
  serviceType: string,
  distanceMiles: number | null | undefined,
  logCorrection: boolean = false,
  cargoDescription?: string | null
): string {
  if (!distanceMiles || distanceMiles <= 0) return serviceType;
  
  const normalized = serviceType.toUpperCase();
  const cargoLower = String(cargoDescription ?? '').toLowerCase();
  const oversizeOrEquipmentLikely = /\b(oversize(?:d)?|over\s*size|overweight|over\s*weight|heavy\s*haul|oog|out\s*of\s*gauge|low\s*boy|lowboy|step\s*deck|stepdeck|flat\s*bed|flatbed|excavator|backhoe|bulldozer|dozer|crane|forklift|skid\s*steer|compactor|caterpillar|\bcat\b|komatsu|daewoo|hamm|press\s*brake|transformer|generator)\b/i.test(cargoLower);
  
  // If labeled Ocean/Intermodal but route is under 150 miles, it's actually drayage/ground
  // Real ocean routes are typically 500+ miles minimum (coastal to inland or trans-oceanic)
  if ((normalized === 'OCEAN' || normalized === 'INTERMODAL') && distanceMiles < 150) {
    // Oversize/heavy equipment short-haul behaves like specialized ground (not typical container drayage).
    if (oversizeOrEquipmentLikely) {
      if (logCorrection) console.log(`    Service type correction: ${serviceType} -> GROUND (oversize/equipment on short route: ${distanceMiles} miles)`);
      return 'GROUND';
    }
    if (logCorrection) console.log(`    Service type correction: ${serviceType} -> DRAYAGE (distance: ${distanceMiles} miles too short for ocean)`);
    return 'DRAYAGE';
  }
  
  // If labeled Ocean but route is under 300 miles, likely intermodal at best
  if (normalized === 'OCEAN' && distanceMiles < 300) {
    if (logCorrection) console.log(`    Service type correction: ${serviceType} -> INTERMODAL (distance: ${distanceMiles} miles)`);
    return 'INTERMODAL';
  }
  
  return serviceType;
}

// Geographic Regions
const US_REGIONS: Record<string, string[]> = {
  'NORTHEAST': ['new york', 'newark', 'boston', 'philadelphia', 'baltimore', 'ny', 'nj', 'pa', 'ma', 'ct', 'ri', 'nh', 'vt', 'me'],
  'SOUTHEAST': ['savannah', 'charleston', 'jacksonville', 'miami', 'tampa', 'atlanta', 'ga', 'fl', 'sc', 'nc', 'va'],
  'GULF': ['houston', 'new orleans', 'mobile', 'galveston', 'beaumont', 'tx', 'la', 'al', 'ms'],
  'WEST_COAST': ['los angeles', 'long beach', 'oakland', 'seattle', 'tacoma', 'portland', 'san francisco', 'san diego', 'ca', 'wa', 'or'],
  'MIDWEST': ['chicago', 'detroit', 'cleveland', 'cincinnati', 'st. louis', 'milwaukee', 'minneapolis', 'indianapolis', 'columbus', 'waukesha', 'il', 'oh', 'mi', 'in', 'wi', 'mn', 'ia', 'mo'],
  'CENTRAL': ['dallas', 'kansas city', 'denver', 'memphis', 'nashville', 'oklahoma', 'tulsa', 'omaha', 'tn', 'ks', 'co', 'ok', 'ne', 'ar'],
};

const INTL_REGIONS: Record<string, string[]> = {
  'ASIA_PACIFIC': ['china', 'japan', 'korea', 'taiwan', 'vietnam', 'thailand', 'singapore', 'malaysia', 'indonesia', 'philippines', 'india', 'bangladesh'],
  'EUROPE': ['germany', 'france', 'uk', 'united kingdom', 'spain', 'italy', 'netherlands', 'belgium', 'poland'],
  'MIDDLE_EAST': ['uae', 'saudi arabia', 'qatar', 'jordan', 'israel', 'turkey', 'egypt'],
  'LATIN_AMERICA': ['mexico', 'brazil', 'colombia', 'chile', 'peru', 'argentina', 'panama', 'costa rica', 'guatemala'],
  'AFRICA': ['south africa', 'morocco', 'nigeria', 'kenya', 'ghana', 'tanzania'],
  'CANADA': ['canada', 'ontario', 'quebec', 'british columbia', 'alberta'],
};

// Cargo Categories
const CARGO_CATEGORIES: Record<string, string[]> = {
  'MACHINERY': ['machine', 'equipment', 'excavator', 'loader', 'dozer', 'crane', 'forklift', 'tractor', 'generator', 'compressor', 'jlg', 'caterpillar', 'cat', 'komatsu', 'jcb', 'bobcat', 'hitachi', 'volvo', 'deere', 'heat exchanger'],
  'VEHICLES': ['vehicle', 'car', 'truck', 'bus', 'trailer', 'automobile', 'auto', 'suv', 'van'],
  'CONTAINERS': ['container', '20ft', '40ft', "20'", "40'", 'high cube', 'hc', 'soc', 'coc', 'flat rack', 'open top'],
  'INDUSTRIAL': ['steel', 'metal', 'pipe', 'coil', 'beam', 'plate', 'iron', 'aluminum'],
  'AGRICULTURAL': ['grain', 'feed', 'fertilizer', 'seed', 'agricultural', 'farm'],
  'OVERSIZED': ['overweight', 'overdimensional', 'heavy haul', 'project cargo', 'breakbulk', 'oog', 'out of gauge'],
  'HAZMAT': ['hazardous', 'dangerous', 'chemical', 'flammable', 'corrosive', 'explosive'],
  'GENERAL': ['general cargo', 'pallets', 'boxes', 'cartons', 'freight'],
};

// Enhanced Weights - BALANCED configuration for price accuracy
// Key changes from cargo-focused weights (which regressed to 17%):
// 1. Distance is a major price driver - can't ignore it
// 2. Service type is critical - different pricing models
// 3. Cargo category matters but not as much when we have good distance data
// 4. Recency helps but don't overprioritize
// 5. Piece count increased for LTL/partial loads
// 6. Equipment type added for specialized cargo
const ENHANCED_WEIGHTS: Record<string, number> = {
  origin_region: 0.07,
  origin_city: 0.04,
  destination_region: 0.09,
  destination_city: 0.04,
  cargo_category: 0.11,
  cargo_weight_range: 0.08,
  cargo_weight_actual: 0.04,  // NEW: actual weight comparison
  number_of_pieces: 0.05,     // INCREASED from 0.03
  service_type: 0.13,
  service_compatibility: 0.04,
  hazmat: 0.06,
  container_type: 0.04,
  equipment_type: 0.04,       // NEW: equipment matching
  recency: 0.05,
  distance_similarity: 0.18,
};

// =============================================================================
// FALLBACK PRICING SYSTEM - Used when no historical matches are found
// =============================================================================

/**
 * Base rates per mile by service type (USD)
 * These are industry-average rates used as fallback when no matches exist
 * Updated periodically based on market conditions
 */
const BASE_RATES_PER_MILE: Record<string, { min: number; avg: number; max: number }> = {
  'GROUND': { min: 2.50, avg: 3.25, max: 4.50 },      // FTL dry van
  'DRAYAGE': { min: 3.50, avg: 5.00, max: 8.00 },     // Port drayage (higher due to fees)
  'OCEAN': { min: 0.15, avg: 0.25, max: 0.40 },       // Ocean per mile equivalent (long distance)
  'INTERMODAL': { min: 1.80, avg: 2.40, max: 3.20 },  // Rail + truck combo
  'AIR': { min: 8.00, avg: 12.00, max: 20.00 },       // Air freight premium
  'TRANSLOAD': { min: 3.00, avg: 4.50, max: 6.50 },   // Cross-dock operations
  'UNKNOWN': { min: 2.80, avg: 3.50, max: 5.00 },     // Default fallback
};

/**
 * Minimum charges by service type (USD)
 * Applied when distance-based calculation falls below these thresholds
 */
const MINIMUM_CHARGES: Record<string, number> = {
  'GROUND': 350,
  'DRAYAGE': 450,      // Port fees, chassis, etc.
  'OCEAN': 800,        // Minimum ocean booking
  'INTERMODAL': 600,
  'AIR': 500,
  'TRANSLOAD': 400,
  'STORAGE': 150,
  'UNKNOWN': 400,
};

/**
 * Regional rate multipliers - some regions are more expensive
 */
const REGIONAL_MULTIPLIERS: Record<string, number> = {
  'WEST_COAST': 1.15,    // Higher costs in CA, WA, OR
  'NORTHEAST': 1.10,     // Dense traffic, tolls
  'SOUTHEAST': 0.95,     // Generally lower costs
  'GULF': 1.00,          // Baseline
  'MIDWEST': 0.95,       // Lower costs
  'CENTRAL': 0.95,
  'ASIA_PACIFIC': 1.05,  // International premium
  'EUROPE': 1.10,
  'CANADA': 1.08,        // Cross-border fees
  'OTHER': 1.00,
};

/**
 * Cargo category multipliers for specialized handling
 */
const CARGO_MULTIPLIERS: Record<string, number> = {
  'MACHINERY': 1.35,     // Heavy equipment requires specialized trailers
  'VEHICLES': 1.20,      // Vehicle transport premium
  'OVERSIZED': 1.60,     // Permits, escorts, special equipment
  'HAZMAT': 1.45,        // Hazmat certification, insurance, placards
  'INDUSTRIAL': 1.15,    // Steel, coils - heavy but standard
  'CONTAINERS': 1.00,    // Standard container rates
  'AGRICULTURAL': 0.90,  // Often bulk, simpler handling
  'GENERAL': 1.00,       // Baseline
  'UNKNOWN': 1.05,       // Small premium for uncertainty
};

/**
 * Weight-based surcharges (per 1000 lbs over standard)
 */
const WEIGHT_SURCHARGES: Record<string, number> = {
  'LIGHT': 0,
  'MEDIUM': 0,
  'HEAVY': 50,           // $50 per 1000 lbs
  'VERY_HEAVY': 100,     // $100 per 1000 lbs
  'PROJECT': 200,        // $200 per 1000 lbs - requires permits
};

/**
 * Equipment type base rates and multipliers
 */
const EQUIPMENT_RATES: Record<string, { baseRate: number; multiplier: number }> = {
  'DRY_VAN': { baseRate: 0, multiplier: 1.0 },
  'FLATBED': { baseRate: 150, multiplier: 1.20 },
  'STEP_DECK': { baseRate: 200, multiplier: 1.30 },
  'LOWBOY': { baseRate: 400, multiplier: 1.50 },
  'REEFER': { baseRate: 300, multiplier: 1.35 },
  'TANKER': { baseRate: 250, multiplier: 1.25 },
  'CONESTOGA': { baseRate: 200, multiplier: 1.25 },
  'POWER_ONLY': { baseRate: -100, multiplier: 0.85 },
  'HOTSHOT': { baseRate: 100, multiplier: 1.15 },
};

/**
 * Detect equipment type from cargo description and service type
 */
function detectEquipmentType(
  cargoDescription: string | null | undefined,
  serviceType: string | null | undefined,
  equipmentRequested: string | null | undefined
): string {
  // First check explicit equipment request
  if (equipmentRequested) {
    const lower = equipmentRequested.toLowerCase();
    if (lower.includes('flatbed') || lower.includes('flat bed')) return 'FLATBED';
    if (lower.includes('step') || lower.includes('drop deck')) return 'STEP_DECK';
    if (lower.includes('lowboy') || lower.includes('low boy') || lower.includes('rgn')) return 'LOWBOY';
    if (lower.includes('reefer') || lower.includes('refrigerat')) return 'REEFER';
    if (lower.includes('tanker') || lower.includes('tank')) return 'TANKER';
    if (lower.includes('conestoga') || lower.includes('curtain')) return 'CONESTOGA';
    if (lower.includes('power only') || lower.includes('tow away')) return 'POWER_ONLY';
    if (lower.includes('hotshot') || lower.includes('expedite')) return 'HOTSHOT';
    if (lower.includes('dry van') || lower.includes('van')) return 'DRY_VAN';
  }

  // Infer from cargo description
  const cargo = (cargoDescription || '').toLowerCase();
  if (cargo.includes('excavator') || cargo.includes('dozer') || cargo.includes('crane') ||
      cargo.includes('lowboy') || cargo.includes('heavy equipment')) return 'LOWBOY';
  if (cargo.includes('flatbed') || cargo.includes('steel') || cargo.includes('lumber') ||
      cargo.includes('pipe') || cargo.includes('beam')) return 'FLATBED';
  if (cargo.includes('refrigerat') || cargo.includes('frozen') || cargo.includes('cold') ||
      cargo.includes('produce') || cargo.includes('perishable')) return 'REEFER';
  if (cargo.includes('chemical') || cargo.includes('liquid') || cargo.includes('fuel')) return 'TANKER';
  if (cargo.includes('oversize') || cargo.includes('over dimension')) return 'STEP_DECK';

  return 'DRY_VAN';
}

interface FallbackPricingResult {
  price: number;
  priceRange: PriceRange;
  /** Confidence as a percentage (0-100) */
  confidence_percentage: number;
  reasoning: string;
  breakdown: {
    baseRate: number;
    distanceCharge: number;
    minimumApplied: boolean;
    regionalMultiplier: number;
    cargoMultiplier: number;
    weightSurcharge: number;
    equipmentCharge: number;
    hazmatSurcharge: number;
  };
}

/**
 * Calculate fallback pricing when no historical matches are found
 * Uses industry-standard rates adjusted for service type, region, cargo, and equipment
 */
function calculateFallbackPricing(
  quote: Quote,
  distanceMiles: number | null | undefined
): FallbackPricingResult {
  const serviceType = normalizeServiceType(quote.service_type);
  const cargoCategory = classifyCargo(quote.cargo_description);
  const weightRange = getWeightRange(quote.cargo_weight, quote.weight_unit);
  const equipmentType = detectEquipmentType(
    quote.cargo_description,
    quote.service_type,
    quote.equipment_type_requested
  );

  // Get base rates for service type
  const rates = BASE_RATES_PER_MILE[serviceType] || BASE_RATES_PER_MILE['UNKNOWN']!;
  const minCharge = MINIMUM_CHARGES[serviceType] || MINIMUM_CHARGES['UNKNOWN']!;

  // Calculate regional multiplier
  const originRegion = getUSRegion(quote.origin_city, quote.origin_state_province) ||
                       getIntlRegion(quote.origin_country) || 'OTHER';
  const destRegion = getUSRegion(quote.destination_city, quote.destination_state_province) ||
                     getIntlRegion(quote.destination_country) || 'OTHER';
  const originMult = REGIONAL_MULTIPLIERS[originRegion] || 1.0;
  const destMult = REGIONAL_MULTIPLIERS[destRegion] || 1.0;
  const regionalMultiplier = (originMult + destMult) / 2;

  // Cargo multiplier
  const cargoMultiplier = CARGO_MULTIPLIERS[cargoCategory] || 1.0;

  // Weight surcharge
  const weightLabel = weightRange?.label || 'MEDIUM';
  const weightSurchargePerK = WEIGHT_SURCHARGES[weightLabel] || 0;
  const weightKg = parseFloat(String(quote.cargo_weight || 0));
  const weightLbs = weightKg * 2.20462;
  const weightSurcharge = Math.max(0, (weightLbs - 5000) / 1000) * weightSurchargePerK;

  // Equipment charges
  const equipmentInfo = EQUIPMENT_RATES[equipmentType] || EQUIPMENT_RATES['DRY_VAN']!;
  const equipmentCharge = equipmentInfo.baseRate;
  const equipmentMultiplier = equipmentInfo.multiplier;

  // Hazmat surcharge
  const hazmatSurcharge = quote.hazardous_material ? 350 : 0;

  // Calculate distance-based charge
  const effectiveDistance = distanceMiles || 200; // Default 200 miles if unknown
  const baseDistanceCharge = effectiveDistance * rates.avg;

  // Apply all multipliers
  let totalPrice = baseDistanceCharge * regionalMultiplier * cargoMultiplier * equipmentMultiplier;
  totalPrice += weightSurcharge + equipmentCharge + hazmatSurcharge;

  // Apply minimum charge
  const minimumApplied = totalPrice < minCharge;
  totalPrice = Math.max(totalPrice, minCharge);

  // Calculate price range
  const lowPrice = Math.max(
    minCharge,
    effectiveDistance * rates.min * regionalMultiplier * cargoMultiplier * 0.9
  );
  const highPrice = effectiveDistance * rates.max * regionalMultiplier * cargoMultiplier * 1.15 +
                    weightSurcharge + equipmentCharge + hazmatSurcharge;

  // Round to nearest $25
  const roundedPrice = Math.round(totalPrice / 25) * 25;
  const roundedLow = Math.round(lowPrice / 25) * 25;
  const roundedHigh = Math.round(highPrice / 25) * 25;

  // Build reasoning
  const reasoningParts: string[] = [
    `Fallback pricing (no historical matches)`,
    `Service: ${serviceType}`,
    `Distance: ${effectiveDistance.toFixed(0)} mi`,
    `Base rate: $${rates.avg.toFixed(2)}/mi`,
  ];
  if (regionalMultiplier !== 1.0) {
    reasoningParts.push(`Regional adj: ${((regionalMultiplier - 1) * 100).toFixed(0)}%`);
  }
  if (cargoMultiplier !== 1.0) {
    reasoningParts.push(`Cargo (${cargoCategory}): ${((cargoMultiplier - 1) * 100).toFixed(0)}%`);
  }
  if (equipmentType !== 'DRY_VAN') {
    reasoningParts.push(`Equipment (${equipmentType}): +$${equipmentCharge}`);
  }
  if (hazmatSurcharge > 0) {
    reasoningParts.push(`Hazmat: +$${hazmatSurcharge}`);
  }

  return {
    price: roundedPrice,
    priceRange: { low: roundedLow, high: roundedHigh },
    confidence_percentage: distanceMiles ? 35 : 25, // LOW = 35%, VERY_LOW = 25%
    reasoning: reasoningParts.join('. '),
    breakdown: {
      baseRate: rates.avg,
      distanceCharge: baseDistanceCharge,
      minimumApplied,
      regionalMultiplier,
      cargoMultiplier,
      weightSurcharge,
      equipmentCharge,
      hazmatSurcharge,
    },
  };
}

const WEIGHT_RANGES: WeightRange[] = [
  { min: 0, max: 500, label: 'LIGHT', multiplier: 1.0 },
  { min: 500, max: 2000, label: 'MEDIUM', multiplier: 0.95 },
  { min: 2000, max: 10000, label: 'HEAVY', multiplier: 0.90 },
  { min: 10000, max: 25000, label: 'VERY_HEAVY', multiplier: 0.85 },
  { min: 25000, max: Infinity, label: 'PROJECT', multiplier: 0.80 },
];

// Helper Functions
function normalizeServiceType(serviceType: string | null | undefined): string {
  if (!serviceType) return 'UNKNOWN';

  const lower = serviceType.toLowerCase();
  const parts = lower.split(/[\/,;+&]+/).map(s => s.trim());
  const normalized: string[] = [];

  for (const part of parts) {
    for (const [pattern, category] of Object.entries(SERVICE_TYPE_MAPPING)) {
      if (part.includes(pattern)) {
        if (!normalized.includes(category)) {
          normalized.push(category);
        }
        break;
      }
    }
  }

  if (normalized.length === 0) return 'UNKNOWN';
  if (normalized.length === 1) return normalized[0] || 'UNKNOWN';

  if (normalized.includes('OCEAN') && (normalized.includes('GROUND') || normalized.includes('DRAYAGE'))) {
    return 'INTERMODAL';
  }
  if (normalized.includes('GROUND') && normalized.includes('DRAYAGE')) {
    return 'GROUND';
  }

  return normalized[0] || 'UNKNOWN';
}

function getUSRegion(city: string | null | undefined, state: string | null | undefined): string | null {
  if (!city && !state) return null;

  const cityLower = (city || '').toLowerCase();
  const stateLower = (state || '').toLowerCase();

  for (const [region, keywords] of Object.entries(US_REGIONS)) {
    if (keywords.some(k => k.length > 2 && cityLower.includes(k))) {
      return region;
    }
  }

  for (const [region, keywords] of Object.entries(US_REGIONS)) {
    if (keywords.some(k => k.length === 2 && stateLower === k)) {
      return region;
    }
  }

  return 'OTHER_US';
}

function getIntlRegion(country: string | null | undefined): string | null {
  if (!country) return null;

  const lower = country.toLowerCase();

  if (lower === 'usa' || lower === 'united states' || lower === 'us') {
    return 'USA';
  }

  for (const [region, countries] of Object.entries(INTL_REGIONS)) {
    if (countries.some(c => lower.includes(c))) {
      return region;
    }
  }
  return 'OTHER';
}

function classifyCargo(description: string | null | undefined): string {
  if (!description) return 'UNKNOWN';

  const lower = description.toLowerCase();

  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const containsKeyword = (haystack: string, keyword: string): boolean => {
    const k = keyword.toLowerCase().trim();
    if (!k) return false;

    // If keyword includes punctuation that breaks \b semantics (e.g., 40', 20ft), fall back to substring.
    if (/[^a-z0-9\s-]/i.test(k)) {
      return haystack.includes(k);
    }

    const parts = k.split(/\s+/).filter(Boolean);

    // Allow pluralization on the last word (e.g., "heat exchanger" -> "heat exchangers").
    // Keep this conservative to avoid reintroducing substring false positives.
    const withOptionalPlural = (word: string): string => {
      const safe = escapeRegExp(word);
      if (word.length <= 4) return safe;
      if (word.endsWith('s')) return safe;
      if (!/^[a-z0-9-]+$/i.test(word)) return safe;
      return `${safe}s?`;
    };

    // Build a word-boundary-aware regex; allow flexible whitespace or hyphen separators for phrases.
    // Examples matched:
    // - "heat exchanger" / "heat exchangers" / "heat-exchanger" / "heat-exchangers"
    if (parts.length > 1) {
      const last = parts[parts.length - 1] || '';
      const partPatterns = parts.map((p, idx) => (idx === parts.length - 1 ? withOptionalPlural(p) : escapeRegExp(p)));
      const phrasePattern = partPatterns.join('(?:[\\s-]+)');
      const pattern = `\\b${phrasePattern}\\b`;
      return new RegExp(pattern, 'i').test(haystack);
    }

    const single = parts[0] || '';
    const pattern = `\\b${withOptionalPlural(single)}\\b`;
    return new RegExp(pattern, 'i').test(haystack);
  };

  for (const [category, keywords] of Object.entries(CARGO_CATEGORIES)) {
    if (keywords.some(k => containsKeyword(lower, k))) {
      return category;
    }
  }
  return 'GENERAL';
}

function getWeightRange(weight: number | string | null | undefined, unit: string | null | undefined): WeightRange | null {
  if (!weight) return null;

  let weightKg = parseFloat(String(weight));
  if (isNaN(weightKg)) return null;

  const lowerUnit = (unit || 'kg').toLowerCase();
  if (lowerUnit.includes('lb') || lowerUnit.includes('pound')) {
    weightKg = weightKg * 0.453592;
  } else if (lowerUnit.includes('ton') || lowerUnit === 't') {
    weightKg = weightKg * 1000;
  }

  for (const range of WEIGHT_RANGES) {
    if (weightKg >= range.min && weightKg < range.max) {
      return range;
    }
  }
  return WEIGHT_RANGES[WEIGHT_RANGES.length - 1] || null;
}

function detectContainerType(description: string | null | undefined, serviceType: string | null | undefined): string | null {
  if (!description && !serviceType) return null;

  const text = `${description || ''} ${serviceType || ''}`.toLowerCase();

  // Check reefer first (before flat rack, since "refrigerated" contains "fr")
  if (text.includes('reefer') || text.includes('refrigerated')) return 'REEFER';
  // Flat rack - use word boundary to avoid matching "freight", "free", etc.
  if (text.includes('flat rack') || text.includes('flatrack') || text.match(/\bfr\b/)) return 'FLAT_RACK';
  // Enhanced OOG/Open Top detection - learned from quote 10726 feedback: "40 OT (OOG)" should be OPEN_TOP
  if (text.includes('open top') || text.includes('open-top') || text.match(/\b40\s*ot\b/) || text.match(/\boog\b/) ||
      text.includes('out of gauge') || text.match(/\bot\b.*container/) ||
      text.includes('top loaded') || text.includes('top-loaded')) return 'OPEN_TOP';
  if (text.includes('40') && text.includes('hc')) return '40HC';
  if (text.includes('40')) return '40STD';
  if (text.includes('20')) return '20STD';
  if (text.includes('roro') || text.includes('ro-ro')) return 'RORO';

  return null;
}

// OOG/Specialty container pricing multipliers based on feedback learning
// Updated based on feedback from quote 10726: OOG cargo priced 40% higher than standard
const CONTAINER_PRICING_MULTIPLIERS: Record<string, number> = {
  'OPEN_TOP': 1.40,      // +35-45% premium - learned from quote 10726 feedback ($2750 -> $3850)
  'FLAT_RACK': 1.75,     // +50-100% premium
  'REEFER': 1.40,        // +30-50% premium
  '40HC': 1.05,          // Small premium for high cube
  '40STD': 1.00,
  '20STD': 1.00,
  'RORO': 1.20,          // +15-25% premium
};

/**
 * Convert dimension value to feet, handling various units
 * Default assumes inches if no unit specified and value > 20
 */
function convertToFeet(value: number | string | null | undefined, unit?: string | null): number | null {
  if (value === null || value === undefined) return null;
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue) || numValue <= 0) return null;

  const normalizedUnit = (unit || '').toLowerCase().trim();

  // If unit is specified, use it
  if (normalizedUnit.includes('ft') || normalizedUnit.includes('feet') || normalizedUnit === "'") {
    return numValue;
  }
  if (normalizedUnit.includes('in') || normalizedUnit === '"') {
    return numValue / 12;
  }
  if (normalizedUnit.includes('m') && !normalizedUnit.includes('mm')) {
    return numValue * 3.28084; // meters to feet
  }
  if (normalizedUnit.includes('cm')) {
    return numValue / 30.48; // cm to feet
  }
  if (normalizedUnit.includes('mm')) {
    return numValue / 304.8; // mm to feet
  }

  // No unit specified - heuristic: if > 20, assume inches; otherwise assume feet
  // (Most cargo in feet would be < 20ft, most in inches would be > 20in)
  if (numValue > 20) {
    return numValue / 12; // Assume inches
  }
  return numValue; // Assume feet
}

/**
 * Convert weight value to pounds, handling various units
 */
function convertToLbs(value: number | string | null | undefined, unit?: string | null): number | null {
  if (value === null || value === undefined) return null;
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue) || numValue <= 0) return null;

  const normalizedUnit = (unit || '').toLowerCase().trim();

  if (normalizedUnit.includes('lb') || normalizedUnit.includes('pound')) {
    return numValue;
  }
  if (normalizedUnit.includes('kg') || normalizedUnit.includes('kilo')) {
    return numValue * 2.20462;
  }
  if (normalizedUnit.includes('ton') && !normalizedUnit.includes('metric')) {
    return numValue * 2000; // US tons
  }
  if (normalizedUnit.includes('metric') || normalizedUnit === 't' || normalizedUnit === 'mt') {
    return numValue * 2204.62; // Metric tons
  }

  // No unit - heuristic: if < 100, likely tons; if < 5000, likely kg; otherwise lbs
  if (numValue < 100) {
    return numValue * 2000; // Assume tons
  }
  if (numValue < 5000) {
    return numValue * 2.20462; // Assume kg
  }
  return numValue; // Assume lbs
}

interface TrailerSuggestion {
  trailer: TrailerConfig;
  fitScore: number;  // Higher is better fit (0-100)
  reasons: string[];
  warnings: string[];
}

interface OOGAnalysis {
  isOOG: boolean;
  exceedsLegalHeight: boolean;
  exceedsLegalWidth: boolean;
  exceedsLegalLength: boolean;
  exceedsLegalWeight: boolean;
  requiresPermits: boolean;
  requiresPilotCar: boolean;
  cargoHeightFt: number | null;
  cargoWidthFt: number | null;
  cargoLengthFt: number | null;
  cargoWeightLbs: number | null;
  reasons: string[];
}

/**
 * Analyze cargo dimensions against legal limits and trailer capabilities
 * Uses trailer configs to determine if cargo is Out of Gauge (OOG)
 */
function analyzeOOGCargo(
  description: string | null | undefined,
  height: number | string | null | undefined,
  width: number | string | null | undefined,
  length: number | string | null | undefined,
  weight: number | string | null | undefined,
  dimensionUnit?: string | null,
  weightUnit?: string | null
): OOGAnalysis {
  const result: OOGAnalysis = {
    isOOG: false,
    exceedsLegalHeight: false,
    exceedsLegalWidth: false,
    exceedsLegalLength: false,
    exceedsLegalWeight: false,
    requiresPermits: false,
    requiresPilotCar: false,
    cargoHeightFt: convertToFeet(height, dimensionUnit),
    cargoWidthFt: convertToFeet(width, dimensionUnit),
    cargoLengthFt: convertToFeet(length, dimensionUnit),
    cargoWeightLbs: convertToLbs(weight, weightUnit),
    reasons: []
  };

  const text = (description || '').toLowerCase();

  // Check description for OOG indicators
  if (text.match(/\boog\b/) || text.includes('out of gauge') || text.includes('oversized') ||
      text.includes('overdimensional') || text.includes('overheight') || text.includes('overwidth') ||
      text.match(/\b40\s*ot\b/) || text.includes('open top') || text.includes('open-top') ||
      text.includes('top loaded') || text.includes('top-loaded')) {
    result.isOOG = true;
    result.reasons.push('Description indicates OOG cargo');
  }

  // Check against legal limits from trailer configs
  // Note: Legal max height (13.5ft) includes trailer deck height, so cargo max varies by trailer
  if (result.cargoHeightFt !== null) {
    // Find the lowest deck trailer (lowboy at 1.5ft) to get max possible cargo height
    const maxPossibleCargoHeight = LEGAL_LIMITS.maxHeight - 1.5; // ~12ft with lowboy
    if (result.cargoHeightFt > maxPossibleCargoHeight) {
      result.exceedsLegalHeight = true;
      result.isOOG = true;
      result.requiresPermits = true;
      result.reasons.push(`Height ${result.cargoHeightFt.toFixed(1)}ft exceeds legal limit even with lowest trailer`);
    } else if (result.cargoHeightFt > 8.5) {
      // Standard flatbed max cargo height - may need special trailer
      result.isOOG = true;
      result.reasons.push(`Height ${result.cargoHeightFt.toFixed(1)}ft requires low-deck trailer`);
    }
  }

  if (result.cargoWidthFt !== null && result.cargoWidthFt > LEGAL_LIMITS.maxWidth) {
    result.exceedsLegalWidth = true;
    result.isOOG = true;
    result.requiresPermits = true;
    if (result.cargoWidthFt > 12) {
      result.requiresPilotCar = true;
      result.reasons.push(`Width ${result.cargoWidthFt.toFixed(1)}ft exceeds 12ft, requires pilot car`);
    } else {
      result.reasons.push(`Width ${result.cargoWidthFt.toFixed(1)}ft exceeds legal limit ${LEGAL_LIMITS.maxWidth}ft`);
    }
  }

  if (result.cargoLengthFt !== null && result.cargoLengthFt > LEGAL_LIMITS.maxLength) {
    result.exceedsLegalLength = true;
    result.isOOG = true;
    result.requiresPermits = true;
    result.reasons.push(`Length ${result.cargoLengthFt.toFixed(1)}ft exceeds legal limit ${LEGAL_LIMITS.maxLength}ft`);
  }

  if (result.cargoWeightLbs !== null && result.cargoWeightLbs > LEGAL_LIMITS.maxWeight) {
    result.exceedsLegalWeight = true;
    result.isOOG = true;
    result.requiresPermits = true;
    result.reasons.push(`Weight ${result.cargoWeightLbs.toLocaleString()}lbs exceeds legal limit ${LEGAL_LIMITS.maxWeight.toLocaleString()}lbs`);
  }

  return result;
}

/**
 * Suggest the best trailer(s) for given cargo dimensions and weight
 * Returns trailers sorted by fit score (best fit first)
 */
function suggestTrailer(
  height: number | string | null | undefined,
  width: number | string | null | undefined,
  length: number | string | null | undefined,
  weight: number | string | null | undefined,
  dimensionUnit?: string | null,
  weightUnit?: string | null,
  cargoDescription?: string | null
): TrailerSuggestion[] {
  const cargoHeightFt = convertToFeet(height, dimensionUnit);
  const cargoWidthFt = convertToFeet(width, dimensionUnit);
  const cargoLengthFt = convertToFeet(length, dimensionUnit);
  const cargoWeightLbs = convertToLbs(weight, weightUnit);
  const description = (cargoDescription || '').toLowerCase();

  const suggestions: TrailerSuggestion[] = [];

  for (const trailer of TRAILER_CONFIGS) {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let fitScore = 50; // Base score

    // Check if cargo fits within trailer dimensions
    let fits = true;

    // Height check: cargo height + deck height must be <= legal max height
    if (cargoHeightFt !== null) {
      const totalHeight = cargoHeightFt + trailer.deckHeight;
      if (totalHeight > LEGAL_LIMITS.maxHeight) {
        fits = false;
        warnings.push(`Cargo height ${cargoHeightFt.toFixed(1)}ft + deck ${trailer.deckHeight}ft = ${totalHeight.toFixed(1)}ft exceeds legal ${LEGAL_LIMITS.maxHeight}ft`);
      } else if (cargoHeightFt > trailer.maxCargoHeight) {
        fits = false;
        warnings.push(`Cargo height ${cargoHeightFt.toFixed(1)}ft exceeds trailer max ${trailer.maxCargoHeight}ft`);
      } else {
        // Good fit - score higher for closer match (less wasted space)
        const heightUtilization = cargoHeightFt / trailer.maxCargoHeight;
        fitScore += heightUtilization * 15;
        reasons.push(`Height OK: ${cargoHeightFt.toFixed(1)}ft fits in ${trailer.maxCargoHeight}ft max`);
      }
    }

    // Width check
    if (cargoWidthFt !== null) {
      if (cargoWidthFt > trailer.deckWidth) {
        fits = false;
        warnings.push(`Cargo width ${cargoWidthFt.toFixed(1)}ft exceeds deck width ${trailer.deckWidth}ft`);
      } else {
        const widthUtilization = cargoWidthFt / trailer.deckWidth;
        fitScore += widthUtilization * 15;
        reasons.push(`Width OK: ${cargoWidthFt.toFixed(1)}ft fits in ${trailer.deckWidth}ft deck`);
      }
    }

    // Length check
    if (cargoLengthFt !== null) {
      if (cargoLengthFt > trailer.deckLength) {
        fits = false;
        warnings.push(`Cargo length ${cargoLengthFt.toFixed(1)}ft exceeds deck length ${trailer.deckLength}ft`);
      } else {
        const lengthUtilization = cargoLengthFt / trailer.deckLength;
        fitScore += lengthUtilization * 15;
        reasons.push(`Length OK: ${cargoLengthFt.toFixed(1)}ft fits in ${trailer.deckLength}ft deck`);
      }
    }

    // Weight check
    if (cargoWeightLbs !== null) {
      if (cargoWeightLbs > trailer.maxWeight) {
        fits = false;
        warnings.push(`Cargo weight ${cargoWeightLbs.toLocaleString()}lbs exceeds trailer max ${trailer.maxWeight.toLocaleString()}lbs`);
      } else {
        const weightUtilization = cargoWeightLbs / trailer.maxWeight;
        fitScore += weightUtilization * 10;
        reasons.push(`Weight OK: ${cargoWeightLbs.toLocaleString()}lbs within ${trailer.maxWeight.toLocaleString()}lbs limit`);
      }
    }

    // Bonus for matching cargo description to trailer's bestFor
    for (const bestFor of trailer.bestFor) {
      if (description.includes(bestFor.toLowerCase())) {
        fitScore += 10;
        reasons.push(`Matches trailer specialty: ${bestFor}`);
        break;
      }
    }

    // Special considerations
    if (trailer.category === 'enclosed' &&
        (description.includes('weather') || description.includes('sensitive') ||
         description.includes('protect') || description.includes('covered'))) {
      fitScore += 10;
      reasons.push('Enclosed trailer provides weather protection');
    }

    if (trailer.category === 'reefer' &&
        (description.includes('refrigerat') || description.includes('frozen') ||
         description.includes('cold') || description.includes('temperature'))) {
      fitScore += 15;
      reasons.push('Reefer required for temperature control');
    }

    if (!fits) {
      fitScore = Math.max(0, fitScore - 50); // Penalize but still include for reference
    }

    suggestions.push({
      trailer,
      fitScore: Math.min(100, Math.max(0, fitScore)),
      reasons,
      warnings
    });
  }

  // Sort by fit score descending, then by deck utilization efficiency
  suggestions.sort((a, b) => {
    if (b.fitScore !== a.fitScore) {
      return b.fitScore - a.fitScore;
    }
    // If scores are equal, prefer smaller deck (better utilization)
    const aArea = a.trailer.deckLength * a.trailer.deckWidth;
    const bArea = b.trailer.deckLength * b.trailer.deckWidth;
    return aArea - bArea;
  });

  return suggestions;
}

/**
 * Get the best trailer recommendation for cargo
 */
function getBestTrailer(
  height: number | string | null | undefined,
  width: number | string | null | undefined,
  length: number | string | null | undefined,
  weight: number | string | null | undefined,
  dimensionUnit?: string | null,
  weightUnit?: string | null,
  cargoDescription?: string | null
): TrailerSuggestion | null {
  const suggestions = suggestTrailer(height, width, length, weight, dimensionUnit, weightUnit, cargoDescription);
  // Return best fitting trailer (score > 40 means it actually fits)
  return suggestions.find(s => s.fitScore > 40) || suggestions[0] || null;
}

/**
 * Check if cargo is OOG (Out of Gauge) based on description and dimensions
 * Uses legal limits from trailer configurations
 */
function isOOGCargo(
  description: string | null | undefined,
  height: number | string | null | undefined,
  width: number | string | null | undefined,
  length?: number | string | null | undefined,
  weight?: number | string | null | undefined,
  dimensionUnit?: string | null,
  weightUnit?: string | null
): boolean {
  const analysis = analyzeOOGCargo(description, height, width, length, weight, dimensionUnit, weightUnit);
  return analysis.isOOG;
}

/**
 * Get pricing multiplier based on container type and OOG status
 */
function getContainerPricingMultiplier(containerType: string | null, isOOG: boolean): number {
  if (isOOG) {
    // OOG cargo always gets the Open Top premium at minimum
    return Math.max(CONTAINER_PRICING_MULTIPLIERS['OPEN_TOP'] || 1.40,
                   containerType ? CONTAINER_PRICING_MULTIPLIERS[containerType] || 1.0 : 1.0);
  }
  return containerType ? CONTAINER_PRICING_MULTIPLIERS[containerType] || 1.0 : 1.0;
}

function jaroWinklerSimilarity(s1: string | null | undefined, s2: string | null | undefined): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const str1 = s1.toLowerCase();
  const str2 = s2.toLowerCase();

  const len1 = str1.length;
  const len2 = str2.length;

  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || str1[i] !== str2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (str1[i] === str2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Calculate city match score using exact matching with normalization
 * Avoids false positives from fuzzy matching (e.g., "Newark" vs "New York")
 * Returns 1.0 for exact match, 0.7 for same city different spelling, 0.0 for different cities
 */
function calculateCityMatchScore(
  city1: string | null | undefined,
  city2: string | null | undefined,
  state1?: string | null,
  state2?: string | null
): number {
  if (!city1 || !city2) return 0.0;

  // Normalize city names: lowercase, remove common suffixes, trim whitespace
  const normalizeCity = (city: string): string => {
    return city
      .toLowerCase()
      .trim()
      .replace(/\s+(city|town|township|village|borough|port|harbor|harbour)$/i, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ');
  };

  const norm1 = normalizeCity(city1);
  const norm2 = normalizeCity(city2);

  // Exact match after normalization
  if (norm1 === norm2) {
    return 1.0;
  }

  // Check for common city name variations/abbreviations
  const CITY_ALIASES: Record<string, string[]> = {
    'los angeles': ['la', 'l.a.'],
    'new york': ['nyc', 'ny'],
    'san francisco': ['sf', 'san fran'],
    'long beach': ['lb'],
    'fort worth': ['ft worth', 'ft. worth'],
    'st louis': ['saint louis', 'st. louis'],
    'st paul': ['saint paul', 'st. paul'],
  };

  // Check if cities are aliases of each other
  for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
    const allVariants = [canonical, ...aliases];
    if (allVariants.includes(norm1) && allVariants.includes(norm2)) {
      return 1.0;
    }
  }

  // If states are provided and match, give partial credit for same-state different city
  // This helps when city names have minor variations but are clearly same metro area
  if (state1 && state2) {
    const normState1 = state1.toLowerCase().trim();
    const normState2 = state2.toLowerCase().trim();
    if (normState1 === normState2) {
      // Same state - check if cities share significant prefix (e.g., "North Chicago" vs "Chicago")
      const shorter = norm1.length < norm2.length ? norm1 : norm2;
      const longer = norm1.length < norm2.length ? norm2 : norm1;
      if (longer.includes(shorter) && shorter.length >= 4) {
        return 0.7; // Partial match - likely same metro area
      }
    }
  }

  // Different cities
  return 0.0;
}

/**
 * Calculate similarity between two route distances
 * Returns 1.0 for identical distances, decaying toward 0 as difference grows
 * Returns 0.2 if either distance is unavailable (low score for unknown data)
 *
 * TUNED: More aggressive penalties - shipping costs scale heavily with distance
 * A 50% distance mismatch should significantly penalize the match
 */
function calculateDistanceSimilarity(
  sourceDistance: number | null | undefined,
  historicalDistance: number | null | undefined
): number {
  // If either distance is unavailable, return LOW score - unknown distance is risky
  if (!sourceDistance || !historicalDistance || sourceDistance <= 0 || historicalDistance <= 0) {
    return 0.2;
  }

  // Calculate percentage difference
  const maxDist = Math.max(sourceDistance, historicalDistance);
  const minDist = Math.min(sourceDistance, historicalDistance);
  const diff = maxDist - minDist;
  const percentDiff = diff / maxDist;

  // More aggressive banded scoring for realistic matches:
  // 0-10% diff = 1.0 (excellent match - nearly identical routes)
  // 10-20% diff = 0.85 (good match)
  // 20-35% diff = 0.60 (acceptable match - some price variance expected)
  // 35-50% diff = 0.40 (weak match - significant price difference likely)
  // 50-75% diff = 0.20 (poor match - probably different service categories)
  // >75% diff = 0.05 (very poor - should rarely be used)
  if (percentDiff <= 0.10) return 1.0;
  if (percentDiff <= 0.20) return 0.85;
  if (percentDiff <= 0.35) return 0.60;
  if (percentDiff <= 0.50) return 0.40;
  if (percentDiff <= 0.75) return 0.20;
  return 0.05;
}

interface SimilarityResult {
  score: number;
  criteria: MatchCriteria;
  metadata: MatchMetadata;
}

function calculateEnhancedSimilarity(
  sourceQuote: Quote,
  historicalQuote: Quote,
  sourceDistance?: number | null,
  historicalDistance?: number | null
): SimilarityResult {
  const criteria: MatchCriteria = {};
  let totalScore = 0;
  let totalWeight = 0;

  // Origin Matching
  const sourceOriginRegion = getUSRegion(sourceQuote.origin_city, sourceQuote.origin_state_province) ||
                             getIntlRegion(sourceQuote.origin_country);
  const histOriginRegion = getUSRegion(historicalQuote.origin_city, historicalQuote.origin_state_province) ||
                           getIntlRegion(historicalQuote.origin_country);

  criteria.origin_region = sourceOriginRegion && histOriginRegion && sourceOriginRegion === histOriginRegion ? 1 : 0;
  // Use exact city match (normalized) instead of fuzzy Jaro-Winkler to avoid false positives
  // e.g., "Newark" vs "New York" are different ports with different pricing
  criteria.origin_city = calculateCityMatchScore(
    sourceQuote.origin_city, historicalQuote.origin_city,
    sourceQuote.origin_state_province, historicalQuote.origin_state_province
  );

  totalScore += (criteria.origin_region || 0) * ENHANCED_WEIGHTS.origin_region!;
  totalScore += (criteria.origin_city || 0) * ENHANCED_WEIGHTS.origin_city!;
  totalWeight += ENHANCED_WEIGHTS.origin_region! + ENHANCED_WEIGHTS.origin_city!;

  // Destination Matching
  const sourceDestRegion = getUSRegion(sourceQuote.destination_city, sourceQuote.destination_state_province) ||
                           getIntlRegion(sourceQuote.destination_country);
  const histDestRegion = getUSRegion(historicalQuote.destination_city, historicalQuote.destination_state_province) ||
                         getIntlRegion(historicalQuote.destination_country);

  criteria.destination_region = sourceDestRegion && histDestRegion && sourceDestRegion === histDestRegion ? 1 : 0;
  // Use exact city match (normalized) instead of fuzzy Jaro-Winkler
  criteria.destination_city = calculateCityMatchScore(
    sourceQuote.destination_city, historicalQuote.destination_city,
    sourceQuote.destination_state_province, historicalQuote.destination_state_province
  );

  totalScore += (criteria.destination_region || 0) * ENHANCED_WEIGHTS.destination_region!;
  totalScore += (criteria.destination_city || 0) * ENHANCED_WEIGHTS.destination_city!;
  totalWeight += ENHANCED_WEIGHTS.destination_region! + ENHANCED_WEIGHTS.destination_city!;

  // Service Type Matching - apply distance-based correction first
  const rawSourceService = normalizeServiceType(sourceQuote.service_type);
  const rawHistService = normalizeServiceType(historicalQuote.service_type);
  
  // Correct service types based on distance - prevents Ocean label on 5-mile routes
  const sourceService = correctServiceTypeByDistance(rawSourceService, sourceDistance, false, sourceQuote.cargo_description);
  const histService = correctServiceTypeByDistance(rawHistService, historicalDistance, false, historicalQuote.cargo_description);

  criteria.service_type = sourceService === histService ? 1 : 0;

  const sourceIsShortHaul = (sourceDistance ?? 0) > 0 && (sourceDistance as number) < 150;

  // Determine if lanes are international (crossing country borders)
  const isSourceIntl = (sourceOriginRegion && sourceOriginRegion !== 'USA') || (sourceDestRegion && sourceDestRegion !== 'USA');
  const isHistIntl = (histOriginRegion && histOriginRegion !== 'USA') || (histDestRegion && histDestRegion !== 'USA');

  // CRITICAL: International vs domestic lane mismatch - these have completely different pricing models
  // An international ocean quote (Rotterdam->NYC) should NOT match with domestic intermodal (Chicago->LA)
  const laneTypeMismatch = isSourceIntl !== isHistIntl;

  // For international lanes, OCEAN and INTERMODAL are often functionally interchangeable in historical labeling.
  // But ONLY when both quotes are on the same lane type (both international OR both domestic).
  const intlOceanIntermodalCompatible = isSourceIntl && isHistIntl && !laneTypeMismatch && (
    (sourceService === 'OCEAN' && histService === 'INTERMODAL') ||
    (sourceService === 'INTERMODAL' && histService === 'OCEAN')
  );

  // Drayage and Ground have VERY different pricing models:
  // - Drayage: port fees, chassis fees, demurrage, per-move pricing
  // - Ground FTL: per-mile, fuel surcharge, accessorials
  // Only allow cross-matching when BOTH are short-haul (under 150 miles)
  const histIsShortHaul = (historicalDistance ?? 0) > 0 && (historicalDistance as number) < 150;

  let compatible: string[];
  if (sourceService === 'DRAYAGE' || sourceService === 'GROUND') {
    if (sourceIsShortHaul && histIsShortHaul) {
      // Both short-haul - allow cross-matching
      compatible = ['DRAYAGE', 'GROUND'];
    } else {
      // At least one is long-haul - require exact service match
      compatible = [sourceService];
    }
  } else {
    compatible = SERVICE_COMPATIBILITY[sourceService] || [];
  }

  // Apply heavy penalty for lane type mismatch on ocean/intermodal services
  let serviceCompatScore = (compatible.includes(histService) || intlOceanIntermodalCompatible) ? 0.8 : 0;
  if (laneTypeMismatch && (sourceService === 'OCEAN' || sourceService === 'INTERMODAL')) {
    // International ocean/intermodal should NOT match domestic - zero out compatibility
    serviceCompatScore = 0;
  }

  criteria.service_compatibility = serviceCompatScore;

  const serviceScore = Math.max(criteria.service_type || 0, criteria.service_compatibility || 0);
  totalScore += serviceScore * (ENHANCED_WEIGHTS.service_type! + ENHANCED_WEIGHTS.service_compatibility!);
  totalWeight += ENHANCED_WEIGHTS.service_type! + ENHANCED_WEIGHTS.service_compatibility!;

  // Cargo Matching - stricter with explicit incompatibilities
  const sourceCargoCat = classifyCargo(sourceQuote.cargo_description);
  const histCargoCat = classifyCargo(historicalQuote.cargo_description);

  // Define cargo categories that should NEVER match each other
  const CARGO_INCOMPATIBLE: Record<string, string[]> = {
    'MACHINERY': ['AGRICULTURAL', 'HAZMAT', 'GENERAL'],
    'VEHICLES': ['AGRICULTURAL', 'HAZMAT', 'INDUSTRIAL'],
    'HAZMAT': ['AGRICULTURAL', 'VEHICLES', 'MACHINERY', 'GENERAL'],
    'OVERSIZED': ['AGRICULTURAL', 'GENERAL'],
    'AGRICULTURAL': ['MACHINERY', 'VEHICLES', 'HAZMAT', 'OVERSIZED', 'INDUSTRIAL'],
  };

  const neutralCargoCats = new Set(['GENERAL', 'UNKNOWN']);
  let cargoScore: number;

  if (sourceCargoCat === histCargoCat) {
    cargoScore = 1.0;
  } else if (CARGO_INCOMPATIBLE[sourceCargoCat]?.includes(histCargoCat) ||
             CARGO_INCOMPATIBLE[histCargoCat]?.includes(sourceCargoCat)) {
    // Hard incompatibility - these cargo types have very different handling/pricing
    cargoScore = 0.0;
  } else if (neutralCargoCats.has(sourceCargoCat) || neutralCargoCats.has(histCargoCat)) {
    // Unknown/General cargo - lower score since we can't verify compatibility
    cargoScore = 0.3;
  } else {
    // Different but not explicitly incompatible categories
    cargoScore = 0.15;
  }
  criteria.cargo_category = cargoScore;

  totalScore += (criteria.cargo_category || 0) * ENHANCED_WEIGHTS.cargo_category!;
  totalWeight += ENHANCED_WEIGHTS.cargo_category!;

  // Weight Matching - stricter to avoid unrealistic matches
  const sourceWeightRange = getWeightRange(sourceQuote.cargo_weight, sourceQuote.weight_unit);
  const histWeightRange = getWeightRange(historicalQuote.cargo_weight, historicalQuote.weight_unit);

  if (sourceWeightRange && histWeightRange) {
    const weightDiff = Math.abs(WEIGHT_RANGES.indexOf(sourceWeightRange) - WEIGHT_RANGES.indexOf(histWeightRange));
    // Stricter penalties for weight class differences:
    // Same: 1.0, ±1 class: 0.65, ±2 classes: 0.25, ±3+ classes: 0.0 (hard rejection)
    // Weight dramatically affects equipment, fuel, and pricing
    criteria.cargo_weight_range = weightDiff === 0 ? 1.0 :
                                  weightDiff === 1 ? 0.65 :
                                  weightDiff === 2 ? 0.25 : 0.0;
  } else {
    criteria.cargo_weight_range = 0.35; // Lower default when weight unknown - risky assumption
  }

  totalScore += (criteria.cargo_weight_range || 0) * ENHANCED_WEIGHTS.cargo_weight_range!;
  totalWeight += ENHANCED_WEIGHTS.cargo_weight_range!;

  // Actual Weight Comparison (more granular than weight range)
  const sourceWeightKg = parseFloat(String(sourceQuote.cargo_weight || 0));
  const histWeightKg = parseFloat(String(historicalQuote.cargo_weight || 0));
  if (sourceWeightKg > 0 && histWeightKg > 0) {
    const maxWeight = Math.max(sourceWeightKg, histWeightKg);
    const weightPercentDiff = Math.abs(sourceWeightKg - histWeightKg) / maxWeight;
    // Score based on percentage difference: 0-15% = 1.0, 15-30% = 0.7, 30-50% = 0.4, >50% = 0.1
    criteria.cargo_weight_actual = weightPercentDiff <= 0.15 ? 1.0 :
                                   weightPercentDiff <= 0.30 ? 0.7 :
                                   weightPercentDiff <= 0.50 ? 0.4 : 0.1;
  } else {
    criteria.cargo_weight_actual = 0.3; // Low score for unknown weights
  }
  totalScore += (criteria.cargo_weight_actual || 0) * ENHANCED_WEIGHTS.cargo_weight_actual!;
  totalWeight += ENHANCED_WEIGHTS.cargo_weight_actual!;

  // Equipment Type Matching
  const sourceEquipment = detectEquipmentType(
    sourceQuote.cargo_description,
    sourceQuote.service_type,
    sourceQuote.equipment_type_requested
  );
  const histEquipment = detectEquipmentType(
    historicalQuote.cargo_description,
    historicalQuote.service_type,
    historicalQuote.equipment_type_requested
  );
  // Equipment compatibility groups
  const EQUIPMENT_COMPATIBLE: Record<string, string[]> = {
    'DRY_VAN': ['DRY_VAN', 'CONESTOGA'],
    'FLATBED': ['FLATBED', 'STEP_DECK', 'CONESTOGA'],
    'STEP_DECK': ['STEP_DECK', 'FLATBED', 'LOWBOY'],
    'LOWBOY': ['LOWBOY', 'STEP_DECK'],
    'REEFER': ['REEFER'],
    'TANKER': ['TANKER'],
    'HOTSHOT': ['HOTSHOT', 'FLATBED'],
  };
  const equipmentCompat = EQUIPMENT_COMPATIBLE[sourceEquipment] || [sourceEquipment];
  criteria.equipment_type = sourceEquipment === histEquipment ? 1.0 :
                            equipmentCompat.includes(histEquipment) ? 0.6 : 0.1;
  totalScore += (criteria.equipment_type || 0) * ENHANCED_WEIGHTS.equipment_type!;
  totalWeight += ENHANCED_WEIGHTS.equipment_type!;

  // Piece Count
  const sourcePieces = parseInt(String(sourceQuote.number_of_pieces)) || 0;
  const histPieces = parseInt(String(historicalQuote.number_of_pieces)) || 0;

  if (sourcePieces > 0 && histPieces > 0) {
    const pieceDiff = Math.abs(sourcePieces - histPieces) / Math.max(sourcePieces, histPieces);
    criteria.number_of_pieces = Math.max(0, 1 - pieceDiff);
  } else {
    criteria.number_of_pieces = 0.5;
  }

  totalScore += (criteria.number_of_pieces || 0) * ENHANCED_WEIGHTS.number_of_pieces!;
  totalWeight += ENHANCED_WEIGHTS.number_of_pieces!;

  // Hazmat Matching
  const sourceHazmat = sourceQuote.hazardous_material === true;
  const histHazmat = historicalQuote.hazardous_material === true;

  criteria.hazmat = sourceHazmat === histHazmat ? 1 : 0;
  totalScore += (criteria.hazmat || 0) * ENHANCED_WEIGHTS.hazmat!;
  totalWeight += ENHANCED_WEIGHTS.hazmat!;

  // Container Type
  const sourceContainer = detectContainerType(sourceQuote.cargo_description, sourceQuote.service_type);
  const histContainer = detectContainerType(historicalQuote.cargo_description, historicalQuote.service_type);

  if (sourceContainer && histContainer) {
    criteria.container_type = sourceContainer === histContainer ? 1 : 0.5;
  } else {
    criteria.container_type = 0.7;
  }

  totalScore += (criteria.container_type || 0) * ENHANCED_WEIGHTS.container_type!;
  totalWeight += ENHANCED_WEIGHTS.container_type!;

  // Recency - shipping rates change frequently (fuel, market conditions)
  // Use 75-day half-life so older quotes are appropriately discounted
  // This means: 75 days = 0.5, 150 days = 0.25, 6 months = ~0.18
  const quoteDate = historicalQuote.quote_date || historicalQuote.created_at;
  if (quoteDate) {
    const ageDays = (Date.now() - new Date(quoteDate).getTime()) / (1000 * 60 * 60 * 24);
    // 75-day half-life: market rates can shift significantly in 2-3 months
    // 0 days = 1.0, 30 days = 0.76, 75 days = 0.5, 150 days = 0.25, 225 days = 0.125
    criteria.recency = Math.max(0.05, Math.pow(0.5, ageDays / 75));
  } else {
    criteria.recency = 0.25; // Low default for unknown dates - risky to trust
  }

  totalScore += (criteria.recency || 0) * ENHANCED_WEIGHTS.recency!;
  totalWeight += ENHANCED_WEIGHTS.recency!;

  // Distance Similarity
  // Use provided distances, or fall back to stored total_distance_miles
  const srcDist = sourceDistance ?? sourceQuote.total_distance_miles;
  const histDist = historicalDistance ?? historicalQuote.total_distance_miles;
  criteria.distance_similarity = calculateDistanceSimilarity(srcDist, histDist);

  totalScore += (criteria.distance_similarity || 0) * ENHANCED_WEIGHTS.distance_similarity!;
  totalWeight += ENHANCED_WEIGHTS.distance_similarity!;

  let finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

  // Penalize long-haul ground freight matches that have poor distance or cargo similarity
  const isLongHaulGround = sourceService === 'GROUND' && (sourceDistance ?? 0) > 500;
  if (isLongHaulGround) {
    if (criteria.distance_similarity !== undefined && criteria.distance_similarity < 0.85) {
        finalScore *= 0.8; // 20% penalty for poor distance match
        criteria.long_haul_penalty_distance = 0.2;
    }
    if (criteria.cargo_category !== undefined && criteria.cargo_category < 1.0) {
        finalScore *= 0.85; // 15% penalty for non-exact cargo match
        criteria.long_haul_penalty_cargo = 0.15;
    }
  }

  // CRITICAL: Penalize international vs domestic lane mismatches heavily
  // These have completely different pricing models and should rarely match
  if (laneTypeMismatch) {
    finalScore *= 0.5; // 50% penalty for lane type mismatch
    criteria.lane_type_mismatch_penalty = 0.5;
  }

  return {
    score: Math.round(finalScore * 10000) / 10000,
    criteria: Object.fromEntries(
      Object.entries(criteria).map(([k, v]) => [k, Math.round((v || 0) * 10000) / 10000])
    ) as MatchCriteria,
    metadata: {
      sourceService,
      histService,
      sourceCargoCat,
      histCargoCat,
      sourceOriginRegion,
      sourceDestRegion,
    },
  };
}

interface PriceSuggestion {
  suggestedPrice: number | null;
  priceConfidence: number;
  priceRange: PriceRange | null;
  priceSource?: string;
  jobWon?: boolean | null;
}

function suggestPriceEnhanced(historicalQuote: Quote, similarityScore: number, sourceQuote: Quote): PriceSuggestion {
  const price = historicalQuote.final_agreed_price || historicalQuote.initial_quote_amount;
  if (!price || price <= 0) return { suggestedPrice: null, priceConfidence: 0, priceRange: null };

  let baseConfidence = similarityScore;

  if (historicalQuote.final_agreed_price && historicalQuote.job_won) {
    baseConfidence += 0.15;
  } else if (historicalQuote.final_agreed_price) {
    baseConfidence += 0.10;
  }

  const quoteDate = historicalQuote.quote_date || historicalQuote.created_at;
  if (quoteDate) {
    const ageDays = (Date.now() - new Date(quoteDate).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 180) baseConfidence -= 0.10;
    if (ageDays > 365) baseConfidence -= 0.15;
  }

  // Apply OOG/Container type pricing multiplier based on source quote characteristics
  const sourceContainerType = detectContainerType(sourceQuote.cargo_description, sourceQuote.service_type);
  const histContainerType = detectContainerType(historicalQuote.cargo_description, historicalQuote.service_type);
  const sourceIsOOG = isOOGCargo(
    sourceQuote.cargo_description, sourceQuote.cargo_height, sourceQuote.cargo_width,
    sourceQuote.cargo_length, sourceQuote.cargo_weight, sourceQuote.dimension_unit, sourceQuote.weight_unit
  );
  const histIsOOG = isOOGCargo(
    historicalQuote.cargo_description, historicalQuote.cargo_height, historicalQuote.cargo_width,
    historicalQuote.cargo_length, historicalQuote.cargo_weight, historicalQuote.dimension_unit, historicalQuote.weight_unit
  );

  // Calculate multiplier adjustment if source is OOG but historical is not
  let pricingMultiplier = 1.0;
  if (sourceIsOOG && !histIsOOG) {
    // Source quote is OOG but historical match is not - apply OOG premium
    pricingMultiplier = getContainerPricingMultiplier(sourceContainerType, sourceIsOOG);
  } else if (sourceContainerType && !histContainerType) {
    // Source has specialty container but historical doesn't - apply container premium
    pricingMultiplier = CONTAINER_PRICING_MULTIPLIERS[sourceContainerType] || 1.0;
  }

  const priceVariance = (1 - Math.min(1, baseConfidence)) * 0.25;
  const basePrice = parseFloat(String(price));
  const suggestedPrice = Math.round(basePrice * pricingMultiplier);

  return {
    suggestedPrice,
    priceConfidence: Math.round(Math.min(1, Math.max(0, baseConfidence)) * 10000) / 10000,
    priceRange: {
      low: Math.round(suggestedPrice * (1 - priceVariance)),
      high: Math.round(suggestedPrice * (1 + priceVariance)),
    },
    priceSource: historicalQuote.final_agreed_price ? 'FINAL_AGREED' : 'INITIAL_QUOTE',
    jobWon: historicalQuote.job_won,
  };
}

interface MatchingOptions {
  minScore?: number;
  maxMatches?: number;
  useAI?: boolean;
  feedbackData?: Map<number, QuoteFeedbackData>;
  skipValidation?: boolean; // Set true to skip quality filters (for debugging)
}

// Price bounds for sanity checking - quotes outside these ranges are likely errors
const PRICE_SANITY_BOUNDS = {
  MIN_PRICE: 50,           // Minimum realistic shipping quote
  MAX_PRICE: 1000000,      // Maximum realistic quote (even for project cargo)
  // Per-mile sanity checks (helps catch data entry errors)
  MIN_PRICE_PER_MILE: 0.50,   // Below this is likely an error or partial quote
  MAX_PRICE_PER_MILE: 100,    // Above this is likely an error (unless air/specialized)
};

/**
 * Validate a historical quote for quality and data sanity
 * Returns null if quote should be excluded, or the quote with warnings if acceptable
 */
interface QuoteValidationResult {
  valid: boolean;
  quote: Quote;
  warnings: string[];
  qualityScore: number; // 0-1, used to weight matches
}

function validateHistoricalQuote(quote: Quote): QuoteValidationResult {
  const warnings: string[] = [];
  let qualityScore = 1.0;

  const price = quote.final_agreed_price || quote.initial_quote_amount;

  // Check 1: Must have a price
  if (!price || price <= 0) {
    return { valid: false, quote, warnings: ['No valid price'], qualityScore: 0 };
  }

  // Check 2: Price sanity bounds
  if (price < PRICE_SANITY_BOUNDS.MIN_PRICE) {
    return { valid: false, quote, warnings: [`Price $${price} below minimum threshold`], qualityScore: 0 };
  }
  if (price > PRICE_SANITY_BOUNDS.MAX_PRICE) {
    return { valid: false, quote, warnings: [`Price $${price} above maximum threshold`], qualityScore: 0 };
  }

  // Check 3: Price per mile sanity (if distance available)
  const distanceMiles = quote.total_distance_miles;
  if (distanceMiles && distanceMiles > 0) {
    const pricePerMile = price / distanceMiles;

    // Extremely low price per mile - likely partial quote or data error
    if (pricePerMile < PRICE_SANITY_BOUNDS.MIN_PRICE_PER_MILE && distanceMiles > 50) {
      warnings.push(`Low price/mile: $${pricePerMile.toFixed(2)}/mi`);
      qualityScore *= 0.5; // Reduce but don't reject
    }

    // Extremely high price per mile (unless it's air freight or specialized)
    const serviceType = normalizeServiceType(quote.service_type);
    if (pricePerMile > PRICE_SANITY_BOUNDS.MAX_PRICE_PER_MILE &&
        serviceType !== 'AIR' && distanceMiles > 20) {
      warnings.push(`High price/mile: $${pricePerMile.toFixed(2)}/mi`);
      qualityScore *= 0.6;
    }
  }

  // Check 4: Must have origin and destination
  if (!quote.origin_city && !quote.origin_country) {
    warnings.push('Missing origin location');
    qualityScore *= 0.7;
  }
  if (!quote.destination_city && !quote.destination_country) {
    warnings.push('Missing destination location');
    qualityScore *= 0.7;
  }

  // Check 5: Quote age - very old quotes get reduced quality
  const quoteDate = quote.quote_date || quote.created_at;
  if (quoteDate) {
    const ageDays = (Date.now() - new Date(quoteDate).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 365) {
      warnings.push(`Quote is ${Math.round(ageDays)} days old`);
      qualityScore *= 0.6;
    } else if (ageDays > 180) {
      qualityScore *= 0.8;
    }
  } else {
    warnings.push('Missing quote date');
    qualityScore *= 0.7;
  }

  // Check 6: Prefer quotes with final_agreed_price (actual won business)
  if (quote.final_agreed_price && quote.job_won) {
    qualityScore *= 1.15; // Boost for verified pricing
    qualityScore = Math.min(1.0, qualityScore); // Cap at 1.0
  }

  // Check 7: Service type should be identifiable
  const serviceType = normalizeServiceType(quote.service_type);
  if (serviceType === 'UNKNOWN') {
    warnings.push('Unknown service type');
    qualityScore *= 0.8;
  }

  return {
    valid: qualityScore >= 0.3, // Reject if quality drops below 30%
    quote,
    warnings,
    qualityScore: Math.max(0, Math.min(1, qualityScore)),
  };
}

/**
 * Filter and validate historical quotes before matching
 * Returns only quotes that pass quality checks
 */
function filterHistoricalQuotes(quotes: Quote[], verbose: boolean = false): Quote[] {
  const validQuotes: Quote[] = [];
  let rejectedCount = 0;
  const rejectionReasons: Record<string, number> = {};

  for (const quote of quotes) {
    const validation = validateHistoricalQuote(quote);

    if (validation.valid) {
      validQuotes.push(quote);
    } else {
      rejectedCount++;
      const reason = validation.warnings[0] || 'Unknown';
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    }
  }

  if (verbose && rejectedCount > 0) {
    console.log(`  Filtered out ${rejectedCount} low-quality historical quotes:`);
    for (const [reason, count] of Object.entries(rejectionReasons)) {
      console.log(`    - ${reason}: ${count}`);
    }
  }

  return validQuotes;
}

// =============================================================================
// OUTLIER DETECTION AND STATISTICAL PRICING
// =============================================================================

/**
 * Statistical helper functions
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1));
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

/**
 * Detect and remove price outliers using IQR method
 * Returns filtered matches with outliers removed
 */
interface OutlierDetectionResult {
  filteredMatches: ExtendedQuoteMatch[];
  outliers: ExtendedQuoteMatch[];
  stats: {
    originalCount: number;
    outlierCount: number;
    q1: number;
    q3: number;
    iqr: number;
    lowerBound: number;
    upperBound: number;
  };
}

function detectAndRemoveOutliers(
  matches: ExtendedQuoteMatch[],
  iqrMultiplier: number = 1.5
): OutlierDetectionResult {
  const prices = matches
    .map(m => m.suggested_price)
    .filter((p): p is number => typeof p === 'number' && p > 0);

  if (prices.length < 4) {
    // Not enough data for IQR-based outlier detection
    return {
      filteredMatches: matches,
      outliers: [],
      stats: {
        originalCount: matches.length,
        outlierCount: 0,
        q1: 0,
        q3: 0,
        iqr: 0,
        lowerBound: 0,
        upperBound: Infinity,
      },
    };
  }

  const q1 = calculatePercentile(prices, 25);
  const q3 = calculatePercentile(prices, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - iqrMultiplier * iqr;
  const upperBound = q3 + iqrMultiplier * iqr;

  const filteredMatches: ExtendedQuoteMatch[] = [];
  const outliers: ExtendedQuoteMatch[] = [];

  for (const match of matches) {
    const price = match.suggested_price;
    if (typeof price === 'number' && price > 0) {
      if (price < lowerBound || price > upperBound) {
        outliers.push(match);
      } else {
        filteredMatches.push(match);
      }
    } else {
      filteredMatches.push(match); // Keep matches without prices
    }
  }

  return {
    filteredMatches,
    outliers,
    stats: {
      originalCount: matches.length,
      outlierCount: outliers.length,
      q1,
      q3,
      iqr,
      lowerBound,
      upperBound,
    },
  };
}

/**
 * Calculate statistically robust pricing from matches
 * Uses weighted median and trimmed mean for stability
 */
interface StatisticalPricingResult {
  recommendedPrice: number;
  /** Confidence as a percentage (0-100) */
  confidence_percentage: number;
  priceRange: PriceRange;
  methodology: string;
  stats: {
    matchCount: number;
    mean: number;
    median: number;
    trimmedMean: number;
    stdDev: number;
    coeffOfVariation: number;
  };
}

function calculateStatisticalPricing(
  matches: ExtendedQuoteMatch[],
  sourceQuote: Quote
): StatisticalPricingResult | null {
  // Get valid prices weighted by similarity score
  const pricedMatches = matches.filter(m =>
    typeof m.suggested_price === 'number' && m.suggested_price > 0
  );

  if (pricedMatches.length === 0) {
    return null;
  }

  const prices = pricedMatches.map(m => m.suggested_price!);
  const scores = pricedMatches.map(m => m.similarity_score);

  // Calculate basic statistics
  const mean = calculateMean(prices);
  const median = calculateMedian(prices);
  const stdDev = calculateStdDev(prices);
  const coeffOfVariation = mean > 0 ? stdDev / mean : 0;

  // Calculate trimmed mean (remove top and bottom 10%)
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const trimCount = Math.max(1, Math.floor(sortedPrices.length * 0.1));
  const trimmedPrices = sortedPrices.slice(trimCount, -trimCount || undefined);
  const trimmedMean = trimmedPrices.length > 0 ? calculateMean(trimmedPrices) : mean;

  // Calculate weighted average (by similarity score)
  const totalWeight = scores.reduce((sum, s) => sum + s, 0);
  const weightedAvg = totalWeight > 0
    ? pricedMatches.reduce((sum, m) => sum + m.suggested_price! * m.similarity_score, 0) / totalWeight
    : mean;

  // Determine confidence percentage based on data quality
  // HIGH = 85%, MEDIUM = 70%, LOW = 55%, VERY_LOW = 40%
  let confidence_percentage: number;
  let methodology: string;

  if (pricedMatches.length >= 5 && coeffOfVariation < 0.20 && scores[0]! >= 0.75) {
    confidence_percentage = 85; // HIGH
    methodology = 'Weighted average of 5+ consistent matches with high similarity';
  } else if (pricedMatches.length >= 3 && coeffOfVariation < 0.35 && scores[0]! >= 0.60) {
    confidence_percentage = 70; // MEDIUM
    methodology = 'Weighted average with moderate consistency';
  } else if (pricedMatches.length >= 1 && scores[0]! >= 0.55) {
    confidence_percentage = 55; // LOW
    methodology = 'Limited matches or high price variance';
  } else {
    confidence_percentage = 40; // VERY_LOW
    methodology = 'Insufficient data quality for reliable pricing';
  }

  // Choose recommended price based on confidence
  let recommendedPrice: number;
  if (confidence_percentage >= 85) {
    // High confidence: use weighted average
    recommendedPrice = weightedAvg;
  } else if (confidence_percentage >= 70) {
    // Medium confidence: blend weighted average with median for stability
    recommendedPrice = (weightedAvg * 0.6 + median * 0.4);
  } else {
    // Low confidence: prefer median (more robust to outliers)
    recommendedPrice = (median * 0.7 + trimmedMean * 0.3);
  }

  // Calculate price range based on data spread
  const rangeMultiplier = confidence_percentage >= 85 ? 0.10 :
                          confidence_percentage >= 70 ? 0.15 :
                          confidence_percentage >= 55 ? 0.20 : 0.25;

  const priceRange: PriceRange = {
    low: Math.round(recommendedPrice * (1 - rangeMultiplier)),
    high: Math.round(recommendedPrice * (1 + rangeMultiplier)),
  };

  // If we have actual percentile data, use that for range
  if (prices.length >= 4) {
    priceRange.low = Math.round(Math.max(priceRange.low, calculatePercentile(prices, 15)));
    priceRange.high = Math.round(Math.min(priceRange.high, calculatePercentile(prices, 85)));
  }

  return {
    recommendedPrice: Math.round(recommendedPrice),
    confidence_percentage,
    priceRange,
    methodology,
    stats: {
      matchCount: pricedMatches.length,
      mean: Math.round(mean),
      median: Math.round(median),
      trimmedMean: Math.round(trimmedMean),
      stdDev: Math.round(stdDev),
      coeffOfVariation: Math.round(coeffOfVariation * 100) / 100,
    },
  };
}

// Feedback boost constants
const FEEDBACK_BOOST = {
  // Boost for having positive feedback
  POSITIVE_FEEDBACK_BASE: 0.05,  // Base boost for having any positive feedback
  POSITIVE_FEEDBACK_PER_COUNT: 0.02,  // Additional boost per positive feedback (capped)
  POSITIVE_FEEDBACK_MAX_BOOST: 0.15,  // Maximum boost from positive feedback
  // Penalty for negative feedback
  NEGATIVE_FEEDBACK_PENALTY: 0.03,  // Penalty per negative feedback
  NEGATIVE_FEEDBACK_MAX_PENALTY: 0.10,  // Maximum penalty from negative feedback
  // Boost for verified pricing
  VERIFIED_PRICE_BOOST: 0.08,  // Boost when actual_price_used matches suggested price
};

interface ExtendedQuoteMatch extends QuoteMatch {
  sourceQuoteId: number;
  matchedQuoteId: number;
  feedbackData?: QuoteFeedbackData;
  feedbackBoost?: number;
}

/**
 * Calculate feedback boost/penalty for a historical quote
 */
function calculateFeedbackBoost(feedbackData: QuoteFeedbackData | undefined): number {
  if (!feedbackData || feedbackData.total_feedback_count === 0) {
    return 0;
  }

  let boost = 0;

  // Positive feedback boost
  if (feedbackData.positive_feedback_count > 0) {
    boost += FEEDBACK_BOOST.POSITIVE_FEEDBACK_BASE;
    boost += Math.min(
      feedbackData.positive_feedback_count * FEEDBACK_BOOST.POSITIVE_FEEDBACK_PER_COUNT,
      FEEDBACK_BOOST.POSITIVE_FEEDBACK_MAX_BOOST - FEEDBACK_BOOST.POSITIVE_FEEDBACK_BASE
    );
  }

  // Negative feedback penalty
  if (feedbackData.negative_feedback_count > 0) {
    boost -= Math.min(
      feedbackData.negative_feedback_count * FEEDBACK_BOOST.NEGATIVE_FEEDBACK_PENALTY,
      FEEDBACK_BOOST.NEGATIVE_FEEDBACK_MAX_PENALTY
    );
  }

  // Verified pricing boost - if actual prices were used and recorded
  if (feedbackData.actual_prices_used && feedbackData.actual_prices_used.length > 0) {
    boost += FEEDBACK_BOOST.VERIFIED_PRICE_BOOST;
  }

  return boost;
}

function findEnhancedMatches(
  sourceQuote: Quote,
  historicalQuotes: Quote[],
  options: MatchingOptions = {},
  sourceDistance?: number | null
): ExtendedQuoteMatch[] {
  const { minScore = 0.55, maxMatches = 10, feedbackData, skipValidation = false } = options;

  // Per-service minimum similarity thresholds - raised for more realistic matches
  // A 0.55 match means only 55% confidence - pricing from such matches is unreliable
  const SERVICE_MIN_SCORE: Record<string, number> = {
    DRAYAGE: 0.60,    // Drayage is very distance/location sensitive
    OCEAN: 0.58,      // Ocean has distinct pricing tiers
    INTERMODAL: 0.58, // Intermodal combines multiple modes
    GROUND: 0.55,     // Ground has more flexibility but still needs good match
    AIR: 0.60,        // Air freight has premium pricing - need good match
    TRANSLOAD: 0.55,  // Transload pricing varies by facility
  };
  const normalizedService = normalizeServiceType(sourceQuote.service_type);
  const effectiveMinScore = Math.max(minScore, SERVICE_MIN_SCORE[normalizedService] ?? minScore);

  // Apply quality filters to historical quotes unless skipped
  const filteredHistorical = skipValidation
    ? historicalQuotes
    : filterHistoricalQuotes(historicalQuotes, false);

  const matches: ExtendedQuoteMatch[] = [];

  for (const historical of filteredHistorical) {
    if (historical.quote_id === sourceQuote.quote_id) continue;

    // Use provided source distance, historical quotes use their stored total_distance_miles
    const { score, criteria, metadata } = calculateEnhancedSimilarity(
      sourceQuote,
      historical,
      sourceDistance,
      historical.total_distance_miles
    );

    // Get feedback data for this historical quote
    const quoteFeedback = feedbackData?.get(historical.quote_id!);
    const feedbackBoost = calculateFeedbackBoost(quoteFeedback);

    // Apply feedback boost to the score (capped at 1.0)
    const adjustedScore = Math.min(1.0, score + feedbackBoost);

    if (adjustedScore >= effectiveMinScore) {
      const priceInfo = suggestPriceEnhanced(historical, adjustedScore, sourceQuote);

      // Adjust price confidence based on feedback
      let adjustedPriceConfidence = priceInfo.priceConfidence;
      if (quoteFeedback) {
        // Increase confidence if we have positive feedback
        if (quoteFeedback.positive_feedback_count > quoteFeedback.negative_feedback_count) {
          adjustedPriceConfidence = Math.min(1.0, adjustedPriceConfidence + 0.1);
        }
        // Increase confidence further if we have verified actual prices
        if (quoteFeedback.actual_prices_used && quoteFeedback.actual_prices_used.length > 0) {
          adjustedPriceConfidence = Math.min(1.0, adjustedPriceConfidence + 0.1);
        }
      }

      matches.push({
        source_quote_id: sourceQuote.quote_id!,
        matched_quote_id: historical.quote_id!,
        sourceQuoteId: sourceQuote.quote_id!,
        matchedQuoteId: historical.quote_id!,
        similarity_score: adjustedScore,
        match_criteria: criteria,
        suggested_price: priceInfo.suggestedPrice,
        price_confidence: adjustedPriceConfidence,
        price_range: priceInfo.priceRange,
        priceSource: priceInfo.priceSource,
        jobWon: priceInfo.jobWon,
        metadata,
        feedbackData: quoteFeedback,
        feedbackBoost: feedbackBoost,
        matchedQuoteData: {
          origin: `${historical.origin_city || 'Unknown'}, ${historical.origin_country || 'Unknown'}`,
          destination: `${historical.destination_city || 'Unknown'}, ${historical.destination_country || 'Unknown'}`,
          cargo: historical.cargo_description || undefined,
          service: historical.service_type || undefined,
          weight: historical.cargo_weight || undefined,
          weightUnit: historical.weight_unit || undefined,
          length: historical.cargo_length || undefined,
          width: historical.cargo_width || undefined,
          height: historical.cargo_height || undefined,
          dimensionUnit: historical.dimension_unit || undefined,
          distanceMiles: historical.total_distance_miles ?? null,
          finalPrice: historical.final_agreed_price,
          initialPrice: historical.initial_quote_amount,
          quoteDate: historical.quote_date || historical.created_at,
          status: historical.quote_status || undefined,
        },
      });
    }
  }

  matches.sort((a, b) => b.similarity_score - a.similarity_score);

  return matches.slice(0, maxMatches);
}

async function getAIPricingRecommendation(
  sourceQuote: Quote,
  matches: ExtendedQuoteMatch[],
  options: MatchingOptions = {},
  routeDistance?: RouteDistance | null
): Promise<AIPricingDetails | null> {
  const { useAI = true } = options;

  if (!useAI) {
    return null;
  }

  try {
    const aiService = getAIService();

    // First get the algorithmic recommendation as a baseline
    const algorithmicRecommendation = await aiService.getPricingRecommendation(sourceQuote, matches, routeDistance);

    // Generate the AI pricing prompt using centralized getPromptForTask
    const pricingPrompt = generatePricingPrompt(sourceQuote, matches, routeDistance, algorithmicRecommendation);

    const extractJsonObject = (text: string): string | null => {
      const start = text.indexOf('{');
      if (start < 0) return null;
      let depth = 0;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) {
            return text.slice(start, i + 1);
          }
        }
      }
      return null;
    };

    // Extended AI response parsing to capture all pricing details
    interface ParsedAIResponse {
      amount: number | null;
      error?: string;
      fullResponse?: {
        recommended_quote?: {
          initial_amount?: number;
          floor_price?: number;
          target_price?: number;
          stretch_price?: number;
        };
        /** Confidence as a percentage (0-100) */
        confidence_percentage?: number;
        price_breakdown?: {
          linehaul?: number;
          fuel_surcharge?: number;
          accessorials?: number;
          port_fees?: number;
          handling?: number;
          margin?: number;
        };
        market_factors?: string[];
        negotiation_notes?: string;
        alternative_options?: Array<{ description?: string; price?: number; savings_percent?: number }>;
        expiration_recommendation?: string;
      };
    }

    const parseAiFullResponse = (text: string): ParsedAIResponse => {
      const jsonCandidate = extractJsonObject(text);
      if (!jsonCandidate) {
        const trimmed = (text || '').trim();
        const head = trimmed.slice(0, 220).replace(/\s+/g, ' ');
        const tail = trimmed.length > 220 ? trimmed.slice(-220).replace(/\s+/g, ' ') : '';
        const snippet = tail ? `${head} … ${tail}` : head;
        return {
          amount: null,
          error: `No JSON object found in AI response (snippet: "${snippet}")`,
        };
      }
      try {
        const parsed = JSON.parse(jsonCandidate) as any;
        const aiInitial = parsed?.recommended_quote?.initial_amount;
        const raw = typeof aiInitial === 'number'
          ? aiInitial
          : Number(String(aiInitial ?? '').replace(/[$,\s]/g, ''));
        const amount = Number.isFinite(raw) ? Math.round(raw) : NaN;
        if (!Number.isFinite(amount) || amount <= 0) {
          return { amount: null, error: 'Invalid recommended_quote.initial_amount' };
        }
        return { amount, fullResponse: parsed };
      } catch (e) {
        return { amount: null, error: (e as Error).message };
      }
    };

    // Build comprehensive business-friendly reasoning from AI response
    const buildAIReasoning = (
      aiResponse: ParsedAIResponse['fullResponse'],
      algorithmicReasoning?: string
    ): string => {
      const sections: string[] = [];

      // Price Range section - most important for sales
      const quote = aiResponse?.recommended_quote;
      if (quote) {
        const priceRange: string[] = [];
        if (quote.floor_price) priceRange.push(`$${quote.floor_price.toLocaleString()} (minimum)`);
        if (quote.target_price) priceRange.push(`$${quote.target_price.toLocaleString()} (target)`);
        if (quote.stretch_price) priceRange.push(`$${quote.stretch_price.toLocaleString()} (initial ask)`);
        if (priceRange.length > 0) {
          sections.push(`PRICE RANGE: ${priceRange.join(' → ')}`);
        }
      }

      // Cost Breakdown section - transparent pricing components
      const breakdown = aiResponse?.price_breakdown;
      if (breakdown) {
        const costs: string[] = [];
        if (breakdown.linehaul) costs.push(`Base freight $${breakdown.linehaul.toLocaleString()}`);
        if (breakdown.fuel_surcharge) costs.push(`Fuel $${breakdown.fuel_surcharge.toLocaleString()}`);
        if (breakdown.accessorials) costs.push(`Accessorials $${breakdown.accessorials.toLocaleString()}`);
        if (breakdown.port_fees) costs.push(`Port fees $${breakdown.port_fees.toLocaleString()}`);
        if (breakdown.handling) costs.push(`Handling $${breakdown.handling.toLocaleString()}`);
        if (costs.length > 0) {
          sections.push(`COST BREAKDOWN: ${costs.join(' + ')}`);
        }
        // Margin as separate line for clarity
        if (breakdown.margin) {
          const marginPercent = quote?.target_price
            ? Math.round((breakdown.margin / quote.target_price) * 100)
            : null;
          sections.push(`MARGIN: $${breakdown.margin.toLocaleString()}${marginPercent ? ` (${marginPercent}% of target)` : ''}`);
        }
      }

      // Negotiation guidance - actionable sales advice
      if (aiResponse?.negotiation_notes) {
        sections.push(`NEGOTIATION: ${aiResponse.negotiation_notes}`);
      }

      // Market considerations - context for pricing decisions
      if (aiResponse?.market_factors && aiResponse.market_factors.length > 0) {
        const numberedFactors = aiResponse.market_factors
          .slice(0, 4)
          .map((f, i) => `${i + 1}. ${f}`)
          .join(' ');
        sections.push(`MARKET CONSIDERATIONS: ${numberedFactors}`);
      }

      // Alternative options - give customer choices
      if (aiResponse?.alternative_options && aiResponse.alternative_options.length > 0) {
        const alts = aiResponse.alternative_options
          .filter(a => a.description && a.price)
          .map(a => `${a.description}: $${a.price?.toLocaleString()}${a.savings_percent ? ` (save ${a.savings_percent}%)` : ''}`)
          .slice(0, 3);
        if (alts.length > 0) {
          sections.push(`ALTERNATIVE OPTIONS: ${alts.join('; ')}`);
        }
      }

      // Quote validity
      if (aiResponse?.expiration_recommendation) {
        sections.push(`VALIDITY: ${aiResponse.expiration_recommendation}`);
      }

      // Data source context (condensed algorithmic info)
      if (algorithmicReasoning) {
        // Extract key metrics from algorithmic reasoning for context
        const matchInfo = algorithmicReasoning.match(/(\d+)%?\s*similar/i);
        const priceInfo = algorithmicReasoning.match(/\$[\d,]+/g);
        if (matchInfo || priceInfo) {
          const dataPoints: string[] = [];
          if (matchInfo) dataPoints.push(`Best historical match: ${matchInfo[1]}% similar`);
          if (priceInfo && priceInfo.length > 0) dataPoints.push(`Reference prices: ${priceInfo.slice(0, 3).join(', ')}`);
          sections.push(`DATA SOURCE: ${dataPoints.join('. ')}`);
        }
      }

      // Confidence indicator
      if (aiResponse?.confidence_percentage !== undefined) {
        const confidenceText = aiResponse.confidence_percentage >= 80
          ? 'High confidence - strong historical data support'
          : aiResponse.confidence_percentage >= 60
            ? 'Medium confidence - reasonable market comparables'
            : 'Low confidence - limited data, recommend additional market validation';
        sections.push(`CONFIDENCE: ${aiResponse.confidence_percentage}% - ${confidenceText}`);
      }

      return sections.join('\n\n');
    };

    // Try to get AI-enhanced recommendation
    try {
      const aiResponseText = await aiService.generateResponse(pricingPrompt, {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      });

      // Parse the AI response - capture full response for comprehensive reasoning
      if (!aiResponseText || !aiResponseText.trim()) {
        console.log('      -> AI returned an empty response; falling back to algorithmic pricing');
      } else {
        let parsedResult = parseAiFullResponse(aiResponseText);

        // If parsing fails, do one repair attempt asking for JSON only.
        if (!parsedResult.amount) {
          console.log(`      -> AI response parsing failed: ${parsedResult.error || 'unknown error'}`);
          const truncated = aiResponseText.length > 3000 ? aiResponseText.slice(-3000) : aiResponseText;
          const repairPrompt = `${pricingPrompt}

IMPORTANT: Your previous response was not valid JSON or did not include recommended_quote.initial_amount.
Return ONLY a valid JSON object matching the OUTPUT FORMAT. No markdown, no prose.

Previous response (for repair):
${truncated}`;

          try {
            const repaired = await aiService.generateResponse(repairPrompt, {
              temperature: 0,
              topP: 0.9,
              maxOutputTokens: 4096,
              responseMimeType: 'application/json',
            });
            parsedResult = repaired ? parseAiFullResponse(repaired) : { amount: null, error: 'Empty repair response' };
          } catch (repairErr) {
            console.log(`      -> AI JSON repair attempt failed: ${(repairErr as Error).message}`);
          }
        }

        const aiSuggestedPrice = parsedResult.amount;
        const aiFullResponse = parsedResult.fullResponse;
        const aiConfidencePercentage = aiFullResponse?.confidence_percentage ?? 0;

        // PRIORITY: When AI has HIGH confidence (>=80%), trust it directly without algorithmic constraints
        // This handles cases where algorithmic matching fails (wrong comparables, project cargo, etc.)
        if (aiSuggestedPrice && aiConfidencePercentage >= 80) {
          console.log(
            `      -> AI HIGH confidence (${aiConfidencePercentage}%) pricing: Using AI price $${aiSuggestedPrice.toLocaleString()} directly`
          );
          const comprehensiveReasoning = buildAIReasoning(aiFullResponse, algorithmicRecommendation?.reasoning);
          const aiQuote = aiFullResponse?.recommended_quote;
          const aiBreakdown = aiFullResponse?.price_breakdown;

          const finalPrice = Math.round(aiSuggestedPrice);

          return {
            recommended_price: finalPrice,
            floor_price: aiQuote?.floor_price ?? finalPrice * 0.8,
            target_price: aiQuote?.target_price ?? finalPrice * 0.92,
            ceiling_price: aiQuote?.stretch_price ?? finalPrice * 1.05,
            confidence_percentage: aiConfidencePercentage,
            reasoning: comprehensiveReasoning || `AI HIGH confidence recommendation: $${finalPrice.toLocaleString()}`,
            price_breakdown: aiBreakdown ? {
              linehaul: aiBreakdown.linehaul,
              fuel_surcharge: aiBreakdown.fuel_surcharge,
              accessorials: aiBreakdown.accessorials,
              port_fees: aiBreakdown.port_fees,
              handling: aiBreakdown.handling,
              margin: aiBreakdown.margin,
            } : algorithmicRecommendation?.price_breakdown,
            market_factors: aiFullResponse?.market_factors ?? algorithmicRecommendation?.market_factors,
            negotiation_room_percent: aiBreakdown?.margin && finalPrice
              ? Math.round((aiBreakdown.margin / finalPrice) * 100)
              : algorithmicRecommendation?.negotiation_room_percent,
          };
        }

        // Case 1: We have both AI and algorithmic recommendations - blend them (AI not HIGH confidence)
        if (aiSuggestedPrice && algorithmicRecommendation?.recommended_price) {
          const floor = algorithmicRecommendation.floor_price ?? null;
          const ceiling = algorithmicRecommendation.ceiling_price ?? null;

          // Guardrails: the AI must stay close to the algorithmic band; otherwise we clamp.
          const guardedAi = (floor && ceiling)
            ? Math.round(Math.min(ceiling, Math.max(floor, aiSuggestedPrice)))
            : aiSuggestedPrice;

          // Weighted blend between algorithmic recommendation and AI suggestion.
          // Project cargo tends to be underrepresented in historical data; when confidence is LOW (<55%) and cargo is
          // machinery/vehicles/oversized, we lean more on the AI.
          const algoConfidencePercentage = algorithmicRecommendation.confidence_percentage ?? 50;
          const sourceCargoCat = classifyCargo(sourceQuote.cargo_description);
          const sourceMiles = routeDistance?.distanceMiles ?? null;
          const useHeavyAiForLowConfidenceProjectCargo =
            algoConfidencePercentage < 55 &&
            (sourceCargoCat === 'MACHINERY' || sourceCargoCat === 'OVERSIZED') &&
            (typeof sourceMiles === 'number' ? sourceMiles >= 400 : false);

          // For non-HIGH confidence AI, apply ratio constraints
          if (algoConfidencePercentage >= 55) {
            const rawRatio = aiSuggestedPrice / algorithmicRecommendation.recommended_price;

            if (!Number.isFinite(rawRatio) || rawRatio < 0.85 || rawRatio > 1.15) {
              console.log(
                `      -> AI adjustment ignored (AI confidence=${aiConfidencePercentage}%, algo confidence=${algoConfidencePercentage}%, ratio=${rawRatio.toFixed(2)} outside 0.85..1.15)`
              );
              return algorithmicRecommendation;
            }
          }

          let blendedPrice: number;
          let blendMethod: string;
          if (algoConfidencePercentage < 55) {
            if (useHeavyAiForLowConfidenceProjectCargo) {
              console.log(`      -> Project Cargo Override activated for ${sourceCargoCat}`);
              blendedPrice = Math.round((algorithmicRecommendation.recommended_price * 0.25) + (guardedAi * 0.75));
              blendMethod = 'Project Cargo Override (25/75 algo/AI)';
            } else {
              console.log(`      -> Low Confidence blend (70/30) activated.`);
              blendedPrice = Math.round((algorithmicRecommendation.recommended_price * 0.70) + (guardedAi * 0.30));
              blendMethod = 'Low Confidence blend (70/30 algo/AI)';
            }
          } else {
            blendedPrice = Math.round((algorithmicRecommendation.recommended_price * 0.85) + (guardedAi * 0.15));
            blendMethod = 'Standard blend (85/15 algo/AI)';
          }

          console.log(
            `    AI-enhanced pricing: Algorithmic $${algorithmicRecommendation.recommended_price.toLocaleString()}, AI suggested $${aiSuggestedPrice.toLocaleString()}, Guarded $${guardedAi.toLocaleString()}, Blended $${blendedPrice.toLocaleString()}`
          );

          // Build comprehensive reasoning from AI response
          const comprehensiveReasoning = buildAIReasoning(aiFullResponse, algorithmicRecommendation.reasoning);

          // Extract additional pricing details from AI response
          const aiQuote = aiFullResponse?.recommended_quote;
          const aiBreakdown = aiFullResponse?.price_breakdown;

          return {
            ...algorithmicRecommendation,
            recommended_price: blendedPrice,
            // Use AI's floor/target/ceiling if available, otherwise keep algorithmic
            floor_price: aiQuote?.floor_price ?? algorithmicRecommendation.floor_price,
            target_price: aiQuote?.target_price ?? algorithmicRecommendation.target_price,
            ceiling_price: aiQuote?.stretch_price ?? algorithmicRecommendation.ceiling_price,
            // Use AI confidence if available
            confidence_percentage: aiConfidencePercentage || algoConfidencePercentage,
            // Comprehensive reasoning with all AI details
            reasoning: `${comprehensiveReasoning} | [Blend] ${blendMethod}: Algo $${algorithmicRecommendation.recommended_price.toLocaleString()} + AI $${aiSuggestedPrice.toLocaleString()} → $${blendedPrice.toLocaleString()}`,
            // Include price breakdown if available
            price_breakdown: aiBreakdown ? {
              linehaul: aiBreakdown.linehaul,
              fuel_surcharge: aiBreakdown.fuel_surcharge,
              accessorials: aiBreakdown.accessorials,
              port_fees: aiBreakdown.port_fees,
              handling: aiBreakdown.handling,
              margin: aiBreakdown.margin,
            } : algorithmicRecommendation.price_breakdown,
            // Include market factors if available
            market_factors: aiFullResponse?.market_factors ?? algorithmicRecommendation.market_factors,
            // Include negotiation room if we have margin info
            negotiation_room_percent: aiBreakdown?.margin && blendedPrice
              ? Math.round((aiBreakdown.margin / blendedPrice) * 100)
              : algorithmicRecommendation.negotiation_room_percent,
          };
        }
        // Case 2: We have AI response but NO algorithmic recommendation (no historical matches)
        // Use AI pricing directly since it's our only data source
        else if (aiSuggestedPrice && !algorithmicRecommendation?.recommended_price) {
          console.log(`    AI-only pricing (no historical matches): $${aiSuggestedPrice.toLocaleString()}`);

          const aiQuote = aiFullResponse?.recommended_quote;
          const aiBreakdown = aiFullResponse?.price_breakdown;
          const aiConfidencePct = aiConfidencePercentage || 50; // Default to 50% for AI-only

          // Build reasoning from AI response
          const comprehensiveReasoning = buildAIReasoning(aiFullResponse, undefined);

          return {
            recommended_price: aiSuggestedPrice,
            floor_price: aiQuote?.floor_price ?? Math.round(aiSuggestedPrice * 0.85),
            target_price: aiQuote?.target_price ?? aiSuggestedPrice,
            ceiling_price: aiQuote?.stretch_price ?? Math.round(aiSuggestedPrice * 1.15),
            confidence_percentage: aiConfidencePct,
            reasoning: `[AI-Only Pricing - No Historical Data] ${comprehensiveReasoning}`,
            price_breakdown: aiBreakdown ? {
              linehaul: aiBreakdown.linehaul,
              fuel_surcharge: aiBreakdown.fuel_surcharge,
              accessorials: aiBreakdown.accessorials,
              port_fees: aiBreakdown.port_fees,
              handling: aiBreakdown.handling,
              margin: aiBreakdown.margin,
            } : undefined,
            market_factors: aiFullResponse?.market_factors,
            negotiation_room_percent: aiBreakdown?.margin && aiSuggestedPrice
              ? Math.round((aiBreakdown.margin / aiSuggestedPrice) * 100)
              : 10, // Default 10% negotiation room for AI-only pricing
          };
        }
      }
    } catch (aiError) {
      // AI enhancement failed, fall back to algorithmic recommendation
      console.log(`    AI enhancement skipped: ${(aiError as Error).message}`);
    }

    return algorithmicRecommendation;
  } catch (error) {
    const err = error as Error;
    console.log(`    Warning: AI pricing unavailable: ${err.message}`);
    return null;
  }
}

async function processEnhancedMatches(newQuoteIds: number[], options: MatchingOptions = {}): Promise<MatchResult> {
  const { minScore = 0.45, maxMatches = 10, useAI = true } = options;

  if (!newQuoteIds || newQuoteIds.length === 0) {
    return { processed: 0, matchesCreated: 0, errors: [], matchDetails: [] };
  }

  console.log('\n' + '='.repeat(70));
  console.log('ENHANCED QUOTE MATCHING SERVICE');
  console.log('='.repeat(70));
  console.log(`Processing ${newQuoteIds.length} quote(s) with domain-aware matching...`);
  if (useAI) {
    console.log('AI-powered pricing: ENABLED');
  }

  const results: MatchResult = {
    processed: 0,
    matchesCreated: 0,
    errors: [],
    matchDetails: [],
  };

  try {
    const historicalQuotes = await db.getHistoricalQuotesForMatching(newQuoteIds, {
      limit: 2000,
      onlyWithPrice: true,
    });

    console.log(`Found ${historicalQuotes.length} historical quotes with pricing`);

    if (historicalQuotes.length === 0) {
      console.log('No historical quotes available for matching');
      return results;
    }

    // Get feedback data for all historical quotes to boost matches with positive feedback
    const historicalQuoteIds = historicalQuotes.map(q => q.quote_id!).filter(id => id != null);
    const feedbackData = await db.getFeedbackForHistoricalQuotes(historicalQuoteIds);
    console.log(`Loaded feedback data for ${feedbackData.size} historical quotes`);

    for (const quoteId of newQuoteIds) {
      try {
        const sourceQuote = await db.getQuoteForMatching(quoteId);
        if (!sourceQuote) {
          console.log(`  Quote ${quoteId} not found, skipping`);
          continue;
        }

        console.log(`\n  Processing Quote #${quoteId}:`);
        console.log(`    Route: ${sourceQuote.origin_city || 'Unknown'} -> ${sourceQuote.destination_city || 'Unknown'}`);
        console.log(`    Service: ${sourceQuote.service_type || 'Unknown'}`);
        console.log(`    Cargo: ${(sourceQuote.cargo_description || 'Unknown').substring(0, 50)}...`);

        // Calculate route distance for the source quote
        const routeDistance = await calculateQuoteDistance(sourceQuote);
        const sourceDistanceMiles = routeDistance?.distanceMiles ?? null;
        if (routeDistance) {
          console.log(`    Distance: ${routeDistance.distanceMiles} miles (${routeDistance.durationText})`);
        }

        let matches = findEnhancedMatches(sourceQuote, historicalQuotes, { minScore, maxMatches, feedbackData }, sourceDistanceMiles);

        // Apply outlier detection to remove price anomalies
        if (matches.length >= 4) {
          const outlierResult = detectAndRemoveOutliers(matches);
          if (outlierResult.outliers.length > 0) {
            console.log(`    Removed ${outlierResult.outliers.length} price outliers (IQR bounds: $${outlierResult.stats.lowerBound.toFixed(0)}-$${outlierResult.stats.upperBound.toFixed(0)})`);
            matches = outlierResult.filteredMatches;
          }
        }

        // Always generate pricing - use matches if available, fallback otherwise
        let aiPricing: AIPricingDetails | null = null;
        let finalSuggestedPrice: number | null | undefined = null;
        let finalPriceConfidence: number = 0;
        let finalPriceRange: PriceRange | null = null;
        let pricingSource: string = 'none';

        if (matches.length > 0) {
          // Calculate statistical pricing from matches
          const statPricing = calculateStatisticalPricing(matches, sourceQuote);

          if (statPricing) {
            finalSuggestedPrice = statPricing.recommendedPrice;
            finalPriceConfidence = statPricing.confidence_percentage / 100;
            finalPriceRange = statPricing.priceRange;
            pricingSource = `statistical (${statPricing.methodology})`;
            console.log(`    Statistical Price: $${statPricing.recommendedPrice.toLocaleString()} (${statPricing.confidence_percentage}%, CV: ${statPricing.stats.coeffOfVariation})`);
          } else {
            // Fall back to best match price
            finalSuggestedPrice = matches[0]?.suggested_price;
            finalPriceConfidence = matches[0]?.price_confidence || 0;
            finalPriceRange = matches[0]?.price_range || null;
            pricingSource = 'best_match';
          }

          // Try AI enhancement if enabled
          if (useAI) {
            aiPricing = await getAIPricingRecommendation(sourceQuote, matches, { useAI }, routeDistance);
            if (aiPricing && aiPricing.recommended_price) {
              finalSuggestedPrice = aiPricing.recommended_price;
              finalPriceConfidence = (aiPricing.confidence_percentage ?? 50) / 100;
              finalPriceRange = { low: aiPricing.floor_price!, high: aiPricing.ceiling_price! };
              pricingSource = 'ai_enhanced';
              console.log(`    AI Price: $${aiPricing.recommended_price.toLocaleString()} (${aiPricing.confidence_percentage ?? 50}%)`);

              // Save AI pricing recommendation to dedicated table
              await db.saveAIPricingRecommendation(quoteId, sourceQuote.email_id, aiPricing);
            }
          }

          const matchesToInsert = matches.map((m, idx) => ({
            sourceQuoteId: m.sourceQuoteId,
            matchedQuoteId: m.matchedQuoteId,
            similarityScore: m.similarity_score,
            matchCriteria: m.match_criteria,
            suggestedPrice: idx === 0 ? finalSuggestedPrice : m.suggested_price,
            priceConfidence: idx === 0 ? finalPriceConfidence : m.price_confidence,
            algorithmVersion: useAI ? 'v3-statistical-ai' : 'v3-statistical',
            aiPricingDetails: idx === 0 && aiPricing ? {
              recommended_price: aiPricing.recommended_price,
              floor_price: aiPricing.floor_price,
              target_price: aiPricing.target_price,
              ceiling_price: aiPricing.ceiling_price,
              confidence_percentage: aiPricing.confidence_percentage,
              reasoning: aiPricing.reasoning,
            } : null,
          }));

          await db.createQuoteMatchesBulk(matchesToInsert);
          results.matchesCreated += matches.length;

          console.log(`    Found ${matches.length} matches (source: ${pricingSource})`);
          console.log(`    Best match: Score ${matches[0]?.similarity_score.toFixed(2)}, Suggested Price: $${finalSuggestedPrice?.toLocaleString() || 'N/A'}`);

          results.matchDetails.push({
            quoteId,
            matchCount: matches.length,
            bestScore: matches[0]?.similarity_score || 0,
            suggestedPrice: finalSuggestedPrice,
            priceRange: finalPriceRange,
            aiPricing: aiPricing || undefined,
          });
        } else {
          // NO MATCHES FOUND - Try AI pricing first, then fallback
          console.log(`    No matches found (minScore: ${minScore}) - attempting AI pricing without historical data`);

          // Try AI pricing even without matches - AI can use market knowledge
          if (useAI) {
            aiPricing = await getAIPricingRecommendation(sourceQuote, [], { useAI }, routeDistance);
            if (aiPricing && aiPricing.recommended_price) {
              finalSuggestedPrice = aiPricing.recommended_price;
              // For AI without history, use slightly lower confidence multipliers
              const aiConfPct = aiPricing.confidence_percentage ?? 50;
              finalPriceConfidence = aiConfPct >= 80 ? 0.7 : aiConfPct >= 60 ? 0.5 : 0.4;
              finalPriceRange = { low: aiPricing.floor_price!, high: aiPricing.ceiling_price! };
              pricingSource = 'ai_no_history';
              console.log(`    AI Price (no history): $${aiPricing.recommended_price.toLocaleString()} (${aiConfPct}%)`);

              // Save AI pricing recommendation to dedicated table
              await db.saveAIPricingRecommendation(quoteId, sourceQuote.email_id, aiPricing);

              results.matchDetails.push({
                quoteId,
                matchCount: 0,
                bestScore: 0,
                suggestedPrice: finalSuggestedPrice,
                priceRange: finalPriceRange,
                aiPricing: aiPricing,
              });
            }
          }

          // If AI pricing failed or not enabled, use fallback
          if (!aiPricing || !aiPricing.recommended_price) {
            const fallbackPricing = calculateFallbackPricing(sourceQuote, sourceDistanceMiles);
            finalSuggestedPrice = fallbackPricing.price;
            finalPriceConfidence = fallbackPricing.confidence_percentage / 100;
            finalPriceRange = fallbackPricing.priceRange;
            pricingSource = 'fallback';

            console.log(`    Fallback Price: $${fallbackPricing.price.toLocaleString()} (${fallbackPricing.confidence_percentage}%)`);
            console.log(`    Breakdown: ${fallbackPricing.reasoning}`);

            results.matchDetails.push({
              quoteId,
              matchCount: 0,
              bestScore: 0,
              suggestedPrice: finalSuggestedPrice,
              priceRange: finalPriceRange,
              aiPricing: {
                recommended_price: fallbackPricing.price,
                floor_price: fallbackPricing.priceRange.low,
                target_price: fallbackPricing.price,
                ceiling_price: fallbackPricing.priceRange.high,
                confidence_percentage: fallbackPricing.confidence_percentage,
                reasoning: `[FALLBACK] ${fallbackPricing.reasoning}`,
              },
            });
          }
        }

        results.processed++;
      } catch (error) {
        const err = error as Error;
        console.error(`  Error processing quote ${quoteId}:`, err.message);
        results.errors.push({ quoteId, error: err.message });
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`Matching complete: ${results.processed} processed, ${results.matchesCreated} matches created`);
    console.log('='.repeat(70) + '\n');

  } catch (error) {
    const err = error as Error;
    console.error('Error in enhanced matching service:', err);
    results.errors.push({ error: err.message });
  }

  return results;
}

// Feedback Learning System
let learnedWeightAdjustments: Record<string, number> | null = null;
let lastWeightRefresh: number | null = null;
const WEIGHT_CACHE_TTL = 5 * 60 * 1000;

interface LearningContext {
  isInternational?: boolean;
  cargoCategory?: string;
  isHazmat?: boolean;
}

async function getLearnedWeights(context: LearningContext = {}): Promise<Record<string, number>> {
  if (learnedWeightAdjustments && lastWeightRefresh && (Date.now() - lastWeightRefresh < WEIGHT_CACHE_TTL)) {
    return applyContextualAdjustments(learnedWeightAdjustments, context);
  }

  try {
    const client = await db.pool.connect();
    try {
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'matching_weight_adjustments'
        )
      `);

      if (!tableCheck.rows[0].exists) {
        return { ...ENHANCED_WEIGHTS };
      }

      const result = await client.query(`
        SELECT criteria_name, adjusted_weight, adjustment_factor, context_filter
        FROM matching_weight_adjustments
        WHERE algorithm_version = 'v2-enhanced'
        ORDER BY last_calculated_at DESC
      `);

      if (result.rows.length === 0) {
        return { ...ENHANCED_WEIGHTS };
      }

      const adjustedWeights: Record<string, number> = { ...ENHANCED_WEIGHTS };
      for (const row of result.rows) {
        if (adjustedWeights[row.criteria_name] !== undefined) {
          adjustedWeights[row.criteria_name] = parseFloat(row.adjusted_weight);
        }
      }

      learnedWeightAdjustments = adjustedWeights;
      lastWeightRefresh = Date.now();

      return applyContextualAdjustments(adjustedWeights, context);
    } finally {
      client.release();
    }
  } catch (error) {
    const err = error as Error;
    console.error('Error loading learned weights:', err.message);
    return { ...ENHANCED_WEIGHTS };
  }
}

function applyContextualAdjustments(baseWeights: Record<string, number>, context: LearningContext): Record<string, number> {
  const adjusted = { ...baseWeights };

  if (context.isInternational) {
    adjusted.origin_region = (adjusted.origin_region || 0) * 1.2;
    adjusted.destination_region = (adjusted.destination_region || 0) * 1.2;
    adjusted.service_type = (adjusted.service_type || 0) * 0.9;
  }

  if (context.cargoCategory === 'MACHINERY') {
    adjusted.cargo_category = (adjusted.cargo_category || 0) * 1.3;
    adjusted.cargo_weight_range = (adjusted.cargo_weight_range || 0) * 1.2;
  }

  if (context.isHazmat) {
    adjusted.hazmat = (adjusted.hazmat || 0) * 2.0;
  }

  const total = Object.values(adjusted).reduce((sum, w) => sum + w, 0);
  for (const key of Object.keys(adjusted)) {
    adjusted[key] = adjusted[key]! / total;
  }

  return adjusted;
}

interface LearnFromFeedbackResult {
  success: boolean;
  message?: string;
  adjustments?: number;
  error?: string;
}

async function learnFromFeedback(): Promise<LearnFromFeedbackResult> {
  const client = await db.pool.connect();
  try {
    console.log('\nLearning from feedback...');

    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'matching_weight_adjustments'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('  Weight adjustments table not created yet. Run migration 003 first.');
      return { success: false, message: 'Table not found' };
    }

    const feedbackStats = await client.query(`
      SELECT
        key as criteria_name,
        COUNT(*) as total_matches,
        SUM(CASE WHEN f.rating = 1 THEN 1 ELSE 0 END) as positive_count,
        SUM(CASE WHEN f.rating = -1 THEN 1 ELSE 0 END) as negative_count,
        AVG(CASE WHEN f.rating = 1 THEN (value::numeric) ELSE NULL END) as avg_score_when_positive,
        AVG(CASE WHEN f.rating = -1 THEN (value::numeric) ELSE NULL END) as avg_score_when_negative
      FROM quote_matches m
      CROSS JOIN LATERAL jsonb_each_text(m.match_criteria)
      INNER JOIN ai_pricing_recommendations apr ON m.source_quote_id = apr.quote_id
      INNER JOIN quote_ai_price_feedback f ON apr.id = f.ai_price_id
      WHERE m.match_algorithm_version = 'v2-enhanced'
      GROUP BY key
      HAVING COUNT(*) >= 5
    `);

    if (feedbackStats.rows.length === 0) {
      console.log('  Not enough feedback data yet (need at least 5 per criteria)');
      return { success: true, message: 'Insufficient feedback data', adjustments: 0 };
    }

    let adjustmentsApplied = 0;

    for (const row of feedbackStats.rows) {
      const positiveRate = row.positive_count / row.total_matches;
      const avgPosScore = parseFloat(row.avg_score_when_positive) || 0;
      const avgNegScore = parseFloat(row.avg_score_when_negative) || 0;

      let adjustmentFactor = 1.0;

      if (avgPosScore > avgNegScore + 0.1 && positiveRate > 0.6) {
        adjustmentFactor = 1.15;
      } else if (avgPosScore < avgNegScore && positiveRate < 0.4) {
        adjustmentFactor = 0.85;
      } else if (avgNegScore > avgPosScore + 0.1) {
        adjustmentFactor = 0.90;
      }

      const baseWeight = ENHANCED_WEIGHTS[row.criteria_name] || 0.1;
      const adjustedWeight = Math.max(0.01, Math.min(0.5, baseWeight * adjustmentFactor));

      await client.query(`
        INSERT INTO matching_weight_adjustments (
          criteria_name, base_weight, adjusted_weight, adjustment_factor,
          positive_feedback_count, negative_feedback_count, total_matches_count,
          algorithm_version, last_calculated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'v2-enhanced', NOW())
        ON CONFLICT (criteria_name, algorithm_version, context_filter)
        DO UPDATE SET
          adjusted_weight = $3,
          adjustment_factor = $4,
          positive_feedback_count = $5,
          negative_feedback_count = $6,
          total_matches_count = $7,
          last_calculated_at = NOW()
      `, [
        row.criteria_name,
        baseWeight,
        adjustedWeight,
        adjustmentFactor,
        row.positive_count,
        row.negative_count,
        row.total_matches
      ]);

      if (adjustmentFactor !== 1.0) {
        console.log(`  ${row.criteria_name}: ${baseWeight.toFixed(3)} -> ${adjustedWeight.toFixed(3)} (${adjustmentFactor > 1 ? '+' : ''}${((adjustmentFactor - 1) * 100).toFixed(0)}%)`);
        adjustmentsApplied++;
      }
    }

    learnedWeightAdjustments = null;
    lastWeightRefresh = null;

    console.log(`\n  Applied ${adjustmentsApplied} weight adjustments based on feedback`);

    return { success: true, adjustments: adjustmentsApplied };
  } catch (error) {
    const err = error as Error;
    console.error('Error learning from feedback:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

async function suggestPriceWithFeedback(sourceQuote: Quote, matches: ExtendedQuoteMatch[]): Promise<SmartPricing | null> {
  if (!matches || matches.length === 0) {
    return null;
  }

  const originRegion = getUSRegion(sourceQuote.origin_city, sourceQuote.origin_state_province) ||
                      getIntlRegion(sourceQuote.origin_country);
  const destRegion = getUSRegion(sourceQuote.destination_city, sourceQuote.destination_state_province) ||
                    getIntlRegion(sourceQuote.destination_country);
  const serviceType = normalizeServiceType(sourceQuote.service_type);

  const validMatches = matches.filter(m => m.suggested_price && m.suggested_price > 0);
  if (validMatches.length === 0) return null;

  const totalWeight = validMatches.reduce((sum, m) => sum + m.similarity_score * (m.price_confidence || 0), 0);
  const weightedAvg = validMatches.reduce((sum, m) =>
    sum + (m.suggested_price || 0) * m.similarity_score * (m.price_confidence || 0), 0) / totalWeight;

  const adjustedPrice = weightedAvg;
  const adjustmentReason: string[] = [];

  const prices = validMatches.map(m => m.suggested_price || 0);

  return {
    suggestedPrice: Math.round(adjustedPrice),
    matchBasedPrice: Math.round(weightedAvg),
    priceRange: {
      low: Math.round(Math.min(...prices) * 0.9),
      high: Math.round(Math.max(...prices) * 1.1),
    },
    confidence: Math.round((totalWeight / validMatches.length) * 100) / 100,
    matchCount: validMatches.length,
    laneStats: null,
    adjustments: adjustmentReason,
  };
}

/**
 * Get distance category for pricing
 */
function getDistanceCategory(distanceMiles: number): string {
  if (distanceMiles <= 50) return 'Local (0-50 miles)';
  if (distanceMiles <= 100) return 'Short Haul (50-100 miles)';
  if (distanceMiles <= 200) return 'Medium Haul (100-200 miles)';
  if (distanceMiles <= 350) return 'Extended (200-350 miles)';
  if (distanceMiles <= 500) return 'Long Haul (350-500 miles)';
  return 'Regional/Cross-Country (500+ miles)';
}
/**
 * Generate pricing recommendation prompt for AI
 * Uses centralized PRICING_RECOMMENDATION_PROMPT from shippingQuotePrompts.ts
 * @param sourceQuote - The new quote being priced
 * @param topMatches - Historical similar quotes for reference
 * @param routeDistance - Calculated route distance (optional)
 */
function generatePricingPrompt(
  sourceQuote: Quote,
  topMatches: ExtendedQuoteMatch[],
  routeDistance?: RouteDistance | null,
  algorithmicRecommendation?: AIPricingDetails | null
): string {
  // Calculate feedback summary stats
  const matchesWithFeedback = topMatches.filter(m => m.feedbackData && m.feedbackData.total_feedback_count > 0);
  const matchesWithVerifiedPrices = topMatches.filter(m => m.feedbackData?.actual_prices_used && m.feedbackData.actual_prices_used.length > 0);

  // Historical price stats (stability + outlier detection)
  const numericPrices = topMatches
    .map(m => (typeof m.suggested_price === 'number' ? m.suggested_price : null))
    .filter((p): p is number => Number.isFinite(p) && p > 0);

  const median = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  };

  const mean = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  };

  const trimmedMean = (arr: number[], trimPctEachSide = 0.2): number | null => {
    if (arr.length < 3) return mean(arr);
    const sorted = [...arr].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * trimPctEachSide);
    const trimmed = sorted.slice(k, Math.max(k + 1, sorted.length - k));
    return mean(trimmed);
  };

  const stddev = (arr: number[]): number | null => {
    if (arr.length < 2) return null;
    const m = mean(arr)!;
    const variance = arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
  };

  // Unit conversion helpers for consistent AI prompt formatting
  const toNumberOrNull = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[$,\s]/g, '');
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const convertToLbs = (weight: unknown, unit: string | null | undefined): number | null => {
    const w = toNumberOrNull(weight);
    if (w === null || w <= 0) return null;
    const unitLower = (unit || 'lbs').toLowerCase();
    if (unitLower.includes('kg') || unitLower === 'kgs' || unitLower === 'kilogram') {
      return Math.round(w * 2.20462 * 100) / 100; // kg to lbs
    }
    if (unitLower.includes('ton') || unitLower === 't' || unitLower === 'mt') {
      return Math.round(w * 2204.62 * 100) / 100; // metric tons to lbs
    }
    return w; // assume lbs
  };

  const convertToFeetInches = (dim: unknown, unit: string | null | undefined): string | null => {
    const d = toNumberOrNull(dim);
    if (d === null || d <= 0) return null;
    const unitLower = (unit || '').toLowerCase();

    let inches: number;
    if (unitLower === 'cm' || unitLower === 'centimeter' || unitLower === 'centimeters') {
      inches = d / 2.54; // cm to inches
    } else if (unitLower === 'm' || unitLower === 'meter' || unitLower === 'meters') {
      inches = d * 39.3701; // meters to inches
    } else if (unitLower === 'mm' || unitLower === 'millimeter' || unitLower === 'millimeters') {
      inches = d / 25.4; // mm to inches
    } else if (unitLower === 'ft' || unitLower === 'feet' || unitLower === 'foot') {
      inches = d * 12; // feet to inches
    } else {
      // assume inches
      inches = d;
    }

    const feet = Math.floor(inches / 12);
    const remainingInches = Math.round(inches % 12);

    if (feet === 0) {
      return `${remainingInches}"`;
    } else if (remainingInches === 0) {
      return `${feet}'`;
    }
    return `${feet}'${remainingInches}"`;
  };

  // Convert source quote weight and dimensions for the prompt
  const sourceWeightLbs = convertToLbs(sourceQuote.cargo_weight, sourceQuote.weight_unit);
  const sourceLengthFtIn = convertToFeetInches(sourceQuote.cargo_length, sourceQuote.dimension_unit);
  const sourceWidthFtIn = convertToFeetInches(sourceQuote.cargo_width, sourceQuote.dimension_unit);
  const sourceHeightFtIn = convertToFeetInches(sourceQuote.cargo_height, sourceQuote.dimension_unit);
  const sourceDimensionsStr = (sourceLengthFtIn && sourceWidthFtIn && sourceHeightFtIn)
    ? `${sourceLengthFtIn} × ${sourceWidthFtIn} × ${sourceHeightFtIn}`
    : 'Not specified';

  const minP = numericPrices.length ? Math.min(...numericPrices) : null;
  const maxP = numericPrices.length ? Math.max(...numericPrices) : null;
  const medP = median(numericPrices);
  const avgP = mean(numericPrices);
  const tmeanP = trimmedMean(numericPrices, 0.2);
  const sdP = stddev(numericPrices);

  const bestMatch = topMatches[0];
  const bestMatchPrice = typeof bestMatch?.suggested_price === 'number' ? bestMatch.suggested_price : null;
  const bestVsMedianRatio = bestMatchPrice && medP ? Math.round((bestMatchPrice / medP) * 100) / 100 : null;

  const outlierWarning = (bestMatchPrice && medP)
    ? (bestMatchPrice < medP * 0.6
      ? 'Best match price looks TOO LOW vs median (possible mismatch, partial price, or unit/charge scope mismatch).'
      : bestMatchPrice > medP * 1.8
        ? 'Best match price looks TOO HIGH vs median (possible mismatch or included charges not comparable).'
        : null)
    : null;

  const historicalPriceStatsBlock = numericPrices.length > 0
    ? `
## HISTORICAL PRICE STATS (from top matches)
- count_prices: ${numericPrices.length}
- best_match_price: ${bestMatchPrice ?? 'N/A'}
- min_price: ${minP ?? 'N/A'}
- median_price: ${medP ?? 'N/A'}
- avg_price: ${avgP ? Math.round(avgP) : 'N/A'}
- trimmed_mean_price: ${tmeanP ? Math.round(tmeanP) : 'N/A'}
- max_price: ${maxP ?? 'N/A'}
- stddev_price: ${sdP ? Math.round(sdP) : 'N/A'}
- best_vs_median_ratio: ${bestVsMedianRatio ?? 'N/A'}
${outlierWarning ? `- outlier_warning: ${outlierWarning}` : ''}

STABILITY / ANTI-ANCHORING:
- Prefer median/trimmed_mean as the primary historical anchor when matches disagree.
- If outlier_warning is present, downweight the best match heavily.
`
    : '';

  // Format historical matches for prompt context (aligned to formatHistoricalMatches expectations)
  const historicalMatchesForPrompt = topMatches.slice(0, 5).map((m) => ({
    score: m.similarity_score,
    quote: {
      origin: m.matchedQuoteData?.origin || 'Unknown',
      destination: m.matchedQuoteData?.destination || 'Unknown',
      serviceType: m.matchedQuoteData?.service || 'Not specified',
      distanceMiles: m.matchedQuoteData?.distanceMiles ?? undefined,
      weight: m.matchedQuoteData?.weight ?? undefined,
      weightUnit: m.matchedQuoteData?.weightUnit ?? undefined,
      length: m.matchedQuoteData?.length ?? undefined,
      width: m.matchedQuoteData?.width ?? undefined,
      height: m.matchedQuoteData?.height ?? undefined,
      dimensionUnit: m.matchedQuoteData?.dimensionUnit ?? undefined,
      containerType: detectContainerType(m.matchedQuoteData?.cargo, m.matchedQuoteData?.service) || undefined,
      commodity: m.matchedQuoteData?.cargo || 'Not specified',
      quotedPrice: m.matchedQuoteData?.initialPrice ?? null,
      finalPrice: m.matchedQuoteData?.finalPrice ?? null,
      specialRequirements: undefined,
    },
    feedback: m.feedbackData ? {
      won: m.feedbackData.positive_feedback_count > m.feedbackData.negative_feedback_count,
      customerResponse: `thumbs_up=${m.feedbackData.positive_feedback_count}, thumbs_down=${m.feedbackData.negative_feedback_count}`,
      actualPrice: (m.feedbackData.actual_prices_used && m.feedbackData.actual_prices_used.length > 0)
        ? m.feedbackData.actual_prices_used[m.feedbackData.actual_prices_used.length - 1]
        : null,
      // Include detailed feedback data for AI learning
      positive_feedback_count: m.feedbackData.positive_feedback_count,
      negative_feedback_count: m.feedbackData.negative_feedback_count,
      feedback_reasons: m.feedbackData.feedback_reasons || [],
      feedback_notes: m.feedbackData.feedback_notes || [],
      actual_prices_used: m.feedbackData.actual_prices_used || [],
    } : null,
  }));

  // Get the centralized pricing recommendation prompt with historical matches
  const basePrompt = getPromptForTask('recommend_price', {
    historicalMatches: historicalMatchesForPrompt,
  });

  // Build distance info string
  const distanceInfo = routeDistance
    ? `
- **Route Distance**: ${routeDistance.distanceMiles} miles (${routeDistance.distanceKm} km)
- **Estimated Transit Time**: ${routeDistance.durationText}
- **Distance Category**: ${getDistanceCategory(routeDistance.distanceMiles)}`
    : sourceQuote.total_distance_miles
    ? `
- **Route Distance**: ${sourceQuote.total_distance_miles} miles (from database)`
    : '';

  // Build quote details section with full OOG analysis and trailer suggestion
  const oogAnalysis = analyzeOOGCargo(
    sourceQuote.cargo_description, sourceQuote.cargo_height, sourceQuote.cargo_width,
    sourceQuote.cargo_length, sourceQuote.cargo_weight, sourceQuote.dimension_unit, sourceQuote.weight_unit
  );
  const isOOG = oogAnalysis.isOOG;
  const trailerSuggestion = getBestTrailer(
    sourceQuote.cargo_height, sourceQuote.cargo_width, sourceQuote.cargo_length,
    sourceQuote.cargo_weight, sourceQuote.dimension_unit, sourceQuote.weight_unit, sourceQuote.cargo_description
  );
  const sourceCargoCategory = classifyCargo(sourceQuote.cargo_description);
  const sourceMiles = routeDistance?.distanceMiles ?? (typeof sourceQuote.total_distance_miles === 'number' ? sourceQuote.total_distance_miles : null);

  const hasMissingOrZeroWeight = !sourceQuote.cargo_weight || Number(sourceQuote.cargo_weight) <= 0;
  const hasMissingOrZeroDims =
    !sourceQuote.cargo_length || Number(sourceQuote.cargo_length) <= 0 ||
    !sourceQuote.cargo_width || Number(sourceQuote.cargo_width) <= 0 ||
    !sourceQuote.cargo_height || Number(sourceQuote.cargo_height) <= 0;

  const projectCargoLongHaulMissingSpecsNote =
    (sourceCargoCategory === 'MACHINERY' || sourceCargoCategory === 'OVERSIZED') &&
    typeof sourceMiles === 'number' &&
    sourceMiles >= 400 &&
    (hasMissingOrZeroWeight || hasMissingOrZeroDims)
      ? `
## PROJECT CARGO PRICING NOTE (IMPORTANT)
- Cargo category appears to be ${sourceCargoCategory} on a long-haul route.
- Weight/dimensions are missing/zero; do NOT assume light/general freight.
- When applying per-mile project cargo logic, avoid selecting the minimum rate unless the quote explicitly indicates an easy/light load.
- Include a risk buffer for unknown specs (equipment type, permits, loading constraints, accessorials).
`
      : '';
  const baselineInfo = algorithmicRecommendation?.recommended_price
    ? `
## ALGORITHMIC BASELINE (REFERENCE, NOT A HARD ANCHOR)
- recommended_price: $${algorithmicRecommendation.recommended_price.toLocaleString()}
- floor_price: ${algorithmicRecommendation.floor_price ? '$' + algorithmicRecommendation.floor_price.toLocaleString() : 'N/A'}
- ceiling_price: ${algorithmicRecommendation.ceiling_price ? '$' + algorithmicRecommendation.ceiling_price.toLocaleString() : 'N/A'}
- confidence: ${algorithmicRecommendation.confidence_percentage ? algorithmicRecommendation.confidence_percentage + '%' : 'N/A'}
- reasoning: ${algorithmicRecommendation.reasoning || 'N/A'}

CONSTRAINTS:
- Your recommended_quote.initial_amount MUST be within [floor_price, ceiling_price] when those are present.
- If floor/ceiling are missing, stay within ±20% of recommended_price unless you cite a specific factor present in the NEW QUOTE REQUEST.
- Return ONLY valid JSON exactly matching the OUTPUT FORMAT (no prose, no markdown, no $ signs in numeric fields).
`
    : `
CONSTRAINTS:
- Return ONLY valid JSON exactly matching the OUTPUT FORMAT (no prose, no markdown, no $ signs in numeric fields).
`;

  const quoteDetails = `
## NEW QUOTE REQUEST
- **Route**: ${sourceQuote.origin_city || 'Unknown'}, ${sourceQuote.origin_state_province || ''} ${sourceQuote.origin_country || ''} → ${sourceQuote.destination_city || 'Unknown'}, ${sourceQuote.destination_state_province || ''} ${sourceQuote.destination_country || ''}${distanceInfo}
- **Origin Address**: ${sourceQuote.origin_full_address || 'Not specified'}
- **Origin Postal Code**: ${sourceQuote.origin_postal_code || 'Not specified'}
- **Origin Facility Type**: ${sourceQuote.origin_facility_type || 'Not specified'}
- **Destination Address**: ${sourceQuote.destination_full_address || 'Not specified'}
- **Destination Postal Code**: ${sourceQuote.destination_postal_code || 'Not specified'}
- **Destination Facility Type**: ${sourceQuote.destination_facility_type || 'Not specified'}
- **Requested Pickup Date**: ${sourceQuote.requested_pickup_date || 'Not specified'}
- **Pickup Time Window**: ${sourceQuote.pickup_time_window || 'Not specified'}
- **Pickup Special Requirements**: ${sourceQuote.pickup_special_requirements || 'Not specified'}
- **Requested Delivery Date**: ${sourceQuote.requested_delivery_date || 'Not specified'}
- **Delivery Time Window**: ${sourceQuote.delivery_time_window || 'Not specified'}
- **Delivery Special Requirements**: ${sourceQuote.delivery_special_requirements || 'Not specified'}
- **Service Type**: ${sourceQuote.service_type || 'Not specified'}
- **Service Level**: ${sourceQuote.service_level || 'Not specified'}
- **Incoterms**: ${sourceQuote.incoterms || 'Not specified'}
- **Customs Clearance Needed**: ${sourceQuote.customs_clearance_needed ? 'Yes' : 'No/Not specified'}
- **Cargo Description**: ${sourceQuote.cargo_description || 'Not specified'}
- **Weight**: ${sourceWeightLbs ? `${sourceWeightLbs.toLocaleString()} lbs` : 'Not specified'}
- **Pieces**: ${sourceQuote.number_of_pieces || 'Not specified'}
- **Hazmat**: ${sourceQuote.hazardous_material ? 'Yes' : 'No'}
- **Hazmat Class / UN**: ${sourceQuote.hazmat_class || 'Not specified'} / ${sourceQuote.hazmat_un_number || 'Not specified'}
- **Temperature Controlled**: ${sourceQuote.temperature_controlled ? 'Yes' : 'No/Not specified'}
- **Temperature Range**: ${sourceQuote.temperature_range || 'Not specified'}
- **Declared Value**: ${sourceQuote.declared_value ? `${sourceQuote.declared_value} ${sourceQuote.declared_value_currency || ''}` : 'Not specified'}
- **Packaging Type**: ${sourceQuote.packaging_type || 'Not specified'}
- **Dimensions (L×W×H)**: ${sourceDimensionsStr}
- **Overweight/Oversize Flags**: overweight=${sourceQuote.is_overweight ? 'Yes' : 'No/Not specified'}, oversized=${sourceQuote.is_oversized ? 'Yes' : 'No/Not specified'}
- **Permits / Pilot Car / Tarping**: permits=${sourceQuote.requires_permits ? 'Yes' : 'No/Not specified'}, pilot_car=${sourceQuote.requires_pilot_car ? 'Yes' : 'No/Not specified'}, tarping=${sourceQuote.requires_tarping ? 'Yes' : 'No/Not specified'}
- **Equipment Requested**: ${sourceQuote.equipment_type_requested || 'Not specified'}
- **Equipment Quoted**: ${sourceQuote.equipment_type_quoted || 'Not specified'}
- **Trailer Length Required**: ${sourceQuote.trailer_length_required || 'Not specified'}
- **Load Type**: ${sourceQuote.load_type || 'Not specified'}
- **Container Type**: ${detectContainerType(sourceQuote.cargo_description, sourceQuote.service_type) || 'Standard/Not specified'}
- **OOG (Out of Gauge)**: ${isOOG ? 'YES - Apply 1.35-1.45x pricing multiplier' : 'No'}${oogAnalysis.reasons.length > 0 ? ` (${oogAnalysis.reasons.join('; ')})` : ''}
- **Requires Permits**: ${oogAnalysis.requiresPermits ? 'YES - Oversize permits required' : 'No/Not determined'}
- **Requires Pilot Car**: ${oogAnalysis.requiresPilotCar ? 'YES - Width exceeds 12ft' : 'No/Not determined'}
- **Suggested Trailer**: ${trailerSuggestion ? `${trailerSuggestion.trailer.name} (fit score: ${trailerSuggestion.fitScore}/100)` : 'Unable to determine'}${trailerSuggestion?.reasons.length ? ` - ${trailerSuggestion.reasons.slice(0, 2).join(', ')}` : ''}${trailerSuggestion?.warnings.length ? ` ⚠️ ${trailerSuggestion.warnings.join(', ')}` : ''}
${isOOG ? `
**IMPORTANT OOG PRICING NOTE**: This cargo is Out of Gauge (OOG). Based on learned feedback:
- Open Top containers command +35-45% premium over standard containers
- OOG ground transport requires flatbed/step-deck trailers (+15-25% premium)
- State permits may be required ($50-300+ per state)
- Apply minimum 1.35-1.45x multiplier to base rates
` : ''}${routeDistance ? `
**DISTANCE-BASED PRICING GUIDANCE**:
- Use the actual route distance of **${routeDistance.distanceMiles} miles** to calculate mileage-based rates
- For Ground/FTL: Apply per-mile rate × ${routeDistance.distanceMiles} miles + fuel surcharge
- For Drayage: Use distance category "${getDistanceCategory(routeDistance.distanceMiles)}" for base rate reference
- Estimated transit: ${routeDistance.durationText}
` : ''}

${projectCargoLongHaulMissingSpecsNote}
${matchesWithFeedback.length > 0 ? `
## FEEDBACK INSIGHTS
- **Matches with User Feedback**: ${matchesWithFeedback.length} of ${topMatches.slice(0, 5).length}
- **Matches with Verified Actual Prices**: ${matchesWithVerifiedPrices.length}
${matchesWithVerifiedPrices.length > 0 ? `
**IMPORTANT**: Matches with verified actual prices should be weighted more heavily as these represent real-world pricing accepted by customers.
` : ''}` : ''}

${historicalPriceStatsBlock}

${baselineInfo}

## YOUR TASK
${topMatches.length > 0
  ? 'Use the historical matches plus the baseline to produce a competitive but realistic total quote.'
  : `**NO HISTORICAL MATCHES AVAILABLE** - You must price this quote using your knowledge of freight market rates.

MARKET-BASED PRICING GUIDANCE:
- For Ground/FTL freight: $2.00-$4.50 per mile depending on equipment, cargo type, and market conditions
- For Drayage (port moves): $400-$1200 base + $3-5/mile for distances over 50 miles
- For LTL: Consider weight, class, and distance-based tariffs
- For specialized equipment (flatbed, step-deck, RGN): Add 15-40% premium over dry van rates
- For hazmat: Add $300-600 base + 15-25% premium
- For temperature-controlled: Add 20-35% premium over dry van
- For OOG/oversized: Add 35-50% premium + permit costs ($50-300/state)

Consider the route distance, cargo characteristics, service type, and any special requirements when pricing.
Since there is no historical data, set confidence to "LOW" and provide wider floor-to-ceiling spreads.`}
`;

  return `${basePrompt}

${quoteDetails}`;
}

interface PricingOutcome {
  suggestedPrice?: number;
  priceConfidence?: number;
  matchCount?: number;
  topMatchScore?: number;
  actualPriceQuoted?: number;
  actualPriceAccepted?: number;
  jobWon?: boolean;
}

interface PricingHistoryRow {
  id: number;
  quote_id: number;
  suggested_price: number | null;
  price_confidence: number | null;
  match_count: number | null;
  top_match_score: number | null;
  actual_price_quoted: number | null;
  actual_price_accepted: number | null;
  job_won: boolean | null;
  normalized_service_type: string | null;
  cargo_category: string | null;
  origin_region: string | null;
  destination_region: string | null;
  weight_range: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Record pricing outcome for future learning
 */
async function recordPricingOutcome(quoteId: number, outcome: PricingOutcome): Promise<PricingHistoryRow | null> {
  const client = await db.pool.connect();
  try {
    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'pricing_history'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('Pricing history table not created yet. Run migration 003 first.');
      return null;
    }

    const {
      suggestedPrice,
      priceConfidence,
      matchCount,
      topMatchScore,
      actualPriceQuoted,
      actualPriceAccepted,
      jobWon,
    } = outcome;

    // Get quote details for analysis
    const quote = await db.getQuoteForMatching(quoteId);
    if (!quote) return null;

    const normalizedService = normalizeServiceType(quote.service_type);
    const cargoCategory = classifyCargo(quote.cargo_description);
    const originRegion = getUSRegion(quote.origin_city, quote.origin_state_province) ||
                        getIntlRegion(quote.origin_country);
    const destRegion = getUSRegion(quote.destination_city, quote.destination_state_province) ||
                      getIntlRegion(quote.destination_country);
    const weightRange = getWeightRange(quote.cargo_weight, quote.weight_unit);

    const result = await client.query<PricingHistoryRow>(`
      INSERT INTO pricing_history (
        quote_id, suggested_price, price_confidence, match_count, top_match_score,
        actual_price_quoted, actual_price_accepted, job_won,
        normalized_service_type, cargo_category, origin_region, destination_region, weight_range
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (quote_id)
      DO UPDATE SET
        actual_price_quoted = COALESCE($6, pricing_history.actual_price_quoted),
        actual_price_accepted = COALESCE($7, pricing_history.actual_price_accepted),
        job_won = COALESCE($8, pricing_history.job_won),
        updated_at = NOW()
      RETURNING *
    `, [
      quoteId,
      suggestedPrice,
      priceConfidence,
      matchCount,
      topMatchScore,
      actualPriceQuoted,
      actualPriceAccepted,
      jobWon,
      normalizedService,
      cargoCategory,
      originRegion,
      destRegion,
      weightRange?.label
    ]);

    return result.rows[0];
  } catch (error) {
    console.error('Error recording pricing outcome:', (error as Error).message);
    return null;
  } finally {
    client.release();
  }
}

export {
  // Main processing functions
  processEnhancedMatches,
  findEnhancedMatches,
  calculateEnhancedSimilarity,
  suggestPriceEnhanced,
  getAIPricingRecommendation,

  // Normalization and classification
  normalizeServiceType,
  classifyCargo,
  getWeightRange,
  getUSRegion,
  getIntlRegion,
  detectContainerType,
  detectEquipmentType,
  isOOGCargo,
  analyzeOOGCargo,
  suggestTrailer,
  getBestTrailer,
  convertToFeet,
  convertToLbs,

  // Trailer configuration
  TRAILER_CONFIGS,
  LEGAL_LIMITS,

  // Pricing functions
  calculateFallbackPricing,
  calculateStatisticalPricing,
  getContainerPricingMultiplier,
  suggestPriceWithFeedback,
  generatePricingPrompt,
  recordPricingOutcome,

  // Validation and filtering
  validateHistoricalQuote,
  filterHistoricalQuotes,
  detectAndRemoveOutliers,

  // Similarity calculations
  calculateCityMatchScore,
  calculateDistanceSimilarity,
  calculateQuoteDistance,
  getDistanceCategory,

  // Learning and feedback
  getLearnedWeights,
  learnFromFeedback,

  // Statistical helpers
  calculateMedian,
  calculateMean,
  calculateStdDev,
  calculatePercentile,

  // Constants
  ENHANCED_WEIGHTS,
  SERVICE_TYPE_MAPPING,
  CARGO_CATEGORIES,
  CONTAINER_PRICING_MULTIPLIERS,
  PRICE_SANITY_BOUNDS,
  BASE_RATES_PER_MILE,
  MINIMUM_CHARGES,
  REGIONAL_MULTIPLIERS,
  CARGO_MULTIPLIERS,
  EQUIPMENT_RATES,
};
