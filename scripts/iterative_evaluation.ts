/**
 * Iterative Pricing Evaluation Script
 * Samples different batches of 20 quotes, evaluates accuracy, and identifies patterns
 * Goal: Achieve 80% accuracy (within 20% of actual price)
 */

import * as db from '../src/config/db.js';
import { processEnhancedMatches } from '../src/services/enhancedQuoteMatchingService.js';
import dotenv from 'dotenv';

dotenv.config();

interface EvaluationResult {
  quoteId: number;
  actualPrice: number;
  suggestedPrice: number;
  error: number;
  errorPercent: number;
  direction: 'OVER' | 'UNDER' | 'GOOD';
  service: string;
  origin: string;
  destination: string;
  matchCount: number;
  bestMatchScore: number;
  cargoWeight: number | null;
  cargoDescription: string;
}

interface IterationSummary {
  iteration: number;
  sampleSize: number;
  evaluated: number;
  within10: number;
  within20: number;
  within30: number;
  avgError: number;
  overpriced: number;
  underpriced: number;
  noMatches: number;
  results: EvaluationResult[];
}

// Sampling strategy support
type SamplingStrategy = 'sequential' | 'random' | 'recent' | 'balanced';

// Parse CLI args (very simple parser)
function parseArgs() {
  const args = process.argv.slice(2);
  const getVal = (key: string, def?: string) => {
    const found = args.find(a => a.startsWith(`--${key}=`));
    if (found) return found.split('=')[1];
    const idx = args.indexOf(`--${key}`);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return def;
  };
  return {
    strategy: (getVal('strategy', 'sequential') as SamplingStrategy),
    iterations: parseInt(getVal('iterations', '5') || '5', 10),
    sampleSize: parseInt(getVal('sample-size', '20') || '20', 10),
    minScore: parseFloat(getVal('min-score', '0.40') || '0.40'),
    seed: getVal('seed'),
  };
}

const cli = parseArgs();

function hashStringToUnitFloat(input: string): number {
  // Deterministic, stable hash -> [0, 1)
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Convert uint32 to [0,1)
  return (hash >>> 0) / 4294967296;
}

function seedToPgSetseedValue(seed: string): number {
  // Postgres setseed expects [-1, 1]. Keep away from extremes.
  const u = hashStringToUnitFloat(seed);
  return (u * 1.8) - 0.9;
}

// Configuration for each iteration (overridable via CLI)
const SAMPLE_SIZE = Math.max(1, cli.sampleSize);
const TARGET_ACCURACY = 0.80; // 80% within 20%
const NUM_ITERATIONS = Math.max(1, cli.iterations); // Number of different sample batches to test
const STRATEGY: SamplingStrategy = cli.strategy;
const MIN_SCORE = isNaN(cli.minScore) ? 0.40 : cli.minScore;

function sqlBaseCte() {
  return `
    WITH ranked_quotes AS (
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.origin_state_province,
        q.destination_city,
        q.destination_state_province,
        q.cargo_description,
        q.cargo_weight,
        q.weight_unit,
        q.quote_date,
        q.created_at,
        MAX(sqr.quoted_price) as quoted_price,
        ROW_NUMBER() OVER (ORDER BY q.quote_id) as rn
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 800
        AND sqr.quoted_price <= 8000
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
        AND q.service_type IN ('Ground', 'Drayage', 'Ocean', 'Intermodal')
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.origin_state_province, 
               q.destination_city, q.destination_state_province, q.cargo_description, 
               q.cargo_weight, q.weight_unit, q.quote_date, q.created_at
      HAVING COUNT(*) <= 3
        AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 1.5
    )
  `;
}

async function fetchQuotesSequential(client: any, iterationOffset: number, sampleSize: number) {
  const startRow = iterationOffset * sampleSize;
  const endRow = startRow + sampleSize;
  const query = `
    ${sqlBaseCte()}
    SELECT * FROM ranked_quotes
    WHERE rn > $1 AND rn <= $2
    ORDER BY quote_id
  `;
  const res = await client.query(query, [startRow, endRow]);
  return res.rows;
}

async function fetchQuotesRandom(client: any, sampleSize: number) {
  // Use ORDER BY random(); seed is best-effort, may be ignored depending on DB settings
  const query = `
    ${sqlBaseCte()}
    SELECT * FROM ranked_quotes
    ORDER BY random()
    LIMIT $1
  `;
  const res = await client.query(query, [sampleSize]);
  return res.rows;
}

