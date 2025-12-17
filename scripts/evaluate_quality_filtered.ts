import * as db from '../src/config/db.js';
import { processEnhancedMatches } from '../src/services/enhancedQuoteMatchingService.js';
import dotenv from 'dotenv';

dotenv.config();

interface EvaluationResult {
  quoteId: number;
  actualPrice: number;
  suggestedPrice: number;
  error: number;
  service?: string;
  origin?: string;
  destination?: string;
  matchCount?: number;
}

async function evaluateWithQualityFilters() {
  console.log('Starting Quality-Filtered Evaluation...\n');

  const client = await db.pool.connect();

  try {
    // PHASE 1: Find quotes with GOOD historical data
    // Requirements:
    // - At least 5 similar historical quotes in same service type
    // - Historical price variance < 50%
    // - Clear routing (not same city)
    // - Not per-unit pricing
    
    console.log('='.repeat(80));
    console.log('STEP 1: Finding quotes with good historical coverage');
    console.log('='.repeat(80));

    // Find service type + region combinations with good coverage
    const coverageQuery = `
      WITH quote_regions AS (
        SELECT 
          q.quote_id,
          q.service_type,
          q.origin_city,
          q.destination_city,
          q.origin_state,
          q.destination_state,
          CASE 
            WHEN LOWER(q.origin_state) IN ('ny', 'nj', 'pa', 'ct', 'ma') THEN 'NORTHEAST'
            WHEN LOWER(q.origin_state) IN ('tx', 'la', 'ok') THEN 'GULF'
            WHEN LOWER(q.origin_state) IN ('ca', 'wa', 'or') THEN 'WEST'
            WHEN LOWER(q.origin_state) IN ('fl', 'ga', 'sc', 'nc', 'va') THEN 'SOUTHEAST'
            WHEN LOWER(q.origin_state) IN ('il', 'oh', 'mi', 'in', 'wi') THEN 'MIDWEST'
            ELSE 'OTHER'
          END as origin_region,
          CASE 
            WHEN LOWER(q.destination_state) IN ('ny', 'nj', 'pa', 'ct', 'ma') THEN 'NORTHEAST'
            WHEN LOWER(q.destination_state) IN ('tx', 'la', 'ok') THEN 'GULF'
            WHEN LOWER(q.destination_state) IN ('ca', 'wa', 'or') THEN 'WEST'
            WHEN LOWER(q.destination_state) IN ('fl', 'ga', 'sc', 'nc', 'va') THEN 'SOUTHEAST'
            WHEN LOWER(q.destination_state) IN ('il', 'oh', 'mi', 'in', 'wi') THEN 'MIDWEST'
            ELSE 'OTHER'
          END as dest_region,
          MAX(sqr.quoted_price) as quoted_price
        FROM shipping_quotes q
        JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
        WHERE sqr.is_pricing_email = true
          AND sqr.quoted_price IS NOT NULL
          AND sqr.quoted_price >= 500
          AND sqr.quoted_price <= 10000
          AND q.origin_city IS NOT NULL
          AND q.destination_city IS NOT NULL
          AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
          AND q.service_type IN ('Ground', 'Drayage')
        GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city, q.origin_state, q.destination_state
        HAVING COUNT(*) <= 3  -- Not too many price revisions
          AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 1.5
      )
      SELECT 
        service_type,
        origin_region,
        dest_region,
        COUNT(*) as quote_count,
        AVG(quoted_price)::int as avg_price,
        STDDEV(quoted_price)::int as price_stddev,
        (STDDEV(quoted_price) / NULLIF(AVG(quoted_price), 0) * 100)::int as cv_percent
      FROM quote_regions
      WHERE origin_region != 'OTHER' AND dest_region != 'OTHER'
      GROUP BY service_type, origin_region, dest_region
      HAVING COUNT(*) >= 5
      ORDER BY quote_count DESC
    `;

    const coverageRes = await client.query(coverageQuery);
    console.log(`\nFound ${coverageRes.rows.length} service/route combinations with 5+ quotes:\n`);
    
    for (const row of coverageRes.rows) {
      const cv = row.cv_percent || 0;
      const quality = cv < 30 ? '✅ Low variance' : cv < 50 ? '🟡 Medium variance' : '❌ High variance';
      console.log(`  ${row.service_type}: ${row.origin_region} -> ${row.dest_region} (${row.quote_count} quotes, avg $${row.avg_price}, CV: ${cv}% ${quality})`);
    }

    // Select best lane combinations (lowest CV, most quotes)
    const bestLanes = coverageRes.rows
      .filter(r => (r.cv_percent || 0) < 50)
      .slice(0, 5);

    if (bestLanes.length === 0) {
      console.log('\n⚠️ No lanes with acceptable variance found!');
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log('STEP 2: Evaluating quotes from best lanes');
    console.log('='.repeat(80));

    // Get evaluation quotes from best lanes
    const results: EvaluationResult[] = [];
    let totalWithin10 = 0;
    let totalWithin20 = 0;
    let totalWithin30 = 0;
    let totalError = 0;
    let count = 0;

    for (const lane of bestLanes) {
      console.log(`\n--- Evaluating ${lane.service_type}: ${lane.origin_region} -> ${lane.dest_region} ---`);

      const laneQuery = `
        SELECT 
          q.quote_id,
          q.service_type,
          q.origin_city,
          q.destination_city,
          q.origin_state,
          q.destination_state,
          MAX(sqr.quoted_price) as quoted_price
        FROM shipping_quotes q
        JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
        WHERE sqr.is_pricing_email = true
          AND sqr.quoted_price IS NOT NULL
          AND sqr.quoted_price >= 500
          AND sqr.quoted_price <= 10000
          AND q.service_type = $1
          AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
          AND CASE 
            WHEN LOWER(q.origin_state) IN ('ny', 'nj', 'pa', 'ct', 'ma') THEN 'NORTHEAST'
            WHEN LOWER(q.origin_state) IN ('tx', 'la', 'ok') THEN 'GULF'
            WHEN LOWER(q.origin_state) IN ('ca', 'wa', 'or') THEN 'WEST'
            WHEN LOWER(q.origin_state) IN ('fl', 'ga', 'sc', 'nc', 'va') THEN 'SOUTHEAST'
            WHEN LOWER(q.origin_state) IN ('il', 'oh', 'mi', 'in', 'wi') THEN 'MIDWEST'
            ELSE 'OTHER'
          END = $2
          AND CASE 
            WHEN LOWER(q.destination_state) IN ('ny', 'nj', 'pa', 'ct', 'ma') THEN 'NORTHEAST'
            WHEN LOWER(q.destination_state) IN ('tx', 'la', 'ok') THEN 'GULF'
            WHEN LOWER(q.destination_state) IN ('ca', 'wa', 'or') THEN 'WEST'
            WHEN LOWER(q.destination_state) IN ('fl', 'ga', 'sc', 'nc', 'va') THEN 'SOUTHEAST'
            WHEN LOWER(q.destination_state) IN ('il', 'oh', 'mi', 'in', 'wi') THEN 'MIDWEST'
            ELSE 'OTHER'
          END = $3
        GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city, q.origin_state, q.destination_state
        HAVING COUNT(*) <= 3
          AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 1.5
        ORDER BY RANDOM()
        LIMIT 10
      `;

      const laneRes = await client.query(laneQuery, [lane.service_type, lane.origin_region, lane.dest_region]);

      for (const quote of laneRes.rows) {
        console.log(`\n  Evaluating Quote ${quote.quote_id}: ${quote.origin_city} -> ${quote.destination_city}`);

        try {
          const result = await processEnhancedMatches([quote.quote_id], { useAI: true, minScore: 0.35 });

          if (result.matchDetails.length > 0) {
            const detail = result.matchDetails[0];
            const finalPrice = detail?.suggestedPrice;
            const actualPrice = parseFloat(quote.quoted_price);
            const matchCount = detail?.matchCount || 0;

            if (finalPrice && actualPrice) {
              const error = Math.abs(finalPrice - actualPrice) / actualPrice;
              totalError += error;
              count++;

              if (error <= 0.10) totalWithin10++;
              if (error <= 0.20) totalWithin20++;
              if (error <= 0.30) totalWithin30++;

              const errorSymbol = error <= 0.10 ? '✅' : error <= 0.20 ? '🟡' : error <= 0.30 ? '🟠' : '❌';
              console.log(`    ${errorSymbol} Actual: $${actualPrice.toLocaleString()}, Suggested: $${finalPrice.toLocaleString()}, Error: ${(error * 100).toFixed(1)}%, Matches: ${matchCount}`);

              results.push({
                quoteId: quote.quote_id,
                actualPrice,
                suggestedPrice: finalPrice,
                error,
                service: quote.service_type,
                origin: `${quote.origin_city}, ${quote.origin_state}`,
                destination: `${quote.destination_city}, ${quote.destination_state}`,
                matchCount,
              });
            }
          } else {
            console.log(`    ⚠️ No matches found`);
          }
        } catch (err) {
          console.log(`    ❌ Error: ${err}`);
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('EVALUATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Evaluated: ${count}`);
    console.log(`Within 10%: ${totalWithin10}/${count} (${count > 0 ? ((totalWithin10 / count) * 100).toFixed(1) : 0}%)`);
    console.log(`Within 20%: ${totalWithin20}/${count} (${count > 0 ? ((totalWithin20 / count) * 100).toFixed(1) : 0}%)`);
    console.log(`Within 30%: ${totalWithin30}/${count} (${count > 0 ? ((totalWithin30 / count) * 100).toFixed(1) : 0}%)`);
    console.log(`Average Error: ${count > 0 ? ((totalError / count) * 100).toFixed(2) : 0}%`);

    // Best and worst
    if (results.length > 0) {
      console.log('\n--- BEST PREDICTIONS ---');
      const sorted = results.sort((a, b) => a.error - b.error);
      for (const r of sorted.slice(0, 5)) {
        console.log(`  Quote ${r.quoteId} (${r.service}): ${r.origin} -> ${r.destination}`);
        console.log(`    $${r.actualPrice.toLocaleString()} vs $${r.suggestedPrice.toLocaleString()} (${(r.error * 100).toFixed(1)}% error, ${r.matchCount} matches)`);
      }

      console.log('\n--- WORST PREDICTIONS ---');
      for (const r of sorted.slice(-5).reverse()) {
        console.log(`  Quote ${r.quoteId} (${r.service}): ${r.origin} -> ${r.destination}`);
        console.log(`    $${r.actualPrice.toLocaleString()} vs $${r.suggestedPrice.toLocaleString()} (${(r.error * 100).toFixed(1)}% error, ${r.matchCount} matches)`);
      }
    }

  } finally {
    client.release();
    process.exit(0);
  }
}

evaluateWithQualityFilters().catch(e => { console.error(e); process.exit(1); });
