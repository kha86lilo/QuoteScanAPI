/**
 * Enhanced Quote Matching Service
 * Domain-aware matching algorithm for shipping and transportation quotes
 */

import * as db from '../config/db.js';
import { getAIService } from './ai/aiServiceFactory.js';
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

const SERVICE_COMPATIBILITY: Record<string, string[]> = {
  'GROUND': ['GROUND', 'DRAYAGE', 'INTERMODAL'],
  'DRAYAGE': ['DRAYAGE', 'GROUND', 'INTERMODAL'],
  'OCEAN': ['OCEAN', 'INTERMODAL'],
  'INTERMODAL': ['INTERMODAL', 'GROUND', 'DRAYAGE', 'OCEAN'],
  'TRANSLOAD': ['TRANSLOAD', 'DRAYAGE'],
  'AIR': ['AIR'],
  'STORAGE': ['STORAGE'],
};

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
  'MACHINERY': ['machine', 'equipment', 'excavator', 'loader', 'dozer', 'crane', 'forklift', 'tractor', 'generator', 'compressor', 'jlg', 'caterpillar', 'cat', 'komatsu', 'jcb', 'bobcat', 'hitachi', 'volvo', 'deere'],
  'VEHICLES': ['vehicle', 'car', 'truck', 'bus', 'trailer', 'automobile', 'auto', 'suv', 'van'],
  'CONTAINERS': ['container', '20ft', '40ft', "20'", "40'", 'high cube', 'hc', 'soc', 'coc', 'flat rack', 'open top'],
  'INDUSTRIAL': ['steel', 'metal', 'pipe', 'coil', 'beam', 'plate', 'iron', 'aluminum'],
  'AGRICULTURAL': ['grain', 'feed', 'fertilizer', 'seed', 'agricultural', 'farm'],
  'OVERSIZED': ['overweight', 'overdimensional', 'heavy haul', 'project cargo', 'breakbulk', 'oog', 'out of gauge'],
  'HAZMAT': ['hazardous', 'dangerous', 'chemical', 'flammable', 'corrosive', 'explosive'],
  'GENERAL': ['general cargo', 'pallets', 'boxes', 'cartons', 'freight'],
};

