import * as db from '../src/config/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkHistorical() {
  const client = await db.pool.connect();

  try {
    console.log('='.repeat(80));
    console.log('HISTORICAL QUOTES DATA CHECK');
    console.log('='.repeat(80));

    // Check 1: How many quotes have final_agreed_price or initial_quote_amount?
    const q1 = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE final_agreed_price IS NOT NULL AND final_agreed_price >= 100 AND final_agreed_price <= 50000) as with_final_price,
        COUNT(*) FILTER (WHERE initial_quote_amount IS NOT NULL AND initial_quote_amount >= 100 AND initial_quote_amount <= 50000) as with_initial_price,
        COUNT(*) FILTER (WHERE (final_agreed_price IS NOT NULL AND final_agreed_price >= 100 AND final_agreed_price <= 50000) OR (initial_quote_amount IS NOT NULL AND initial_quote_amount >= 100 AND initial_quote_amount <= 50000)) as with_any_price
      FROM shipping_quotes
    `);
    console.log(`\n1. Quotes with pricing data (from shipping_quotes table):`);
    console.log(`   With final_agreed_price: ${q1.rows[0].with_final_price}`);
    console.log(`   With initial_quote_amount: ${q1.rows[0].with_initial_price}`);
    console.log(`   With any price: ${q1.rows[0].with_any_price}`);

    // Check 2: Price ranges in shipping_quotes
    const q2 = await client.query(`
      SELECT 
        service_type,
        COUNT(*) as count,
        AVG(COALESCE(final_agreed_price, initial_quote_amount))::int as avg_price,
        MIN(COALESCE(final_agreed_price, initial_quote_amount))::int as min_price,
        MAX(COALESCE(final_agreed_price, initial_quote_amount))::int as max_price
      FROM shipping_quotes
      WHERE (final_agreed_price IS NOT NULL AND final_agreed_price >= 100 AND final_agreed_price <= 50000)
         OR (initial_quote_amount IS NOT NULL AND initial_quote_amount >= 100 AND initial_quote_amount <= 50000)
      GROUP BY service_type
      ORDER BY count DESC
    `);
    console.log(`\n2. Price distribution by service (from shipping_quotes):`);
    for (const r of q2.rows) {
      console.log(`   ${r.service_type}: ${r.count} quotes, $${r.min_price}-$${r.max_price} (avg: $${r.avg_price})`);
    }

    // Check 3: Compare staff_quotes_replies vs shipping_quotes
    const q3 = await client.query(`
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        q.final_agreed_price,
        q.initial_quote_amount,
        MAX(sqr.quoted_price) as staff_reply_price
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city, q.final_agreed_price, q.initial_quote_amount
      LIMIT 20
    `);
    console.log(`\n3. Comparison of shipping_quotes prices vs staff_quotes_replies prices:`);
    for (const r of q3.rows) {
      const sqPrice = r.final_agreed_price || r.initial_quote_amount || 'NULL';
      const replyPrice = r.staff_reply_price;
      const match = sqPrice === replyPrice ? '✅' : (sqPrice === 'NULL' ? '⚠️ No SQ price' : '❌ Mismatch');
      console.log(`   Quote ${r.quote_id}: SQ=$${sqPrice}, Reply=$${replyPrice} ${match}`);
    }

    // Check 4: Sample historical quotes that would be used for matching
    const q4 = await client.query(`
      SELECT 
        quote_id,
        service_type,
        origin_city,
        destination_city,
        COALESCE(final_agreed_price, initial_quote_amount) as price,
        CASE WHEN final_agreed_price IS NOT NULL THEN 'final' ELSE 'initial' END as price_source
      FROM shipping_quotes
      WHERE (final_agreed_price IS NOT NULL AND final_agreed_price >= 100 AND final_agreed_price <= 50000)
         OR (initial_quote_amount IS NOT NULL AND initial_quote_amount >= 100 AND initial_quote_amount <= 50000)
      ORDER BY created_at DESC
      LIMIT 15
    `);
    console.log(`\n4. Sample recent historical quotes (used for matching):`);
    for (const r of q4.rows) {
      console.log(`   Quote ${r.quote_id} (${r.service_type}): ${r.origin_city} -> ${r.destination_city}, $${r.price} (${r.price_source})`);
    }

    // Check 5: How many Ground/Drayage have good historical data
    const q5 = await client.query(`
      SELECT 
        service_type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE origin_city IS NOT NULL AND destination_city IS NOT NULL AND LOWER(TRIM(origin_city)) != LOWER(TRIM(destination_city))) as diff_cities
      FROM shipping_quotes
      WHERE ((final_agreed_price IS NOT NULL AND final_agreed_price >= 500 AND final_agreed_price <= 10000)
         OR (initial_quote_amount IS NOT NULL AND initial_quote_amount >= 500 AND initial_quote_amount <= 10000))
        AND service_type IN ('Ground', 'Drayage')
      GROUP BY service_type
    `);
    console.log(`\n5. Ground/Drayage with valid prices ($500-$10000):`);
    for (const r of q5.rows) {
      console.log(`   ${r.service_type}: ${r.total} total, ${r.diff_cities} with different cities`);
    }

  } finally {
    client.release();
    process.exit(0);
  }
}

checkHistorical().catch(console.error);