async function fetchQuotesRecent(client: any, iterationOffset: number, sampleSize: number) {
  const offset = iterationOffset * sampleSize;
  const query = `
    ${sqlBaseCte()}
    SELECT * FROM ranked_quotes
    ORDER BY COALESCE(quote_date, created_at) DESC NULLS LAST
    OFFSET $1
    LIMIT $2
  `;
  const res = await client.query(query, [offset, sampleSize]);
  return res.rows;
}

async function fetchQuotesBalanced(client: any, sampleSize: number) {
  const perType = Math.max(1, Math.floor(sampleSize / 4));
  const remainder = sampleSize - perType * 4;
  const limits: Record<string, number> = {
    Ground: perType,
    Drayage: perType,
    Ocean: perType,
    Intermodal: perType,
  };
  // Distribute remainder
  const order: (keyof typeof limits)[] = ['Ground', 'Drayage', 'Ocean', 'Intermodal'];
  for (let i = 0; i < remainder; i++) limits[order[i % order.length]] += 1;

  const parts: string[] = [];
  const params: any[] = [];
  let p = 1;
  for (const svc of order) {
    const sub = `
      SELECT * FROM (
        ${sqlBaseCte()}
        SELECT * FROM ranked_quotes WHERE service_type = $${p} ORDER BY random() LIMIT $${p + 1}
      ) x
    `;
    parts.push(sub);
    params.push(svc, limits[svc]);
    p += 2;
  }
  const query = parts.join(' UNION ALL ') + ' LIMIT $' + p;
  params.push(sampleSize);
  const res = await client.query(query, params);
  return res.rows;
}

async function runIteration(iteration: number, offset: number): Promise<IterationSummary> {
  const client = await db.pool.connect();
  
  const summary: IterationSummary = {
    iteration,
    sampleSize: SAMPLE_SIZE,
    evaluated: 0,
    within10: 0,
    within20: 0,
    within30: 0,
    avgError: 0,
    overpriced: 0,
    underpriced: 0,
    noMatches: 0,
    results: [],
  };

  try {
    // Optional deterministic sampling: seed Postgres' random() per iteration.
    // This makes ORDER BY random() repeatable while still producing a different sample each iteration.
    if (cli.seed) {
      const setseedVal = seedToPgSetseedValue(`${cli.seed}:${iteration}`);
      await client.query('SELECT setseed($1)', [setseedVal]);
      console.log(`(sampling seed: ${cli.seed}:${iteration})`);
    }

    // Fetch samples according to strategy
    let quotes: any[] = [];
    if (STRATEGY === 'sequential') {
      quotes = await fetchQuotesSequential(client, offset, SAMPLE_SIZE);
    } else if (STRATEGY === 'random') {
      quotes = await fetchQuotesRandom(client, SAMPLE_SIZE);
    } else if (STRATEGY === 'recent') {
      quotes = await fetchQuotesRecent(client, offset, SAMPLE_SIZE);
    } else if (STRATEGY === 'balanced') {
      quotes = await fetchQuotesBalanced(client, SAMPLE_SIZE);
    }

    console.log(`\n${'='.repeat(80)}`);
    const sampleLabel = STRATEGY === 'sequential' ? `quotes ${(offset * SAMPLE_SIZE) + 1} to ${(offset * SAMPLE_SIZE) + SAMPLE_SIZE}` : `${STRATEGY} sample of ${SAMPLE_SIZE}`;
    console.log(`ITERATION ${iteration}: Evaluating ${sampleLabel}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Found ${quotes.length} quotes to evaluate\n`);

    let totalError = 0;

    for (const quote of quotes) {
      try {
        const result = await processEnhancedMatches([quote.quote_id], { 
          useAI: true, 
          minScore: MIN_SCORE,
          maxMatches: 10 
        });

        if (result.matchDetails.length > 0) {
          const detail = result.matchDetails[0];
          const suggestedPrice = detail?.suggestedPrice;
          const actualPrice = parseFloat(quote.quoted_price);

          if (suggestedPrice && actualPrice && suggestedPrice > 0) {
            const error = suggestedPrice - actualPrice;
            const errorPercent = Math.abs(error / actualPrice) * 100;
            
            let direction: 'OVER' | 'UNDER' | 'GOOD' = 'GOOD';
            if (errorPercent > 20) {
              direction = error > 0 ? 'OVER' : 'UNDER';
              if (error > 0) summary.overpriced++;
              else summary.underpriced++;
            }

            summary.evaluated++;
            totalError += errorPercent;
            
            if (errorPercent <= 10) summary.within10++;
            if (errorPercent <= 20) summary.within20++;
            if (errorPercent <= 30) summary.within30++;

            const errorSymbol = errorPercent <= 10 ? '✅' : errorPercent <= 20 ? '🟡' : errorPercent <= 30 ? '🟠' : '❌';
            console.log(`  ${errorSymbol} Quote ${quote.quote_id} (${quote.service_type}): $${actualPrice.toLocaleString()} vs $${suggestedPrice.toLocaleString()} (${errorPercent.toFixed(1)}% ${direction})`);

            summary.results.push({
              quoteId: quote.quote_id,
              actualPrice,
              suggestedPrice,
              error,
              errorPercent,
              direction,
              service: quote.service_type || 'Unknown',
              origin: `${quote.origin_city || 'Unknown'}, ${quote.origin_state_province || ''}`,
              destination: `${quote.destination_city || 'Unknown'}, ${quote.destination_state_province || ''}`,
              matchCount: detail?.matchCount || 0,
              bestMatchScore: detail?.bestScore || 0,
              cargoWeight: quote.cargo_weight,
              cargoDescription: quote.cargo_description?.substring(0, 100) || '',
            });
          } else {
            console.log(`  ⚠️ Quote ${quote.quote_id}: Invalid price data`);
            summary.noMatches++;
          }
        } else {
          console.log(`  ⚠️ Quote ${quote.quote_id}: No matches found`);
          summary.noMatches++;
        }
      } catch (err) {
        console.log(`  ❌ Quote ${quote.quote_id}: Error - ${err}`);
      }
    }

    summary.avgError = summary.evaluated > 0 ? totalError / summary.evaluated : 0;

  } finally {
    client.release();
  }

  return summary;
}

