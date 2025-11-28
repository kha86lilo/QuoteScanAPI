/**
 * Quote Matching Service
 * Fuzzy matching algorithm to find similar historical quotes and suggest prices
 */

import * as db from '../config/db.js';

// Default weights for matching criteria (can be tuned based on feedback)
const DEFAULT_WEIGHTS = {
  origin: 0.20,         // Origin location similarity
  destination: 0.20,    // Destination location similarity
  cargo_type: 0.15,     // Cargo description similarity
  weight: 0.15,         // Weight similarity
  dimensions: 0.10,     // Dimensions similarity
  service_type: 0.10,   // Service type match
  hazmat: 0.05,         // Hazardous material match
  pieces: 0.05,         // Number of pieces similarity
};

// Minimum score threshold to consider a match
const MIN_MATCH_SCORE = 0.5;

// Maximum matches to store per quote
const MAX_MATCHES_PER_QUOTE = 10;

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  if (!str1 || !str2) return str1?.length || str2?.length || 0;

  str1 = str1.toLowerCase();
  str2 = str2.toLowerCase();

  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate string similarity (0 to 1)
 */
function stringSimilarity(str1, str2) {
  if (!str1 && !str2) return 1;
  if (!str1 || !str2) return 0;

  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

/**
 * Calculate location similarity based on city, state, country
 */
function locationSimilarity(loc1City, loc1State, loc1Country, loc2City, loc2State, loc2Country) {
  const scores = [];

  // Country match is most important
  if (loc1Country && loc2Country) {
    const countryScore = stringSimilarity(loc1Country, loc2Country);
    scores.push({ weight: 0.4, score: countryScore });
  }

  // City match
  if (loc1City && loc2City) {
    const cityScore = stringSimilarity(loc1City, loc2City);
    scores.push({ weight: 0.4, score: cityScore });
  }

  // State/Province match
  if (loc1State && loc2State) {
    const stateScore = stringSimilarity(loc1State, loc2State);
    scores.push({ weight: 0.2, score: stateScore });
  }

  if (scores.length === 0) return 0;

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = scores.reduce((sum, s) => sum + s.weight * s.score, 0);

  return weightedSum / totalWeight;
}

/**
 * Calculate numeric similarity with tolerance
 */
function numericSimilarity(val1, val2, tolerance = 0.2) {
  if (val1 === null || val1 === undefined || val2 === null || val2 === undefined) return 0;
  if (val1 === 0 && val2 === 0) return 1;

  const num1 = parseFloat(val1);
  const num2 = parseFloat(val2);

  if (isNaN(num1) || isNaN(num2)) return 0;

  const maxVal = Math.max(Math.abs(num1), Math.abs(num2));
  if (maxVal === 0) return 1;

  const diff = Math.abs(num1 - num2) / maxVal;
  return Math.max(0, 1 - diff / tolerance);
}

/**
 * Calculate weight similarity with unit conversion
 */
function weightSimilarity(weight1, unit1, weight2, unit2) {
  if (!weight1 || !weight2) return 0;

  // Convert to kg for comparison
  const toKg = (weight, unit) => {
    const w = parseFloat(weight);
    if (isNaN(w)) return null;

    const lowerUnit = (unit || 'kg').toLowerCase();
    if (lowerUnit.includes('lb') || lowerUnit.includes('pound')) {
      return w * 0.453592;
    }
    if (lowerUnit.includes('ton') || lowerUnit.includes('t')) {
      return w * 1000;
    }
    return w; // Assume kg
  };

  const kg1 = toKg(weight1, unit1);
  const kg2 = toKg(weight2, unit2);

  if (kg1 === null || kg2 === null) return 0;

  // Use 30% tolerance for weight
  return numericSimilarity(kg1, kg2, 0.3);
}

/**
 * Calculate dimensions similarity
 */
function dimensionsSimilarity(quote1, quote2) {
  const dims1 = [quote1.cargo_length, quote1.cargo_width, quote1.cargo_height].filter(d => d);
  const dims2 = [quote2.cargo_length, quote2.cargo_width, quote2.cargo_height].filter(d => d);

  if (dims1.length === 0 || dims2.length === 0) return 0;

  // Compare volumes (rough approximation)
  const vol1 = dims1.reduce((a, b) => a * parseFloat(b), 1);
  const vol2 = dims2.reduce((a, b) => a * parseFloat(b), 1);

  return numericSimilarity(vol1, vol2, 0.4);
}

/**
 * Calculate cargo description similarity using tokenized comparison
 */
function cargoSimilarity(desc1, desc2) {
  if (!desc1 || !desc2) return 0;

  // Tokenize and normalize
  const tokenize = (str) => str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);

  const tokens1 = new Set(tokenize(desc1));
  const tokens2 = new Set(tokenize(desc2));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  // Jaccard similarity
  const intersection = [...tokens1].filter(t => tokens2.has(t)).length;
  const union = new Set([...tokens1, ...tokens2]).size;

  return intersection / union;
}

