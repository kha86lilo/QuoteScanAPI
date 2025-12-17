import * as db from '../src/config/db.js';
import { processEnhancedMatches } from '../src/services/enhancedQuoteMatchingService.js';
import dotenv from 'dotenv';

dotenv.config();

async function simpleEvaluation() {
  console.log('Starting Focused Ground/Drayage Evaluation...\n');

  const client = await db.pool.connect();

  try {
    // Get Ground and Drayage quotes only - these have best data coverage
    // Filter for:
    // - Single price point (low variance)
    // - Mid-range pricing ($1000-$6000)
    // - Different cities
    const query = `
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.origin_state,
        q.destination_city,
        q.destination_state,
        q.cargo_description,
        q.cargo_weight,
        MAX(sqr.quoted_price) as quoted_price
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1000
        AND sqr.quoted_price <= 6000
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
        AND q.service_type IN ('Ground', 'Drayage')
        -- Exclude per-unit keywords
        AND NOT EXISTS (
          SELECT 1 FROM staff_quotes_replies sqr2 
          WHERE sqr2.related_quote_id = q.quote_id 
          AND (
            LOWER(sqr2.notes) LIKE '%per container%' 
            OR LOWER(sqr2.notes) LIKE '%per 40%' 
            OR LOWER(sqr2.notes) LIKE '%per 20%'
            OR LOWER(sqr2.notes) LIKE '%each container%'
          )
        )
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.origin_state, q.destination_city, q.destination_state, q.cargo_description, q.cargo_weight
      HAVING COUNT(*) <= 2  -- Very few revisions
        AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 1.3  -- Low variance
      ORDER BY RANDOM()
      LIMIT 30
    `;

    console.log('Fetching clean evaluation samples...');
    const res = await client.query(query);
    const quotes = res.rows;
    console.log(`Found ${quotes.length} clean quotes to evaluate\n`);

    let totalError = 0;
    let count = 0;
    let within10 = 0;
    let within20 = 0;
    let within30 = 0;
    const results: { quoteId: number; actual: number; suggested: number; error: number; service: string }[] = [];

    for (const quote of quotes) {
      console.log(`Evaluating Quote ${quote.quote_id} (${quote.service_type}): ${quote.origin_city}, ${quote.origin_state} -> ${quote.destination_city}, ${quote.destination_state}`);

      try {
        const result = await processEnhancedMatches([quote.quote_id], { useAI: true, minScore: 0.35 });

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
            console.log(`  ${errorSymbol} Actual: $${actualPrice.toLocaleString()}, Suggested: $${finalPrice.toLocaleString()}, Error: ${(error * 100).toFixed(1)}%\n`);

            results.push({
              quoteId: quote.quote_id,
              actual: actualPrice,
              suggested: finalPrice,
              error,
              service: quote.service_type,
            });
          }
        } else {
          console.log(`  ⚠️ No matches found\n`);
        }
      } catch (err) {
        console.log(`  ❌ Error: ${err}\n`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('EVALUATION SUMMARY - Ground/Drayage Focus');
    console.log('='.repeat(80));
    console.log(`Total Evaluated: ${count}`);
    console.log(`Within 10%: ${within10}/${count} (${count > 0 ? ((within10 / count) * 100).toFixed(1) : 0}%)`);
    console.log(`Within 20%: ${within20}/${count} (${count > 0 ? ((within20 / count) * 100).toFixed(1) : 0}%)`);
    console.log(`Within 30%: ${within30}/${count} (${count > 0 ? ((within30 / count) * 100).toFixed(1) : 0}%)`);
    console.log(`Average Error: ${count > 0 ? ((totalError / count) * 100).toFixed(2) : 0}%`);

    // Best predictions
    if (results.length > 0) {
      console.log('\n--- BEST PREDICTIONS ---');
      const sorted = results.sort((a, b) => a.error - b.error);
      for (const r of sorted.slice(0, 5)) {
        console.log(`  Quote ${r.quoteId} (${r.service}): $${r.actual.toLocaleString()} vs $${r.suggested.toLocaleString()} (${(r.error * 100).toFixed(1)}%)`);
      }

      console.log('\n--- WORST PREDICTIONS ---');
      for (const r of sorted.slice(-5).reverse()) {
        console.log(`  Quote ${r.quoteId} (${r.service}): $${r.actual.toLocaleString()} vs $${r.suggested.toLocaleString()} (${(r.error * 100).toFixed(1)}%)`);
      }
    }

  } finally {
    client.release();
    process.exit(0);
  }
}

simpleEvaluation().catch(e => { console.error(e); process.exit(1); });