function analyzePatterns(allResults: EvaluationResult[]): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PATTERN ANALYSIS');
  console.log(`${'='.repeat(80)}`);

  // By Service Type
  const byService = new Map<string, EvaluationResult[]>();
  for (const r of allResults) {
    const key = r.service.toUpperCase();
    if (!byService.has(key)) byService.set(key, []);
    byService.get(key)!.push(r);
  }

  console.log('\n--- By Service Type ---');
  for (const [service, results] of byService) {
    const avgError = results.reduce((a, b) => a + b.errorPercent, 0) / results.length;
    const within20 = results.filter(r => r.errorPercent <= 20).length;
    const overCount = results.filter(r => r.direction === 'OVER').length;
    const underCount = results.filter(r => r.direction === 'UNDER').length;
    
    const trend = overCount > underCount ? 'OVER' : underCount > overCount ? 'UNDER' : 'BALANCED';
    console.log(`  ${service}: ${within20}/${results.length} within 20% (${(within20/results.length*100).toFixed(0)}%), Avg ${avgError.toFixed(1)}% error, Trend: ${trend}`);
    
    // Show worst cases per service
    const worst = results.sort((a, b) => b.errorPercent - a.errorPercent).slice(0, 2);
    for (const w of worst) {
      console.log(`    Worst: Quote ${w.quoteId}: $${w.actualPrice} vs $${w.suggestedPrice} (${w.errorPercent.toFixed(0)}% ${w.direction})`);
    }
  }

  // By Price Range
  const byPriceRange = new Map<string, EvaluationResult[]>();
  for (const r of allResults) {
    let range: string;
    if (r.actualPrice < 1500) range = '<$1.5k';
    else if (r.actualPrice < 3000) range = '$1.5k-$3k';
    else if (r.actualPrice < 5000) range = '$3k-$5k';
    else range = '$5k+';
    
    if (!byPriceRange.has(range)) byPriceRange.set(range, []);
    byPriceRange.get(range)!.push(r);
  }

  console.log('\n--- By Price Range ---');
  for (const [range, results] of byPriceRange) {
    const avgError = results.reduce((a, b) => a + b.errorPercent, 0) / results.length;
    const within20 = results.filter(r => r.errorPercent <= 20).length;
    const overCount = results.filter(r => r.direction === 'OVER').length;
    const underCount = results.filter(r => r.direction === 'UNDER').length;
    
    const trend = overCount > underCount ? 'OVER' : underCount > overCount ? 'UNDER' : 'BALANCED';
    console.log(`  ${range}: ${within20}/${results.length} within 20% (${(within20/results.length*100).toFixed(0)}%), Avg ${avgError.toFixed(1)}% error, Trend: ${trend}`);
  }

  // By Match Count
  const lowMatch = allResults.filter(r => r.matchCount <= 3);
  const medMatch = allResults.filter(r => r.matchCount > 3 && r.matchCount <= 7);
  const highMatch = allResults.filter(r => r.matchCount > 7);

  console.log('\n--- By Match Count ---');
  for (const [name, results] of [['1-3 matches', lowMatch], ['4-7 matches', medMatch], ['8+ matches', highMatch]] as const) {
    if (results.length === 0) continue;
    const avgError = results.reduce((a, b) => a + b.errorPercent, 0) / results.length;
    const within20 = results.filter(r => r.errorPercent <= 20).length;
    console.log(`  ${name}: ${within20}/${results.length} within 20% (${(within20/results.length*100).toFixed(0)}%), Avg ${avgError.toFixed(1)}% error`);
  }

  // Identify specific problem patterns
  console.log('\n--- Problem Patterns ---');
  
  // Over-estimation patterns
  const overEstimated = allResults.filter(r => r.direction === 'OVER' && r.errorPercent > 30);
  if (overEstimated.length > 0) {
    console.log(`\n  OVER-ESTIMATION Issues (${overEstimated.length} cases, >30% over):`);
    for (const r of overEstimated.slice(0, 5)) {
      console.log(`    Quote ${r.quoteId} (${r.service}): $${r.actualPrice} actual, $${r.suggestedPrice} suggested (+${r.errorPercent.toFixed(0)}%)`);
      console.log(`      Route: ${r.origin} -> ${r.destination}`);
      console.log(`      Cargo: ${r.cargoDescription}`);
    }
  }

  // Under-estimation patterns  
  const underEstimated = allResults.filter(r => r.direction === 'UNDER' && r.errorPercent > 30);
  if (underEstimated.length > 0) {
    console.log(`\n  UNDER-ESTIMATION Issues (${underEstimated.length} cases, >30% under):`);
    for (const r of underEstimated.slice(0, 5)) {
      console.log(`    Quote ${r.quoteId} (${r.service}): $${r.actualPrice} actual, $${r.suggestedPrice} suggested (-${r.errorPercent.toFixed(0)}%)`);
      console.log(`      Route: ${r.origin} -> ${r.destination}`);
      console.log(`      Cargo: ${r.cargoDescription}`);
    }
  }
}