/**
 * Calculate exact match score (0 or 1)
 */
function exactMatch(val1, val2) {
  if (!val1 && !val2) return 1;
  if (!val1 || !val2) return 0;
  return val1.toString().toLowerCase() === val2.toString().toLowerCase() ? 1 : 0;
}

/**
 * Calculate overall similarity between two quotes
 */
function calculateSimilarity(sourceQuote, historicalQuote, weights = DEFAULT_WEIGHTS) {
  const criteria = {};

  // Origin similarity
  criteria.origin = locationSimilarity(
    sourceQuote.origin_city, sourceQuote.origin_state_province, sourceQuote.origin_country,
    historicalQuote.origin_city, historicalQuote.origin_state_province, historicalQuote.origin_country
  );

  // Destination similarity
  criteria.destination = locationSimilarity(
    sourceQuote.destination_city, sourceQuote.destination_state_province, sourceQuote.destination_country,
    historicalQuote.destination_city, historicalQuote.destination_state_province, historicalQuote.destination_country
  );

  // Cargo description similarity
  criteria.cargo_type = cargoSimilarity(sourceQuote.cargo_description, historicalQuote.cargo_description);

  // Weight similarity
  criteria.weight = weightSimilarity(
    sourceQuote.cargo_weight, sourceQuote.weight_unit,
    historicalQuote.cargo_weight, historicalQuote.weight_unit
  );

  // Dimensions similarity
  criteria.dimensions = dimensionsSimilarity(sourceQuote, historicalQuote);

  // Service type
  criteria.service_type = exactMatch(sourceQuote.service_type, historicalQuote.service_type);

  // Hazardous material
  criteria.hazmat = exactMatch(
    sourceQuote.hazardous_material?.toString(),
    historicalQuote.hazardous_material?.toString()
  );

  // Number of pieces
  criteria.pieces = numericSimilarity(sourceQuote.number_of_pieces, historicalQuote.number_of_pieces, 0.3);

  // Calculate weighted score
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(weights)) {
    if (criteria[key] !== undefined) {
      weightedSum += weight * criteria[key];
      totalWeight += weight;
    }
  }

  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  return {
    score: Math.round(overallScore * 10000) / 10000,
    criteria: Object.fromEntries(
      Object.entries(criteria).map(([k, v]) => [k, Math.round(v * 10000) / 10000])
    ),
  };
}

/**
 * Suggest price based on historical match
 */
function suggestPrice(historicalQuote, similarityScore) {
  const price = historicalQuote.final_agreed_price || historicalQuote.initial_quote_amount;
  if (!price) return { suggestedPrice: null, priceConfidence: 0 };

  // Price confidence is based on:
  // 1. Similarity score (higher = more confident)
  // 2. Whether it's final agreed price (more reliable) vs initial quote
  const baseConfidence = similarityScore;
  const priceTypeBonus = historicalQuote.final_agreed_price ? 0.1 : 0;

  const priceConfidence = Math.min(1, baseConfidence + priceTypeBonus);

  return {
    suggestedPrice: parseFloat(price),
    priceConfidence: Math.round(priceConfidence * 10000) / 10000,
  };
}

/**
 * Find matches for a single quote
 * @param {Object} sourceQuote - The quote to find matches for
 * @param {Array} historicalQuotes - Historical quotes to search
 * @param {Object} options - Matching options
 * @returns {Array} - Sorted array of matches
 */
