import * as db from '../src/config/db.js';
import { processEnhancedMatches } from '../src/services/enhancedQuoteMatchingService.js';
import dotenv from 'dotenv';

dotenv.config();

type PhaseKey = 'CLEAN_GROUND_DRAYAGE' | 'OCEAN_INTERMODAL' | 'DRAYAGE_SHORT_HAUL';

// Simple CLI args parser
function parseArgs() {
  const args = process.argv.slice(2);
  const getVal = (key: string, def?: string) => {
    const found = args.find((a) => a.startsWith(`--${key}=`));
    if (found) return found.split('=')[1];
    const idx = args.indexOf(`--${key}`);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return def;
  };

  // Convenience flag: --sample=N applies to all phases unless a phase-specific size is provided.
  const sampleAll = parseInt(getVal('sample', '') || '', 10);
  const defaultSample = Number.isFinite(sampleAll) && sampleAll > 0 ? String(sampleAll) : '10';

  return {
    rounds: parseInt(getVal('rounds', '1') || '1', 10),
    seed: getVal('seed', 'two_phase'),
    minScore: parseFloat(getVal('min-score', '0.3') || '0.3'),
    maxMatches: parseInt(getVal('max-matches', '10') || '10', 10),
    // Optional per-phase sample sizes (defaults match the historical script)
    phase1Size: parseInt(getVal('phase1-size', defaultSample) || defaultSample, 10),
    phase2Size: parseInt(getVal('phase2-size', defaultSample) || defaultSample, 10),
    phase3Size: parseInt(getVal('phase3-size', defaultSample) || defaultSample, 10),
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
  return (hash >>> 0) / 4294967296;
}

function seedToPgSetseedValue(seed: string): number {
  // Postgres setseed expects [-1, 1]. Keep away from extremes.
  const u = hashStringToUnitFloat(seed);
  return (u * 1.8) - 0.9;
}

interface EvaluationResult {
  quoteId: number;
  actualPrice: number;
  suggestedPrice: number;
  error: number;
  service?: string;
  phase: string;
}

interface PhaseResult {
  phase: string;
  total: number;
  within10: number;
  within20: number;
  within30: number;
  avgError: number;
  results: EvaluationResult[];
}

async function evaluatePhase(
  client: any,
  phaseName: string,
  baseQuery: string,
  opts: { sampleSize: number; round: number; seed: string; minScore: number }
): Promise<PhaseResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`PHASE: ${phaseName} (Round ${opts.round})`);
  console.log('='.repeat(80));

  // Determine pool size (helps validate we're truly sampling different sets).
  const poolCountRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM (${baseQuery}) base`);
  const poolCount = poolCountRes.rows?.[0]?.cnt ?? 0;

  // Seed Postgres' random() so each round gets a deterministic but different sample.
  const setseedVal = seedToPgSetseedValue(`${opts.seed}:${phaseName}:${opts.round}`);
  await client.query('SELECT setseed($1)', [setseedVal]);

  const sampledQuery = `
    SELECT * FROM (
      ${baseQuery}
    ) base
    ORDER BY random()
    LIMIT $1
  `;

  // If the eligible pool is <= requested size, each round would otherwise pull the exact same set
  // (the whole pool), giving zero variance across rounds. In that case, downsample to enable
  // “different dataset each round”.
  const computeEffectiveLimit = (pool: number, requested: number) => {
    if (!pool || pool <= 0) return Math.max(1, requested);
    const safeRequested = Math.max(1, requested);
    if (safeRequested < pool) return safeRequested;
    if (pool === 1) return 1;
    // Pool is too small to honor the requested sample size. To preserve per-round variation,
    // sample almost the whole pool but exclude a small fraction (always at least 1).
    const exclude = Math.max(1, Math.floor(pool * 0.15));
    return Math.max(1, Math.min(pool - 1, pool - exclude));
  };

  const effectiveLimit = computeEffectiveLimit(poolCount, opts.sampleSize);
  if (poolCount > 0 && effectiveLimit < Math.min(opts.sampleSize, poolCount)) {
    console.log(
      `Pool too small for requested sample (pool=${poolCount}, requested=${opts.sampleSize}); ` +
        `sampling ${effectiveLimit} to allow per-round variation.`
    );
  }
  const res = await client.query(sampledQuery, [effectiveLimit]);
  const quotes = res.rows;

  console.log(`Pool size: ${poolCount}, Sampled: ${quotes.length} quotes for ${phaseName}\n`);

  let totalError = 0;
  let count = 0;
  let within10 = 0;
  let within20 = 0;
  let within30 = 0;
  let noMatchCount = 0;
  let missingPriceCount = 0;
  const results: EvaluationResult[] = [];

  for (const quote of quotes) {
    console.log(`Evaluating Quote ${quote.quote_id} (${quote.service_type}): ${quote.origin_city} -> ${quote.destination_city}`);

    try {
      const result = await processEnhancedMatches([quote.quote_id], {
        useAI: true,
        minScore: opts.minScore,
        maxMatches: Math.max(1, Number.isFinite(cli.maxMatches) ? cli.maxMatches : 10),
      });

      if (result.matchDetails.length > 0) {
        const detail = result.matchDetails[0];
        const finalPrice = detail?.suggestedPrice;
        const actualPrice = parseFloat(quote.quoted_price);

        if (finalPrice && actualPrice) {
          const error = Math.abs(finalPrice - actualPrice) / actualPrice;
          totalError += error;
          count++;

          if (error <= 0.10) within10++;
          if (error <= 0.20) within20++;
          if (error <= 0.30) within30++;

          const errorSymbol = error <= 0.10 ? '✅' : error <= 0.20 ? '🟡' : error <= 0.30 ? '🟠' : '❌';
          console.log(`  ${errorSymbol} Actual: $${actualPrice.toLocaleString()}, Suggested: $${finalPrice.toLocaleString()}, Error: ${(error * 100).toFixed(1)}%`);

          results.push({
            quoteId: quote.quote_id,
            actualPrice,
            suggestedPrice: finalPrice,
            error,
            service: quote.service_type,
            phase: phaseName,
          });
        } else {
          // Treat missing price data as a failure for accuracy metrics.
          missingPriceCount++;
          count++;
          const error = 1.0;
          totalError += error;
          console.log(`  ❌ Missing price (actual=${quote.quoted_price}, suggested=${finalPrice ?? 'null'})`);
          const safeActual = (typeof actualPrice === 'number' && Number.isFinite(actualPrice)) ? actualPrice : 0;
          const safeSuggested = (typeof finalPrice === 'number' && Number.isFinite(finalPrice)) ? finalPrice : 0;
          results.push({
            quoteId: quote.quote_id,
            actualPrice: safeActual,
            suggestedPrice: safeSuggested,
            error,
            service: quote.service_type,
            phase: phaseName,
          });
        }
      } else {
        // Treat "no matches" as a failure (this is important when sampling harder pools).
        noMatchCount++;
        count++;
        const error = 1.0;
        totalError += error;
        console.log(`  ❌ No matches found (counted as failure)`);
        results.push({
          quoteId: quote.quote_id,
          actualPrice: parseFloat(quote.quoted_price) || 0,
          suggestedPrice: 0,
          error,
          service: quote.service_type,
          phase: phaseName,
        });
      }
    } catch (e) {
      // Treat unexpected errors as a failure but keep the run going.
      count++;
      const error = 1.0;
      totalError += error;
      console.log(`  ❌ Error evaluating quote ${quote.quote_id} (counted as failure): ${(e as Error).message}`);
      results.push({
        quoteId: quote.quote_id,
        actualPrice: parseFloat(quote.quoted_price) || 0,
        suggestedPrice: 0,
        error,
        service: quote.service_type,
        phase: phaseName,
      });
    }
  }

  if (noMatchCount > 0 || missingPriceCount > 0) {
    console.log(`\n  Failures in ${phaseName}: no-match=${noMatchCount}, missing-price=${missingPriceCount}`);
  }

  return {
    phase: phaseName,
    total: count,
    within10,
    within20,
    within30,
    avgError: count > 0 ? totalError / count : 0,
    results,
  };
}

async function runTwoPhaseEvaluation() {
  console.log('Starting Two-Phase Multi-Round Evaluation...\n');
  console.log(`Rounds: ${cli.rounds}, Seed: ${cli.seed}, minScore: ${cli.minScore}`);
  console.log(`Sample sizes: phase1=${cli.phase1Size}, phase2=${cli.phase2Size}, phase3=${cli.phase3Size}\n`);

  const client = await db.pool.connect();

  try {
    // PHASE 1: CLEAN DATA
    // - Single price point (no revisions)
    // - Different origin/destination cities
    // - Mid-range prices ($1500-$6000)
    // - Standard service types
    const phase1BaseQuery = `
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        MAX(sqr.quoted_price) as quoted_price
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1000
        AND sqr.quoted_price <= 8000
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
        AND q.service_type IN ('Ground', 'Drayage')
        AND NOT EXISTS (
          -- Exclude per-unit pricing
          SELECT 1 FROM staff_quotes_replies sqr2 
          WHERE sqr2.related_quote_id = q.quote_id 
          AND (LOWER(sqr2.notes) LIKE '%per container%' OR LOWER(sqr2.notes) LIKE '%per 40%' OR LOWER(sqr2.notes) LIKE '%per unit%')
        )
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city
      HAVING COUNT(*) <= 9  -- Moderately broader pool
        AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 3.0
    `;

    // PHASE 2: OCEAN/INTERMODAL DATA
    // - Ocean and intermodal quotes
    // - Filter out very high variance
    const phase2BaseQuery = `
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        MAX(sqr.quoted_price) as quoted_price
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1500
        AND sqr.quoted_price <= 8500
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND q.service_type IN ('Ocean', 'Intermodal')
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city
      HAVING COUNT(*) <= 11
        AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 3.2
    `;

    // PHASE 3: DRAYAGE SHORT-HAUL
    // - Drayage with local moves
    // - Lower price range typical for short haul
    const phase3BaseQuery = `
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        MAX(sqr.quoted_price) as quoted_price
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 700
        AND sqr.quoted_price <= 3500
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
        AND q.service_type = 'Drayage'
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city
      HAVING COUNT(*) <= 8
        AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 2.5
    `;

    const rounds = Math.max(1, cli.rounds);
    const roundSummaries: { round: number; within20Pct: number; total: number; avgError: number }[] = [];
    const allRoundResults: EvaluationResult[] = [];

    const accWithin20: number[] = [];
    const avgErrors: number[] = [];

    for (let round = 1; round <= rounds; round++) {
      console.log('\n' + '#'.repeat(90));
      console.log(`ROUND ${round}/${rounds}`);
      console.log('#'.repeat(90));

      const phase1Results = await evaluatePhase(client, 'CLEAN_GROUND_DRAYAGE', phase1BaseQuery, {
        sampleSize: Math.max(1, cli.phase1Size),
        round,
        seed: cli.seed!,
        minScore: cli.minScore,
      });
      const phase2Results = await evaluatePhase(client, 'OCEAN_INTERMODAL', phase2BaseQuery, {
        sampleSize: Math.max(1, cli.phase2Size),
        round,
        seed: cli.seed!,
        minScore: cli.minScore,
      });
      const phase3Results = await evaluatePhase(client, 'DRAYAGE_SHORT_HAUL', phase3BaseQuery, {
        sampleSize: Math.max(1, cli.phase3Size),
        round,
        seed: cli.seed!,
        minScore: cli.minScore,
      });

      const combinedResults = [...phase1Results.results, ...phase2Results.results, ...phase3Results.results];
      allRoundResults.push(...combinedResults);

      const totalCount = combinedResults.length;
      const totalWithin20 = combinedResults.filter((r) => r.error <= 0.20).length;
      const totalAvgError = totalCount > 0 ? combinedResults.reduce((sum, r) => sum + r.error, 0) / totalCount : 0;

      accWithin20.push(totalCount > 0 ? (totalWithin20 / totalCount) : 0);
      avgErrors.push(totalAvgError);

      roundSummaries.push({ round, within20Pct: totalCount > 0 ? (totalWithin20 / totalCount) : 0, total: totalCount, avgError: totalAvgError });

      console.log('\n' + '='.repeat(80));
      console.log(`ROUND ${round} SUMMARY`);
      console.log('='.repeat(80));
      console.log(`Total Evaluated: ${totalCount}`);
      console.log(`Within 20%: ${totalWithin20}/${totalCount} (${(totalCount > 0 ? (totalWithin20 / totalCount * 100) : 0).toFixed(1)}%)`);
      console.log(`Average Error: ${(totalAvgError * 100).toFixed(2)}%`);
    }

    const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const stddev = (xs: number[]) => {
      if (xs.length < 2) return 0;
      const m = mean(xs);
      const v = xs.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (xs.length - 1);
      return Math.sqrt(v);
    };

    const meanWithin20 = mean(accWithin20);
    const stdWithin20 = stddev(accWithin20);
    const minWithin20 = accWithin20.length ? Math.min(...accWithin20) : 0;
    const maxWithin20 = accWithin20.length ? Math.max(...accWithin20) : 0;

    const meanAvgError = mean(avgErrors);
    const stdAvgError = stddev(avgErrors);

    console.log('\n' + '='.repeat(90));
    console.log('MULTI-ROUND SUMMARY');
    console.log('='.repeat(90));
    console.log(`Rounds: ${roundSummaries.length}`);
    console.log(`Within 20% (mean ± stdev): ${(meanWithin20 * 100).toFixed(1)}% ± ${(stdWithin20 * 100).toFixed(1)}%`);
    console.log(`Within 20% (min..max): ${(minWithin20 * 100).toFixed(1)}% .. ${(maxWithin20 * 100).toFixed(1)}%`);
    console.log(`Avg Error (mean ± stdev): ${(meanAvgError * 100).toFixed(2)}% ± ${(stdAvgError * 100).toFixed(2)}%`);

    // Show overall best/worst across all rounds (dedupe repeated quoteIds)
    const uniqByKey = (items: EvaluationResult[], sort: (a: EvaluationResult, b: EvaluationResult) => number) => {
      const out: EvaluationResult[] = [];
      const seen = new Set<string>();
      for (const r of items.sort(sort)) {
        const k = `${r.phase}:${r.quoteId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
      return out;
    };

    console.log('\n--- BEST PREDICTIONS (ALL ROUNDS) ---');
    const bestResults = uniqByKey([...allRoundResults], (a, b) => a.error - b.error).slice(0, 10);
    for (const r of bestResults) {
      console.log(`  [${r.phase}] Quote ${r.quoteId} (${r.service}): $${r.actualPrice.toLocaleString()} vs $${r.suggestedPrice.toLocaleString()} (${(r.error * 100).toFixed(1)}% error)`);
    }

    console.log('\n--- WORST PREDICTIONS (ALL ROUNDS) ---');
    const worstResults = uniqByKey([...allRoundResults], (a, b) => b.error - a.error).slice(0, 10);
    for (const r of worstResults) {
      console.log(`  [${r.phase}] Quote ${r.quoteId} (${r.service}): $${r.actualPrice.toLocaleString()} vs $${r.suggestedPrice.toLocaleString()} (${(r.error * 100).toFixed(1)}% error)`);
    }

  } finally {
    client.release();
    process.exit(0);
  }
}

runTwoPhaseEvaluation().catch(e => { console.error(e); process.exit(1); });