function generateRecommendations(summaries: IterationSummary[]): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log('RECOMMENDATIONS FOR IMPROVEMENT');
  console.log(`${'='.repeat(80)}`);

  // Aggregate stats
  const allResults = summaries.flatMap(s => s.results);
  const totalEvaluated = summaries.reduce((a, b) => a + b.evaluated, 0);
  const totalWithin20 = summaries.reduce((a, b) => a + b.within20, 0);
  const overallAccuracy = totalEvaluated > 0 ? (totalWithin20 / totalEvaluated * 100) : 0;
  
  console.log(`\nCurrent Accuracy: ${overallAccuracy.toFixed(1)}% (Target: 80%)`);
  console.log(`Gap to Target: ${(80 - overallAccuracy).toFixed(1)} percentage points\n`);

  // Check for overall bias
  const totalOver = summaries.reduce((a, b) => a + b.overpriced, 0);
  const totalUnder = summaries.reduce((a, b) => a + b.underpriced, 0);
  
  if (totalOver > totalUnder * 1.5) {
    console.log('📊 BIAS DETECTED: System tends to OVERPRICE');
    console.log('   Recommendations:');
    console.log('   - Reduce base weight for service_type matching (currently 0.18)');
    console.log('   - Lower AI confidence thresholds');
    console.log('   - Give more weight to lower-priced historical matches');
  } else if (totalUnder > totalOver * 1.5) {
    console.log('📊 BIAS DETECTED: System tends to UNDERPRICE');
    console.log('   Recommendations:');
    console.log('   - Increase distance_similarity weight (currently 0.12)');
    console.log('   - Apply region-based pricing multipliers');
    console.log('   - Give more weight to recent quotes');
  }

  // Service-specific recommendations
  const byService = new Map<string, EvaluationResult[]>();
  for (const r of allResults) {
    const key = r.service.toUpperCase();
    if (!byService.has(key)) byService.set(key, []);
    byService.get(key)!.push(r);
  }

  console.log('\n📋 SERVICE-SPECIFIC RECOMMENDATIONS:');
  for (const [service, results] of byService) {
    const avgError = results.reduce((a, b) => a + b.errorPercent, 0) / results.length;
    const within20 = results.filter(r => r.errorPercent <= 20).length / results.length * 100;
    
    if (within20 < 70) {
      console.log(`\n   ${service} (${within20.toFixed(0)}% accuracy):`);
      
      const overCount = results.filter(r => r.direction === 'OVER').length;
      const underCount = results.filter(r => r.direction === 'UNDER').length;
      
      if (overCount > underCount) {
        console.log('   - Apply 0.9x multiplier to suggested prices');
        console.log('   - Increase minimum similarity score to 0.45');
      } else {
        console.log('   - Apply 1.1x multiplier to suggested prices');
        console.log('   - Reduce weight for cargo_weight_range matching');
      }
    }
  }

  // Weight adjustment recommendations
  console.log('\n📐 WEIGHT ADJUSTMENT RECOMMENDATIONS:');
  console.log('   Current weights:');
  console.log('   - service_type: 0.18 (highest)');
  console.log('   - cargo_weight_range: 0.15');
  console.log('   - cargo_category: 0.12');
  console.log('   - distance_similarity: 0.12');
  console.log('   - destination_region: 0.09');
  console.log('   - origin_region: 0.07');
  
  if (overallAccuracy < 60) {
    console.log('\n   Suggested changes for <60% accuracy:');
    console.log('   - Increase distance_similarity to 0.18');
    console.log('   - Reduce service_type to 0.14');
    console.log('   - Add recency weight boost for quotes < 60 days old');
  } else if (overallAccuracy < 80) {
    console.log('\n   Suggested changes for 60-80% accuracy:');
    console.log('   - Fine-tune cargo_weight_range scoring');
    console.log('   - Add regional pricing multipliers');
    console.log('   - Improve AI prompt with more specific guidance');
  }
}