function findMatchesForQuote(sourceQuote, historicalQuotes, options = {}) {
  const { minScore = MIN_MATCH_SCORE, maxMatches = MAX_MATCHES_PER_QUOTE, weights = DEFAULT_WEIGHTS } = options;

  const matches = [];

  for (const historical of historicalQuotes) {
    // Skip self-matching
    if (historical.quote_id === sourceQuote.quote_id) continue;

    const { score, criteria } = calculateSimilarity(sourceQuote, historical, weights);

    if (score >= minScore) {
      const { suggestedPrice, priceConfidence } = suggestPrice(historical, score);

      matches.push({
        sourceQuoteId: sourceQuote.quote_id,
        matchedQuoteId: historical.quote_id,
        similarityScore: score,
        matchCriteria: criteria,
        suggestedPrice,
        priceConfidence,
        matchedQuoteData: {
          origin: `${historical.origin_city}, ${historical.origin_country}`,
          destination: `${historical.destination_city}, ${historical.destination_country}`,
          cargo: historical.cargo_description,
          finalPrice: historical.final_agreed_price,
          initialPrice: historical.initial_quote_amount,
        },
      });
    }
  }

  // Sort by score descending and limit
  matches.sort((a, b) => b.similarityScore - a.similarityScore);
  return matches.slice(0, maxMatches);
}

/**
 * Process matches for newly inserted quotes
 * @param {Array<number>} newQuoteIds - IDs of newly inserted quotes
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - Processing results
 */
async function processMatchesForNewQuotes(newQuoteIds, options = {}) {
  const {
    minScore = MIN_MATCH_SCORE,
    maxMatches = MAX_MATCHES_PER_QUOTE,
    algorithmVersion = 'v1',
  } = options;

  if (!newQuoteIds || newQuoteIds.length === 0) {
    return { processed: 0, matchesCreated: 0, errors: [] };
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('QUOTE MATCHING SERVICE');
  console.log(`${'='.repeat(60)}`);
  console.log(`Processing ${newQuoteIds.length} new quote(s) for matching...`);

  const results = {
    processed: 0,
    matchesCreated: 0,
    errors: [],
  };

  try {
    // Get historical quotes (excluding new ones)
    const historicalQuotes = await db.getHistoricalQuotesForMatching(newQuoteIds, {
      limit: 500,
      onlyWithPrice: true,
    });

    console.log(`Found ${historicalQuotes.length} historical quotes with pricing data`);

    if (historicalQuotes.length === 0) {
      console.log('No historical quotes available for matching');
      return results;
    }

    // Process each new quote
    for (const quoteId of newQuoteIds) {
      try {
        const sourceQuote = await db.getQuoteForMatching(quoteId);
        if (!sourceQuote) {
          console.log(`  Quote ${quoteId} not found, skipping`);
          continue;
        }

        // Find matches
        const matches = findMatchesForQuote(sourceQuote, historicalQuotes, {
          minScore,
          maxMatches,
        });

        if (matches.length > 0) {
          // Prepare matches for bulk insert
          const matchesToInsert = matches.map(m => ({
            sourceQuoteId: m.sourceQuoteId,
            matchedQuoteId: m.matchedQuoteId,
            similarityScore: m.similarityScore,
            matchCriteria: m.matchCriteria,
            suggestedPrice: m.suggestedPrice,
            priceConfidence: m.priceConfidence,
            algorithmVersion,
          }));

          // Save to database
          await db.createQuoteMatchesBulk(matchesToInsert);
          results.matchesCreated += matches.length;

          console.log(`  Quote ${quoteId}: Found ${matches.length} match(es), best score: ${matches[0].similarityScore}`);
        } else {
          console.log(`  Quote ${quoteId}: No matches found (minScore: ${minScore})`);
        }

        results.processed++;
      } catch (error) {
        console.error(`  Error processing quote ${quoteId}:`, error.message);
        results.errors.push({ quoteId, error: error.message });
      }
    }

    console.log(`\nMatching complete: ${results.processed} quotes processed, ${results.matchesCreated} matches created`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('Error in quote matching service:', error);
    results.errors.push({ error: error.message });
  }

  return results;
}

/**
 * Re-run matching for a specific quote (e.g., after updates)
 * @param {number} quoteId - Quote ID to re-match
 * @param {Object} options - Matching options
 * @returns {Promise<Array>} - New matches
 */
async function rematchQuote(quoteId, options = {}) {
  // Delete existing matches for this quote
  const existingMatches = await db.getMatchesForQuote(quoteId);
  for (const match of existingMatches) {
    await db.deleteMatch(match.match_id);
  }

  // Re-run matching
  const results = await processMatchesForNewQuotes([quoteId], options);
  return results;
}

export {
  processMatchesForNewQuotes,
  rematchQuote,
  findMatchesForQuote,
  calculateSimilarity,
  DEFAULT_WEIGHTS,
  MIN_MATCH_SCORE,
};
