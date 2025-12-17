import * as db from '../src/config/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkData() {
  const client = await db.pool.connect();

  try {
    console.log('='.repeat(80));
    console.log('DATA QUALITY CHECK');
    console.log('='.repeat(80));

    // Check 1: How many quotes have pricing?
    const q1 = await client.query(`
      SELECT COUNT(DISTINCT q.quote_id) as count
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
    `);
    console.log(`\n1. Total quotes with pricing: ${q1.rows[0].count}`);

    // Check 2: Ground/Drayage with pricing
    const q2 = await client.query(`
      SELECT q.service_type, COUNT(DISTINCT q.quote_id) as count
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND q.service_type IN ('Ground', 'Drayage')
      GROUP BY q.service_type
    `);
    console.log('\n2. Ground/Drayage quotes with pricing:');
    for (const r of q2.rows) {
      console.log(`   ${r.service_type}: ${r.count}`);
    }

    // Check 3: Price ranges
    const q3 = await client.query(`
      SELECT 
        q.service_type,
        MIN(sqr.quoted_price)::int as min_price,
        MAX(sqr.quoted_price)::int as max_price,
        AVG(sqr.quoted_price)::int as avg_price,
        COUNT(*) as price_count
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 100
        AND q.service_type IN ('Ground', 'Drayage')
      GROUP BY q.service_type
    `);
    console.log('\n3. Price ranges by service type:');
    for (const r of q3.rows) {
      console.log(`   ${r.service_type}: $${r.min_price} - $${r.max_price} (avg: $${r.avg_price}, count: ${r.price_count})`);
    }

    // Check 4: How many have different origin/destination cities?
    const q4 = await client.query(`
      SELECT COUNT(DISTINCT q.quote_id) as count
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1000
        AND sqr.quoted_price <= 6000
        AND q.service_type IN ('Ground', 'Drayage')
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
    `);
    console.log(`\n4. Ground/Drayage $1000-6000 with different cities: ${q4.rows[0].count}`);

    // Check 5: Quotes grouped by price count (variance)
    const q5 = await client.query(`
      SELECT price_count, COUNT(*) as quote_count
      FROM (
        SELECT q.quote_id, COUNT(*) as price_count
        FROM shipping_quotes q
        JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
        WHERE sqr.is_pricing_email = true
          AND sqr.quoted_price IS NOT NULL
          AND q.service_type IN ('Ground', 'Drayage')
        GROUP BY q.quote_id
      ) sub
      GROUP BY price_count
      ORDER BY price_count
    `);
    console.log('\n5. Quotes by number of price replies:');
    for (const r of q5.rows) {
      console.log(`   ${r.price_count} prices: ${r.quote_count} quotes`);
    }

    // Check 6: Sample some quotes with low variance
    const q6 = await client.query(`
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        MIN(sqr.quoted_price)::int as min_price,
        MAX(sqr.quoted_price)::int as max_price,
        COUNT(*) as price_count,
        (MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0))::numeric(5,2) as variance_ratio
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1000
        AND sqr.quoted_price <= 6000
        AND q.service_type IN ('Ground', 'Drayage')
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city
      HAVING COUNT(*) <= 2
        AND MAX(sqr.quoted_price) / NULLIF(MIN(sqr.quoted_price), 0) < 1.3
      ORDER BY q.quote_id DESC
      LIMIT 10
    `);
    console.log('\n6. Sample low-variance quotes:');
    for (const r of q6.rows) {
      console.log(`   Quote ${r.quote_id} (${r.service_type}): ${r.origin_city} -> ${r.destination_city}, $${r.min_price}-$${r.max_price}, Variance: ${r.variance_ratio}`);
    }

    // Check 7: How many after removing per-unit
    const q7 = await client.query(`
      SELECT COUNT(DISTINCT q.quote_id) as count
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1000
        AND sqr.quoted_price <= 6000
        AND q.service_type IN ('Ground', 'Drayage')
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
        AND sqr.notes NOT LIKE '%per container%'
        AND sqr.notes NOT LIKE '%per 40%'
    `);
    console.log(`\n7. After excluding per-unit notes: ${q7.rows[0].count}`);

  } finally {
    client.release();
    process.exit(0);
  }
}

checkData().catch(console.error);