async function runIterativeEvaluation() {
  console.log('='.repeat(80));
  console.log('ITERATIVE PRICING EVALUATION');
  console.log('Goal: Achieve 80% accuracy (within 20% of actual price)');
  console.log(`Running ${NUM_ITERATIONS} iterations of ${SAMPLE_SIZE} quotes each`);
  console.log('='.repeat(80));

  const summaries: IterationSummary[] = [];

  for (let i = 0; i < NUM_ITERATIONS; i++) {
    const summary = await runIteration(i + 1, i);
    summaries.push(summary);

    // Print iteration summary
    console.log(`\n--- Iteration ${i + 1} Summary ---`);
    console.log(`Evaluated: ${summary.evaluated}/${SAMPLE_SIZE}`);
    console.log(`Within 10%: ${summary.within10} (${(summary.within10/summary.evaluated*100 || 0).toFixed(1)}%)`);
    console.log(`Within 20%: ${summary.within20} (${(summary.within20/summary.evaluated*100 || 0).toFixed(1)}%)`);
    console.log(`Within 30%: ${summary.within30} (${(summary.within30/summary.evaluated*100 || 0).toFixed(1)}%)`);
    console.log(`Avg Error: ${summary.avgError.toFixed(1)}%`);
    console.log(`Overpriced: ${summary.overpriced}, Underpriced: ${summary.underpriced}, No matches: ${summary.noMatches}`);
  }

  // Overall summary
  const totalEvaluated = summaries.reduce((a, b) => a + b.evaluated, 0);
  const totalWithin10 = summaries.reduce((a, b) => a + b.within10, 0);
  const totalWithin20 = summaries.reduce((a, b) => a + b.within20, 0);
  const totalWithin30 = summaries.reduce((a, b) => a + b.within30, 0);
  const avgError = summaries.reduce((a, b) => a + b.avgError, 0) / NUM_ITERATIONS;

  console.log(`\n${'='.repeat(80)}`);
  console.log('OVERALL RESULTS');
  console.log(`${'='.repeat(80)}`);
  console.log(`Total Evaluated: ${totalEvaluated}`);
  console.log(`Within 10%: ${totalWithin10}/${totalEvaluated} (${(totalWithin10/totalEvaluated*100).toFixed(1)}%)`);
  console.log(`Within 20%: ${totalWithin20}/${totalEvaluated} (${(totalWithin20/totalEvaluated*100).toFixed(1)}%) ${(totalWithin20/totalEvaluated) >= TARGET_ACCURACY ? '✅ TARGET MET!' : '❌ Below target'}`);
  console.log(`Within 30%: ${totalWithin30}/${totalEvaluated} (${(totalWithin30/totalEvaluated*100).toFixed(1)}%)`);
  console.log(`Average Error: ${avgError.toFixed(1)}%`);

  // Run pattern analysis
  const allResults = summaries.flatMap(s => s.results);
  analyzePatterns(allResults);

  // Generate recommendations
  generateRecommendations(summaries);

  process.exit(0);
}

runIterativeEvaluation().catch(e => { console.error(e); process.exit(1); });
