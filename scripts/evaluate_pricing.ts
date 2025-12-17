import * as db from '../src/config/db';
import { processEnhancedMatches } from '../src/services/enhancedQuoteMatchingService';
import dotenv from 'dotenv';

dotenv.config();

interface EvaluationResult {
  quoteId: number;
  actualPrice: number;
  suggestedPrice: number;
  error: number;
  service?: string;
}

async function evaluate() {
  console.log('Starting evaluation...');
  
  // 1. Fetch quotes with expert replies - get unique quote_ids with reasonable prices
  const client = await db.pool.connect();
  let quotes;
  try {
    // Select quotes with service types that have good historical coverage
    // Use MAX price to get the total quote rather than per-unit or partial prices
    // Filter for mid-range prices ($1000-$6000) to focus on standard quotes
    // Ground: 250, Ocean: 277, Drayage: 233, Intermodal: 119
    const res = await client.query(`
      SELECT q.quote_id, MAX(sqr.quoted_price) as quoted_price, q.service_type,
             q.origin_city, q.destination_city, q.cargo_weight
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1000
        AND sqr.quoted_price <= 6000
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND q.service_type IN ('Ground', 'Ocean', 'Drayage', 'Intermodal')
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city, q.cargo_weight
      ORDER BY q.quote_id
      LIMIT 10
    `);
    quotes = res.rows;
  } finally {
    client.release();
  }

  console.log(`Found ${quotes.length} unique quotes for evaluation.`);

  let totalError = 0;
  let count = 0;
  let within10Percent = 0;
  let within20Percent = 0;
  let within30Percent = 0;

  const results: EvaluationResult[] = [];

  for (const quote of quotes) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Evaluating Quote ID: ${quote.quote_id} (Service: ${quote.service_type || 'Unknown'})`);
    console.log(`  Route: ${quote.origin_city} -> ${quote.destination_city}`);
    
    // We use a lower minScore to ensure we get matches for evaluation purposes
    const result = await processEnhancedMatches([quote.quote_id], { useAI: true, minScore: 0.3 });
    
    if (result.matchDetails.length > 0) {
      const detail = result.matchDetails[0];

      const finalPrice = detail?.suggestedPrice;
      const actualPrice = parseFloat(quote.quoted_price);

      if (finalPrice && actualPrice) {
        const error = Math.abs(finalPrice - actualPrice) / actualPrice;
        totalError += error;
        count++;
        
        if (error <= 0.10) within10Percent++;
        if (error <= 0.20) within20Percent++;
        if (error <= 0.30) within30Percent++;

        const errorSymbol = error <= 0.10 ? '✅' : error <= 0.20 ? '🟡' : error <= 0.30 ? '🟠' : '❌';
        console.log(`  ${errorSymbol} Actual: $${actualPrice.toLocaleString()}, Suggested: $${finalPrice.toLocaleString()}, Error: ${(error * 100).toFixed(1)}%`);
        
        results.push({
          quoteId: quote.quote_id,
          actualPrice,
          suggestedPrice: finalPrice,
          error,
          service: quote.service_type
        });
      } else {
        console.log(`  ⚠️ Could not evaluate quote ${quote.quote_id} due to missing price data.`);
      }
    } else {
      console.log(`  ⚠️ No matches found.`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('EVALUATION SUMMARY');
  console.log('='.repeat(70));
  
  if (count > 0) {
    console.log(`\nTotal Evaluated: ${count}`);
    console.log(`Average Error: ${(totalError / count * 100).toFixed(2)}%`);
    console.log(`\nAccuracy Metrics:`);
    console.log(`  Within 10%: ${within10Percent}/${count} (${(within10Percent / count * 100).toFixed(1)}%)`);
    console.log(`  Within 20%: ${within20Percent}/${count} (${(within20Percent / count * 100).toFixed(1)}%)`);
    console.log(`  Within 30%: ${within30Percent}/${count} (${(within30Percent / count * 100).toFixed(1)}%)`);
    
    // Show worst predictions
    const worstResults = results.sort((a, b) => b.error - a.error).slice(0, 5);
    console.log(`\nWorst 5 Predictions:`);
    for (const r of worstResults) {
      console.log(`  Quote ${r.quoteId} (${r.service}): Actual $${r.actualPrice.toLocaleString()}, Suggested $${r.suggestedPrice.toLocaleString()} (${(r.error * 100).toFixed(1)}% error)`);
    }

    // Show best predictions
    const bestResults = results.sort((a, b) => a.error - b.error).slice(0, 5);
    console.log(`\nBest 5 Predictions:`);
    for (const r of bestResults) {
      console.log(`  Quote ${r.quoteId} (${r.service}): Actual $${r.actualPrice.toLocaleString()}, Suggested $${r.suggestedPrice.toLocaleString()} (${(r.error * 100).toFixed(1)}% error)`);
    }
  } else {
    console.log('No evaluations performed.');
  }
  
  process.exit(0);
}

evaluate().catch(console.error);
