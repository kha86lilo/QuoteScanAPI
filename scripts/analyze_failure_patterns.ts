/**
 * Analyze Failure Patterns
 * Examines pricing failures by service type, price range, and route characteristics
 */

import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
import { processEnhancedMatches } from '../src/services/enhancedQuoteMatchingService.js';

dotenv.config();

const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  ssl: { rejectUnauthorized: false },
  max: 5,
});

interface QuoteResult {
  quoteId: number;
  serviceType: string;
  actualPrice: number;
  suggestedPrice: number;
  error: number;
  errorPercent: number;
  direction: 'OVER' | 'UNDER' | 'GOOD';
  distanceMiles: number | null;
  priceRange: string;
  cargoCategory: string;
  matchCount: number;
  bestMatchScore: number;
}

// Price range categories
function getPriceRange(price: number): string {
  if (price < 1000) return 'LOW (<$1k)';
  if (price < 2000) return 'MED ($1k-2k)';
  if (price < 4000) return 'HIGH ($2k-4k)';
  return 'VERY_HIGH ($4k+)';
}

// Cargo category detection
function getCargoCategory(description: string | null): string {
  if (!description) return 'UNKNOWN';
  const lower = description.toLowerCase();
  if (lower.includes('machine') || lower.includes('equipment') || lower.includes('loader') || lower.includes('excavator')) return 'MACHINERY';
  if (lower.includes('container') || lower.includes('40') || lower.includes('20')) return 'CONTAINER';
  if (lower.includes('vehicle') || lower.includes('car') || lower.includes('truck')) return 'VEHICLE';
  if (lower.includes('steel') || lower.includes('metal') || lower.includes('iron')) return 'INDUSTRIAL';
  return 'GENERAL';
}