// Enhanced Weights
const ENHANCED_WEIGHTS: Record<string, number> = {
  origin_region: 0.12,
  origin_city: 0.08,
  destination_region: 0.12,
  destination_city: 0.08,
  cargo_category: 0.10,
  cargo_weight_range: 0.08,
  number_of_pieces: 0.07,
  service_type: 0.12,
  service_compatibility: 0.08,
  hazmat: 0.05,
  container_type: 0.05,
  recency: 0.05,
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

  for (const [category, keywords] of Object.entries(CARGO_CATEGORIES)) {
    if (keywords.some(k => lower.includes(k))) {
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

  if (text.includes('flat rack') || text.includes('flatrack') || text.includes('fr')) return 'FLAT_RACK';
  if (text.includes('open top') || text.includes('ot')) return 'OPEN_TOP';
  if (text.includes('reefer') || text.includes('refrigerated')) return 'REEFER';
  if (text.includes('40') && text.includes('hc')) return '40HC';
  if (text.includes('40')) return '40STD';
  if (text.includes('20')) return '20STD';
  if (text.includes('roro') || text.includes('ro-ro')) return 'RORO';

  return null;
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

interface SimilarityResult {
  score: number;
  criteria: MatchCriteria;
  metadata: MatchMetadata;
}

function calculateEnhancedSimilarity(sourceQuote: Quote, historicalQuote: Quote): SimilarityResult {
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

  // Service Type Matching
  const sourceService = normalizeServiceType(sourceQuote.service_type);
  const histService = normalizeServiceType(historicalQuote.service_type);

  criteria.service_type = sourceService === histService ? 1 : 0;

  const compatible = SERVICE_COMPATIBILITY[sourceService] || [];
  criteria.service_compatibility = compatible.includes(histService) ? 0.8 : 0;

  const serviceScore = Math.max(criteria.service_type || 0, criteria.service_compatibility || 0);
  totalScore += serviceScore * (ENHANCED_WEIGHTS.service_type! + ENHANCED_WEIGHTS.service_compatibility!);
  totalWeight += ENHANCED_WEIGHTS.service_type! + ENHANCED_WEIGHTS.service_compatibility!;

  // Cargo Matching
  const sourceCargoCat = classifyCargo(sourceQuote.cargo_description);
  const histCargoCat = classifyCargo(historicalQuote.cargo_description);

  criteria.cargo_category = sourceCargoCat === histCargoCat ? 1 :
                           (sourceCargoCat === 'GENERAL' || histCargoCat === 'GENERAL' ? 0.5 : 0);

  totalScore += (criteria.cargo_category || 0) * ENHANCED_WEIGHTS.cargo_category!;
  totalWeight += ENHANCED_WEIGHTS.cargo_category!;

  // Weight Matching
  const sourceWeightRange = getWeightRange(sourceQuote.cargo_weight, sourceQuote.weight_unit);
  const histWeightRange = getWeightRange(historicalQuote.cargo_weight, historicalQuote.weight_unit);

  if (sourceWeightRange && histWeightRange) {
    criteria.cargo_weight_range = sourceWeightRange.label === histWeightRange.label ? 1 :
                                  Math.abs(WEIGHT_RANGES.indexOf(sourceWeightRange) -
                                          WEIGHT_RANGES.indexOf(histWeightRange)) <= 1 ? 0.7 : 0.3;
  } else {
    criteria.cargo_weight_range = 0.5;
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

  // Recency
  const quoteDate = historicalQuote.quote_date || historicalQuote.created_at;
  if (quoteDate) {
    const ageDays = (Date.now() - new Date(quoteDate).getTime()) / (1000 * 60 * 60 * 24);
    criteria.recency = Math.max(0, Math.pow(0.5, ageDays / 60));
  } else {
    criteria.recency = 0.5;
  }

  totalScore += (criteria.recency || 0) * ENHANCED_WEIGHTS.recency!;
  totalWeight += ENHANCED_WEIGHTS.recency!;

  const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

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

function suggestPriceEnhanced(historicalQuote: Quote, similarityScore: number, _sourceQuote: Quote): PriceSuggestion {
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

  const priceVariance = (1 - Math.min(1, baseConfidence)) * 0.25;
  const suggestedPrice = parseFloat(String(price));

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
}

interface ExtendedQuoteMatch extends QuoteMatch {
  sourceQuoteId: number;
  matchedQuoteId: number;
}

function findEnhancedMatches(sourceQuote: Quote, historicalQuotes: Quote[], options: MatchingOptions = {}): ExtendedQuoteMatch[] {
  const { minScore = 0.45, maxMatches = 10 } = options;

  const matches: ExtendedQuoteMatch[] = [];

  for (const historical of historicalQuotes) {
    if (historical.quote_id === sourceQuote.quote_id) continue;

    const { score, criteria, metadata } = calculateEnhancedSimilarity(sourceQuote, historical);

    if (score >= minScore) {
      const priceInfo = suggestPriceEnhanced(historical, score, sourceQuote);

      matches.push({
        source_quote_id: sourceQuote.quote_id!,
        matched_quote_id: historical.quote_id!,
        sourceQuoteId: sourceQuote.quote_id!,
        matchedQuoteId: historical.quote_id!,
        similarity_score: score,
        match_criteria: criteria,
        suggested_price: priceInfo.suggestedPrice,
        price_confidence: priceInfo.priceConfidence,
        price_range: priceInfo.priceRange,
        priceSource: priceInfo.priceSource,
        jobWon: priceInfo.jobWon,
        metadata,
        matchedQuoteData: {
          origin: `${historical.origin_city || 'Unknown'}, ${historical.origin_country || 'Unknown'}`,
          destination: `${historical.destination_city || 'Unknown'}, ${historical.destination_country || 'Unknown'}`,
          cargo: historical.cargo_description || undefined,
          service: historical.service_type || undefined,
          weight: historical.cargo_weight || undefined,
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
  options: MatchingOptions = {}
): Promise<AIPricingDetails | null> {
  const { useAI = true } = options;

  if (!useAI || matches.length === 0) {
    return null;
  }

  try {
    const aiService = getAIService();
    const recommendation = await aiService.getPricingRecommendation(sourceQuote, matches);
    return recommendation;
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
      limit: 1000,
      onlyWithPrice: true,
    });

    console.log(`Found ${historicalQuotes.length} historical quotes with pricing`);

    if (historicalQuotes.length === 0) {
      console.log('No historical quotes available for matching');
      return results;
    }

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

        const matches = findEnhancedMatches(sourceQuote, historicalQuotes, { minScore, maxMatches });

        if (matches.length > 0) {
          let aiPricing: AIPricingDetails | null = null;
          let finalSuggestedPrice = matches[0]?.suggested_price;
          let finalPriceConfidence = matches[0]?.price_confidence || 0;

          if (useAI) {
            aiPricing = await getAIPricingRecommendation(sourceQuote, matches, { useAI });
            if (aiPricing && aiPricing.recommended_price) {
              finalSuggestedPrice = aiPricing.recommended_price;
              finalPriceConfidence = aiPricing.confidence === 'HIGH' ? 0.9 :
                                     aiPricing.confidence === 'MEDIUM' ? 0.7 : 0.5;
              console.log(`    AI Price: $${aiPricing.recommended_price.toLocaleString()} (${aiPricing.confidence})`);
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
 * Generate pricing recommendation prompt for AI
 */
function generatePricingPrompt(sourceQuote: Quote, topMatches: ExtendedQuoteMatch[]): string {
  const prompt = `You are an experienced shipping and transportation pricing specialist. Based on the following quote request and historical similar quotes, provide a pricing recommendation.

## NEW QUOTE REQUEST
- **Route**: ${sourceQuote.origin_city || 'Unknown'}, ${sourceQuote.origin_state_province || ''} ${sourceQuote.origin_country || ''} → ${sourceQuote.destination_city || 'Unknown'}, ${sourceQuote.destination_state_province || ''} ${sourceQuote.destination_country || ''}
- **Service Type**: ${sourceQuote.service_type || 'Not specified'}
- **Cargo Description**: ${sourceQuote.cargo_description || 'Not specified'}
- **Weight**: ${sourceQuote.cargo_weight || 'Not specified'} ${sourceQuote.weight_unit || ''}
- **Pieces**: ${sourceQuote.number_of_pieces || 'Not specified'}
- **Hazmat**: ${sourceQuote.hazardous_material ? 'Yes' : 'No'}
- **Container Type**: ${detectContainerType(sourceQuote.cargo_description, sourceQuote.service_type) || 'Standard/Not specified'}

## SIMILAR HISTORICAL QUOTES
${topMatches.slice(0, 5).map((m, i) => `
### Match ${i + 1} (${(m.similarity_score * 100).toFixed(0)}% similar)
- Route: ${m.matchedQuoteData?.origin} → ${m.matchedQuoteData?.destination}
- Service: ${m.matchedQuoteData?.service}
- Cargo: ${m.matchedQuoteData?.cargo || 'Not specified'}
- Initial Quote: $${m.matchedQuoteData?.initialPrice?.toLocaleString() || 'N/A'}
- Final Agreed Price: $${m.matchedQuoteData?.finalPrice?.toLocaleString() || 'N/A'}
- Date: ${m.matchedQuoteData?.quoteDate ? new Date(m.matchedQuoteData.quoteDate).toLocaleDateString() : 'N/A'}
- Status: ${m.matchedQuoteData?.status || 'Unknown'}
`).join('\n')}

## YOUR TASK
1. Analyze the route, cargo, and service type
2. Consider current market conditions (fuel costs, capacity)
3. Note any special requirements (hazmat, oversized, time-sensitive)
4. Provide a recommended price range

Respond with:
- **Recommended Price**: $X,XXX - $X,XXX
- **Confidence Level**: High/Medium/Low
- **Key Factors**: List 3-5 factors that influenced your recommendation
- **Negotiation Notes**: Any tips for negotiation or alternative options
`;

  return prompt;
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
  getLearnedWeights,
  learnFromFeedback,
  suggestPriceWithFeedback,
  generatePricingPrompt,
  recordPricingOutcome,
};
