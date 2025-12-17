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
const ENHANCED_WEIGHTS: Record<string, number> = {
  origin_region: 0.08,
  origin_city: 0.04,
  destination_region: 0.10,
  destination_city: 0.04,
  cargo_category: 0.12,
  cargo_weight_range: 0.08,
  number_of_pieces: 0.03,
  service_type: 0.14,
  service_compatibility: 0.04,
  hazmat: 0.06,
  container_type: 0.04,
  recency: 0.06,
  distance_similarity: 0.20,
};

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
 * Check if cargo is OOG (Out of Gauge) based on description and dimensions
 */
function isOOGCargo(description: string | null | undefined, height: number | string | null | undefined, width: number | string | null | undefined): boolean {
  const text = (description || '').toLowerCase();

  // Check description for OOG indicators
  if (text.match(/\boog\b/) || text.includes('out of gauge') || text.includes('oversized') ||
      text.includes('overdimensional') || text.includes('overheight') || text.includes('overwidth') ||
      text.match(/\b40\s*ot\b/) || text.includes('open top') || text.includes('open-top') ||
      text.includes('top loaded') || text.includes('top-loaded')) {
    return true;
  }

  // Check dimensions (standard max height is 8.5ft/102in, max width is 8.5ft/102in)
  const heightNum = typeof height === 'string' ? parseFloat(height) : height;
  const widthNum = typeof width === 'string' ? parseFloat(width) : width;
  if (heightNum && heightNum > 102) return true;  // Assuming inches
  if (widthNum && widthNum > 102) return true;    // Assuming inches

  return false;
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
 * Calculate similarity between two route distances
 * Returns 1.0 for identical distances, decaying toward 0 as difference grows
 * Returns 0.4 if either distance is unavailable
 * 
 * TUNED: Uses softer linear decay so 50% difference = 0.5 score
 * Shipping prices correlate with distance but many other factors matter
 */
function calculateDistanceSimilarity(
  sourceDistance: number | null | undefined,
  historicalDistance: number | null | undefined
): number {
  // If either distance is unavailable, return moderate score (not too punitive)
  if (!sourceDistance || !historicalDistance || sourceDistance <= 0 || historicalDistance <= 0) {
    return 0.4;
  }

  // Calculate percentage difference
  const maxDist = Math.max(sourceDistance, historicalDistance);
  const minDist = Math.min(sourceDistance, historicalDistance);
  const diff = maxDist - minDist;
  const percentDiff = diff / maxDist;

  // Use banded scoring for more stable matches:
  // 0-10% diff = 1.0 (excellent match)
  // 10-25% diff = 0.85 (good match)
  // 25-50% diff = 0.65 (acceptable match)
  // 50-75% diff = 0.45 (weak match)
  // 75-100% diff = 0.25 (poor match)
  // >100% diff = 0.1 (very poor)
  if (percentDiff <= 0.10) return 1.0;
  if (percentDiff <= 0.25) return 0.85;
  if (percentDiff <= 0.50) return 0.65;
  if (percentDiff <= 0.75) return 0.45;
  if (percentDiff <= 1.00) return 0.25;
  return 0.1;
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
  criteria.origin_city = jaroWinklerSimilarity(sourceQuote.origin_city, historicalQuote.origin_city);

  totalScore += (criteria.origin_region || 0) * ENHANCED_WEIGHTS.origin_region!;
  totalScore += (criteria.origin_city || 0) * ENHANCED_WEIGHTS.origin_city!;
  totalWeight += ENHANCED_WEIGHTS.origin_region! + ENHANCED_WEIGHTS.origin_city!;

  // Destination Matching
  const sourceDestRegion = getUSRegion(sourceQuote.destination_city, sourceQuote.destination_state_province) ||
                           getIntlRegion(sourceQuote.destination_country);
  const histDestRegion = getUSRegion(historicalQuote.destination_city, historicalQuote.destination_state_province) ||
                         getIntlRegion(historicalQuote.destination_country);

  criteria.destination_region = sourceDestRegion && histDestRegion && sourceDestRegion === histDestRegion ? 1 : 0;
  criteria.destination_city = jaroWinklerSimilarity(sourceQuote.destination_city, historicalQuote.destination_city);

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

  // Drayage pricing is extremely distance-sensitive; don't mix in longer-haul ground on short routes.
  const compatible = (sourceService === 'DRAYAGE' && sourceIsShortHaul)
    ? ['DRAYAGE']
    : (SERVICE_COMPATIBILITY[sourceService] || []);

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

  // Cargo Matching
  const sourceCargoCat = classifyCargo(sourceQuote.cargo_description);
  const histCargoCat = classifyCargo(historicalQuote.cargo_description);

  const neutralCargoCats = new Set(['GENERAL', 'UNKNOWN']);
  criteria.cargo_category = sourceCargoCat === histCargoCat ? 1 :
                           (neutralCargoCats.has(sourceCargoCat) || neutralCargoCats.has(histCargoCat) ? 0.5 : 0);

  totalScore += (criteria.cargo_category || 0) * ENHANCED_WEIGHTS.cargo_category!;
  totalWeight += ENHANCED_WEIGHTS.cargo_category!;

  // Weight Matching - less strict to allow more matches
  const sourceWeightRange = getWeightRange(sourceQuote.cargo_weight, sourceQuote.weight_unit);
  const histWeightRange = getWeightRange(historicalQuote.cargo_weight, historicalQuote.weight_unit);

  if (sourceWeightRange && histWeightRange) {
    const weightDiff = Math.abs(WEIGHT_RANGES.indexOf(sourceWeightRange) - WEIGHT_RANGES.indexOf(histWeightRange));
    // TUNED: Softer penalties for weight class differences
    // Same: 1.0, ±1 class: 0.7, ±2 classes: 0.4, ±3+ classes: 0.2
    criteria.cargo_weight_range = weightDiff === 0 ? 1.0 :
                                  weightDiff === 1 ? 0.7 :
                                  weightDiff === 2 ? 0.4 : 0.2;
  } else {
    criteria.cargo_weight_range = 0.5; // Neutral default when weight unknown
  }

  totalScore += (criteria.cargo_weight_range || 0) * ENHANCED_WEIGHTS.cargo_weight_range!;
  totalWeight += ENHANCED_WEIGHTS.cargo_weight_range!;

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

  // Recency - less aggressive decay so 6-month old quotes still score well
  // New: half-life of 120 days (was 60), so 120-day old quotes score 0.5
  // This means 6-month old quotes score ~0.35 instead of ~0.12
  const quoteDate = historicalQuote.quote_date || historicalQuote.created_at;
  if (quoteDate) {
    const ageDays = (Date.now() - new Date(quoteDate).getTime()) / (1000 * 60 * 60 * 24);
    // Less aggressive decay: half-life of 120 days
    // 0 days = 1.0, 60 days = 0.71, 120 days = 0.5, 180 days = 0.35, 360 days = 0.12
    criteria.recency = Math.max(0.1, Math.pow(0.5, ageDays / 120));
  } else {
    criteria.recency = 0.4; // Slightly lower default for unknown dates
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
    if (criteria.distance_similarity < 0.85) {
        finalScore *= 0.8; // 20% penalty for poor distance match
        // @ts-ignore
        criteria.long_haul_penalty_distance = 0.2;
    }
    if (criteria.cargo_category < 1.0) {
        finalScore *= 0.85; // 15% penalty for non-exact cargo match
        // @ts-ignore
        criteria.long_haul_penalty_cargo = 0.15;
    }
  }

  // CRITICAL: Penalize international vs domestic lane mismatches heavily
  // These have completely different pricing models and should rarely match
  if (laneTypeMismatch) {
    finalScore *= 0.5; // 50% penalty for lane type mismatch
    // @ts-ignore
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
  const sourceIsOOG = isOOGCargo(sourceQuote.cargo_description, sourceQuote.cargo_height, sourceQuote.cargo_width);
  const histIsOOG = isOOGCargo(historicalQuote.cargo_description, historicalQuote.cargo_height, historicalQuote.cargo_width);

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
  const { minScore = 0.45, maxMatches = 10, feedbackData } = options;

  // Per-service minimum similarity thresholds to reduce weak/biased matches
  const SERVICE_MIN_SCORE: Record<string, number> = {
    DRAYAGE: 0.55,
    OCEAN: 0.50,
    INTERMODAL: 0.50,
    GROUND: 0.45,
  };
  const normalizedService = normalizeServiceType(sourceQuote.service_type);
  const effectiveMinScore = Math.max(minScore, SERVICE_MIN_SCORE[normalizedService] ?? minScore);

  const matches: ExtendedQuoteMatch[] = [];

  for (const historical of historicalQuotes) {
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

  if (!useAI || matches.length === 0) {
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

    const parseAiInitialAmount = (text: string): { amount: number | null; error?: string } => {
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
        return { amount };
      } catch (e) {
        return { amount: null, error: (e as Error).message };
      }
    };

    // Try to get AI-enhanced recommendation
    try {
      const aiResponse = await aiService.generateResponse(pricingPrompt, {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      });

      // Parse the AI response - it may return structured recommendations
      if (!aiResponse || !aiResponse.trim()) {
        console.log('      -> AI returned an empty response; falling back to algorithmic pricing');
      } else {
        let parsedAmount = parseAiInitialAmount(aiResponse);

        // If parsing fails, do one repair attempt asking for JSON only.
        if (!parsedAmount.amount) {
          console.log(`      -> AI response parsing failed: ${parsedAmount.error || 'unknown error'}`);
          const truncated = aiResponse.length > 3000 ? aiResponse.slice(-3000) : aiResponse;
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
            parsedAmount = repaired ? parseAiInitialAmount(repaired) : { amount: null, error: 'Empty repair response' };
          } catch (repairErr) {
            console.log(`      -> AI JSON repair attempt failed: ${(repairErr as Error).message}`);
          }
        }

        const aiSuggestedPrice = parsedAmount.amount;
        if (aiSuggestedPrice && algorithmicRecommendation?.recommended_price) {
          const floor = algorithmicRecommendation.floor_price ?? null;
          const ceiling = algorithmicRecommendation.ceiling_price ?? null;

          // Guardrails: the AI must stay close to the algorithmic band; otherwise we clamp.
          const guardedAi = (floor && ceiling)
            ? Math.round(Math.min(ceiling, Math.max(floor, aiSuggestedPrice)))
            : aiSuggestedPrice;

          // Weighted blend between algorithmic recommendation and AI suggestion.
          // Project cargo tends to be underrepresented in historical data; when confidence is LOW and cargo is
          // machinery/vehicles/oversized, we lean more on the AI.
          const sourceCargoCat = classifyCargo(sourceQuote.cargo_description);
          const isProjectCargo = ['MACHINERY', 'VEHICLES', 'OVERSIZED'].includes(sourceCargoCat);
          const sourceMiles = routeDistance?.distanceMiles ?? null;
          const useHeavyAiForLowConfidenceProjectCargo =
            algorithmicRecommendation.confidence === 'LOW' &&
            (sourceCargoCat === 'MACHINERY' || sourceCargoCat === 'OVERSIZED') &&
            (typeof sourceMiles === 'number' ? sourceMiles >= 400 : false);

          // For non-project cargo, avoid large AI-driven swings when the algorithmic model is already MEDIUM/HIGH.
          // This keeps the AI as a small stabilizer rather than a source of new outliers.
          if (algorithmicRecommendation.confidence !== 'LOW') {
            const ratio = guardedAi / algorithmicRecommendation.recommended_price;
            if (!Number.isFinite(ratio) || ratio < 0.85 || ratio > 1.15) {
              console.log(
                `      -> AI adjustment ignored (confidence=${algorithmicRecommendation.confidence}, ratio=${ratio.toFixed(2)} outside 0.85..1.15)`
              );
              return algorithmicRecommendation;
            }
          }

          let blendedPrice: number;
          if (algorithmicRecommendation.confidence === 'LOW') {
            if (useHeavyAiForLowConfidenceProjectCargo) {
              console.log(`      -> Project Cargo Override activated for ${sourceCargoCat}`);
              blendedPrice = Math.round((algorithmicRecommendation.recommended_price * 0.25) + (guardedAi * 0.75));
            } else {
              console.log(`      -> Low Confidence blend (70/30) activated.`);
              blendedPrice = Math.round((algorithmicRecommendation.recommended_price * 0.70) + (guardedAi * 0.30));
            }
          } else {
            blendedPrice = Math.round((algorithmicRecommendation.recommended_price * 0.85) + (guardedAi * 0.15));
          }

          console.log(
            `    AI-enhanced pricing: Algorithmic $${algorithmicRecommendation.recommended_price.toLocaleString()}, AI suggested $${aiSuggestedPrice.toLocaleString()}, Guarded $${guardedAi.toLocaleString()}, Blended $${blendedPrice.toLocaleString()}`
          );

          return {
            ...algorithmicRecommendation,
            recommended_price: blendedPrice,
            reasoning: `${algorithmicRecommendation.reasoning} AI-adjusted (JSON-parsed, repair-retried, guardrailed) using centralized pricing prompt.`,
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

        const matches = findEnhancedMatches(sourceQuote, historicalQuotes, { minScore, maxMatches, feedbackData }, sourceDistanceMiles);

        if (matches.length > 0) {
          let aiPricing: AIPricingDetails | null = null;
          let finalSuggestedPrice = matches[0]?.suggested_price;
          let finalPriceConfidence = matches[0]?.price_confidence || 0;

          if (useAI) {
            aiPricing = await getAIPricingRecommendation(sourceQuote, matches, { useAI }, routeDistance);
            if (aiPricing && aiPricing.recommended_price) {
              finalSuggestedPrice = aiPricing.recommended_price;
              finalPriceConfidence = aiPricing.confidence === 'HIGH' ? 0.9 :
                                     aiPricing.confidence === 'MEDIUM' ? 0.7 : 0.5;
              console.log(`    AI Price: $${aiPricing.recommended_price.toLocaleString()} (${aiPricing.confidence})`);

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
            algorithmVersion: useAI ? 'v2-ai-enhanced' : 'v2-enhanced',
            aiPricingDetails: idx === 0 && aiPricing ? {
              recommended_price: aiPricing.recommended_price,
              floor_price: aiPricing.floor_price,
              target_price: aiPricing.target_price,
              ceiling_price: aiPricing.ceiling_price,
              confidence: aiPricing.confidence,
              reasoning: aiPricing.reasoning,
            } : null,
          }));

          await db.createQuoteMatchesBulk(matchesToInsert);
          results.matchesCreated += matches.length;

          console.log(`    Found ${matches.length} matches`);
          console.log(`    Best match: Score ${matches[0]?.similarity_score.toFixed(2)}, Suggested Price: $${finalSuggestedPrice?.toLocaleString() || 'N/A'}`);

          results.matchDetails.push({
            quoteId,
            matchCount: matches.length,
            bestScore: matches[0]?.similarity_score || 0,
            suggestedPrice: finalSuggestedPrice,
            priceRange: aiPricing ? { low: aiPricing.floor_price!, high: aiPricing.ceiling_price! } : matches[0]?.price_range,
            aiPricing: aiPricing || undefined,
          });
        } else {
          console.log(`    No matches found (minScore: ${minScore})`);
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
      INNER JOIN quote_match_feedback f ON m.match_id = f.match_id
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

  // Build quote details section
  const isOOG = isOOGCargo(sourceQuote.cargo_description, sourceQuote.cargo_height, sourceQuote.cargo_width);
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
- confidence: ${algorithmicRecommendation.confidence || 'N/A'}
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
- **Weight**: ${sourceQuote.cargo_weight || 'Not specified'} ${sourceQuote.weight_unit || ''}
- **Pieces**: ${sourceQuote.number_of_pieces || 'Not specified'}
- **Hazmat**: ${sourceQuote.hazardous_material ? 'Yes' : 'No'}
- **Hazmat Class / UN**: ${sourceQuote.hazmat_class || 'Not specified'} / ${sourceQuote.hazmat_un_number || 'Not specified'}
- **Temperature Controlled**: ${sourceQuote.temperature_controlled ? 'Yes' : 'No/Not specified'}
- **Temperature Range**: ${sourceQuote.temperature_range || 'Not specified'}
- **Declared Value**: ${sourceQuote.declared_value ? `${sourceQuote.declared_value} ${sourceQuote.declared_value_currency || ''}` : 'Not specified'}
- **Packaging Type**: ${sourceQuote.packaging_type || 'Not specified'}
- **Dimensions (L×W×H)**: ${sourceQuote.cargo_length ?? 'N/A'}×${sourceQuote.cargo_width ?? 'N/A'}×${sourceQuote.cargo_height ?? 'N/A'} ${sourceQuote.dimension_unit || ''}
- **Overweight/Oversize Flags**: overweight=${sourceQuote.is_overweight ? 'Yes' : 'No/Not specified'}, oversized=${sourceQuote.is_oversized ? 'Yes' : 'No/Not specified'}
- **Permits / Pilot Car / Tarping**: permits=${sourceQuote.requires_permits ? 'Yes' : 'No/Not specified'}, pilot_car=${sourceQuote.requires_pilot_car ? 'Yes' : 'No/Not specified'}, tarping=${sourceQuote.requires_tarping ? 'Yes' : 'No/Not specified'}
- **Equipment Requested**: ${sourceQuote.equipment_type_requested || 'Not specified'}
- **Equipment Quoted**: ${sourceQuote.equipment_type_quoted || 'Not specified'}
- **Trailer Length Required**: ${sourceQuote.trailer_length_required || 'Not specified'}
- **Load Type**: ${sourceQuote.load_type || 'Not specified'}
- **Container Type**: ${detectContainerType(sourceQuote.cargo_description, sourceQuote.service_type) || 'Standard/Not specified'}
- **OOG (Out of Gauge)**: ${isOOG ? 'YES - Apply 1.35-1.45x pricing multiplier' : 'No'}
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
Use the historical matches plus the baseline to produce a competitive but realistic total quote.
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
  processEnhancedMatches,
  findEnhancedMatches,
  calculateEnhancedSimilarity,
  suggestPriceEnhanced,
  getAIPricingRecommendation,
  normalizeServiceType,
  classifyCargo,
  getWeightRange,
  getUSRegion,
  getIntlRegion,
  ENHANCED_WEIGHTS,
  SERVICE_TYPE_MAPPING,
  CARGO_CATEGORIES,
  CONTAINER_PRICING_MULTIPLIERS,
  detectContainerType,
  isOOGCargo,
  getContainerPricingMultiplier,
  getLearnedWeights,
  learnFromFeedback,
  suggestPriceWithFeedback,
  generatePricingPrompt,
  recordPricingOutcome,
  getDistanceCategory,
  calculateQuoteDistance,
};