async function analyzeFailures() {
  console.log('='.repeat(70));
  console.log('FAILURE PATTERN ANALYSIS');
  console.log('='.repeat(70));

  // Simple query - get 30 random quotes with pricing
  const quotesQuery = `
    SELECT 
      sq.quote_id,
      sq.service_type,
      sq.origin_city,
      sq.origin_state_province,
      sq.origin_country,
      sq.destination_city,
      sq.destination_state_province,
      sq.destination_country,
      sq.cargo_description,
      sq.cargo_weight,
      sq.weight_unit,
      sq.number_of_pieces,
      sq.hazardous_material,
      MAX(sqr.quoted_price) as actual_price
    FROM shipping_quotes sq
    JOIN staff_quotes_replies sqr ON sq.quote_id = sqr.related_quote_id
    WHERE sqr.quoted_price IS NOT NULL
      AND sqr.quoted_price > 500
      AND sqr.quoted_price < 15000
      AND sq.service_type IS NOT NULL
    GROUP BY sq.quote_id, sq.service_type, sq.origin_city, sq.origin_state_province, 
             sq.origin_country, sq.destination_city, sq.destination_state_province,
             sq.destination_country, sq.cargo_description, sq.cargo_weight,
             sq.weight_unit, sq.number_of_pieces, sq.hazardous_material
    ORDER BY RANDOM()
    LIMIT 30
  `;

  let quotes;
  try {
    const result = await pool.query(quotesQuery);
    quotes = result.rows;
  } catch (err) {
    console.error('Database error:', err);
    return;
  }

  console.log(`\nLoaded ${quotes?.length || 0} quotes for stratified analysis\n`);

  const results: QuoteResult[] = [];
  
  for (const quote of quotes || []) {
    try {
      // Run matching - pass quote ID, not the whole object
      const matchResult = await processEnhancedMatches([quote.quote_id], { useAI: true, minScore: 0.4, maxMatches: 5 });
      
      if (!matchResult.matches || matchResult.matches.length === 0) continue;
      
      const bestMatch = matchResult.matches[0];
      const suggestedPrice = bestMatch?.ai_pricing_details?.recommended_price || bestMatch?.suggested_price || 0;
      const actualPrice = quote.actual_price;
      
      if (!suggestedPrice || !actualPrice) continue;
      
      const error = suggestedPrice - actualPrice;
      const errorPercent = Math.abs(error / actualPrice) * 100;
      
      let direction: 'OVER' | 'UNDER' | 'GOOD' = 'GOOD';
      if (errorPercent > 15) {
        direction = error > 0 ? 'OVER' : 'UNDER';
      }

      results.push({
        quoteId: quote.quote_id,
        serviceType: quote.service_type || 'Unknown',
        actualPrice,
        suggestedPrice,
        error,
        errorPercent,
        direction,
        distanceMiles: matchResult.routeDistances?.[quote.quote_id]?.distanceMiles || null,
        priceRange: getPriceRange(actualPrice),
        cargoCategory: getCargoCategory(quote.cargo_description),
        matchCount: matchResult.matches.length,
        bestMatchScore: bestMatch?.similarity_score || 0
      });

      // Progress indicator
      process.stdout.write(`\rProcessed ${results.length}/${quotes.length} quotes`);
      
    } catch (err) {
      console.error(`Error processing quote ${quote.quote_id}:`, err);
    }
  }

  console.log('\n\n');

  // Analyze patterns
  console.log('='.repeat(70));
  console.log('ANALYSIS BY SERVICE TYPE');
  console.log('='.repeat(70));
  
  const byServiceType = new Map<string, QuoteResult[]>();
  for (const r of results) {
    const key = r.serviceType.toUpperCase();
    if (!byServiceType.has(key)) byServiceType.set(key, []);
    byServiceType.get(key)!.push(r);
  }

  for (const [type, typeResults] of byServiceType) {
    const avgError = typeResults.reduce((a, b) => a + b.errorPercent, 0) / typeResults.length;
    const within10 = typeResults.filter(r => r.errorPercent <= 10).length;
    const within20 = typeResults.filter(r => r.errorPercent <= 20).length;
    const overCount = typeResults.filter(r => r.direction === 'OVER').length;
    const underCount = typeResults.filter(r => r.direction === 'UNDER').length;
    
    console.log(`\n${type} (n=${typeResults.length}):`);
    console.log(`  Avg Error: ${avgError.toFixed(1)}%`);
    console.log(`  Within 10%: ${within10}/${typeResults.length} (${(within10/typeResults.length*100).toFixed(0)}%)`);
    console.log(`  Within 20%: ${within20}/${typeResults.length} (${(within20/typeResults.length*100).toFixed(0)}%)`);
    console.log(`  Overpriced: ${overCount}, Underpriced: ${underCount}`);
    
    // Show worst cases
    const worst = typeResults.sort((a, b) => b.errorPercent - a.errorPercent).slice(0, 3);
    console.log(`  Worst cases:`);
    for (const w of worst) {
      console.log(`    Quote ${w.quoteId}: Actual $${w.actualPrice.toLocaleString()}, Suggested $${w.suggestedPrice.toLocaleString()} (${w.errorPercent.toFixed(0)}% ${w.direction})`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('ANALYSIS BY PRICE RANGE');
  console.log('='.repeat(70));

  const byPriceRange = new Map<string, QuoteResult[]>();
  for (const r of results) {
    if (!byPriceRange.has(r.priceRange)) byPriceRange.set(r.priceRange, []);
    byPriceRange.get(r.priceRange)!.push(r);
  }

  for (const [range, rangeResults] of byPriceRange) {
    const avgError = rangeResults.reduce((a, b) => a + b.errorPercent, 0) / rangeResults.length;
    const within20 = rangeResults.filter(r => r.errorPercent <= 20).length;
    const overCount = rangeResults.filter(r => r.direction === 'OVER').length;
    const underCount = rangeResults.filter(r => r.direction === 'UNDER').length;
    
    console.log(`\n${range} (n=${rangeResults.length}):`);
    console.log(`  Avg Error: ${avgError.toFixed(1)}%`);
    console.log(`  Within 20%: ${within20}/${rangeResults.length} (${(within20/rangeResults.length*100).toFixed(0)}%)`);
    console.log(`  Trend: ${overCount > underCount ? 'OVERPRICING' : underCount > overCount ? 'UNDERPRICING' : 'BALANCED'} (Over: ${overCount}, Under: ${underCount})`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('ANALYSIS BY DISTANCE');
  console.log('='.repeat(70));

  const withDistance = results.filter(r => r.distanceMiles !== null);
  const shortHaul = withDistance.filter(r => r.distanceMiles! < 100);
  const medHaul = withDistance.filter(r => r.distanceMiles! >= 100 && r.distanceMiles! < 500);
  const longHaul = withDistance.filter(r => r.distanceMiles! >= 500);

  for (const [name, group] of [['SHORT (<100mi)', shortHaul], ['MEDIUM (100-500mi)', medHaul], ['LONG (500+mi)', longHaul]] as const) {
    if (group.length === 0) continue;
    const avgError = group.reduce((a, b) => a + b.errorPercent, 0) / group.length;
    const within20 = group.filter(r => r.errorPercent <= 20).length;
    const overCount = group.filter(r => r.direction === 'OVER').length;
    
    console.log(`\n${name} (n=${group.length}):`);
    console.log(`  Avg Error: ${avgError.toFixed(1)}%`);
    console.log(`  Within 20%: ${within20}/${group.length} (${(within20/group.length*100).toFixed(0)}%)`);
    console.log(`  Trend: ${overCount > group.length/2 ? 'OVERPRICING' : 'UNDERPRICING'}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('KEY INSIGHTS FOR IMPROVEMENT');
  console.log('='.repeat(70));

  // Calculate overall stats
  const totalWithin10 = results.filter(r => r.errorPercent <= 10).length;
  const totalWithin20 = results.filter(r => r.errorPercent <= 20).length;
  const totalOver = results.filter(r => r.direction === 'OVER').length;
  const totalUnder = results.filter(r => r.direction === 'UNDER').length;

  console.log(`\nOVERALL RESULTS (n=${results.length}):`);
  console.log(`  Within 10%: ${totalWithin10} (${(totalWithin10/results.length*100).toFixed(1)}%)`);
  console.log(`  Within 20%: ${totalWithin20} (${(totalWithin20/results.length*100).toFixed(1)}%)`);
  console.log(`  Overpriced: ${totalOver} (${(totalOver/results.length*100).toFixed(0)}%)`);
  console.log(`  Underpriced: ${totalUnder} (${(totalUnder/results.length*100).toFixed(0)}%)`);

  // Identify patterns
  console.log('\nPATTERNS IDENTIFIED:');
  
  if (totalOver > totalUnder * 1.5) {
    console.log('  ⚠️  System tends to OVERPRICE - consider lowering baseline multipliers');
  } else if (totalUnder > totalOver * 1.5) {
    console.log('  ⚠️  System tends to UNDERPRICE - consider raising baseline multipliers');
  }

  // Check for service-type specific issues
  for (const [type, typeResults] of byServiceType) {
    const typeAvgError = typeResults.reduce((a, b) => a + b.errorPercent, 0) / typeResults.length;
    if (typeAvgError > 50) {
      console.log(`  ⚠️  ${type} has high error (${typeAvgError.toFixed(0)}%) - needs specific adjustments`);
    }
  }

  // Check for price-range specific issues
  for (const [range, rangeResults] of byPriceRange) {
    const overRatio = rangeResults.filter(r => r.direction === 'OVER').length / rangeResults.length;
    if (overRatio > 0.7) {
      console.log(`  ⚠️  ${range} quotes are consistently OVERPRICED`);
    } else if (overRatio < 0.3) {
      console.log(`  ⚠️  ${range} quotes are consistently UNDERPRICED`);
    }
  }

  await pool.end();
}

analyzeFailures().catch(console.error);
