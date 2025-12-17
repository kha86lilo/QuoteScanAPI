import * as db from '../src/config/db.js';
import dotenv from 'dotenv';

dotenv.config();

interface QuoteAnalysis {
  quote_id: number;
  service_type: string;
  origin_city: string;
  destination_city: string;
  cargo_description: string;
  cargo_weight: number | null;
  weight_unit: string | null;
  min_price: number;
  max_price: number;
  avg_price: number;
  price_count: number;
  price_variance: number;
  notes_sample: string;
}

async function investigateFailures() {
  const client = await db.pool.connect();
  
  try {
    console.log('='.repeat(80));
    console.log('INVESTIGATING QUOTE PRICING PATTERNS');
    console.log('='.repeat(80));

    // 1. Find quotes with multiple price points (inconsistent pricing)
    console.log('\n--- QUOTES WITH HIGH PRICE VARIANCE ---');
    const varianceRes = await client.query(`
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        LEFT(q.cargo_description, 60) as cargo,
        q.cargo_weight,
        q.weight_unit,
        MIN(sqr.quoted_price) as min_price,
        MAX(sqr.quoted_price) as max_price,
        AVG(sqr.quoted_price) as avg_price,
        COUNT(*) as price_count,
        (MAX(sqr.quoted_price) - MIN(sqr.quoted_price)) / NULLIF(AVG(sqr.quoted_price), 0) as price_variance
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 500
        AND sqr.quoted_price <= 30000
        AND q.service_type IN ('Ground', 'Ocean', 'Drayage', 'Intermodal')
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city, 
               q.cargo_description, q.cargo_weight, q.weight_unit
      HAVING COUNT(*) > 1 
         AND (MAX(sqr.quoted_price) - MIN(sqr.quoted_price)) / NULLIF(AVG(sqr.quoted_price), 0) > 0.5
      ORDER BY price_variance DESC
      LIMIT 15
    `);
    
    console.log(`Found ${varianceRes.rows.length} quotes with >50% price variance:\n`);
    for (const row of varianceRes.rows) {
      console.log(`  Quote ${row.quote_id}: ${row.service_type} | ${row.origin_city} -> ${row.destination_city}`);
      console.log(`    Price Range: $${parseFloat(row.min_price).toLocaleString()} - $${parseFloat(row.max_price).toLocaleString()} (${row.price_count} prices, ${(row.price_variance * 100).toFixed(0)}% variance)`);
      console.log(`    Cargo: ${row.cargo || 'Unknown'}`);
    }

    // 2. Find same-city quotes (likely warehouse/loading operations)
    console.log('\n--- SAME ORIGIN/DESTINATION QUOTES ---');
    const sameCityRes = await client.query(`
      SELECT DISTINCT
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        LEFT(q.cargo_description, 60) as cargo,
        sqr.quoted_price
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) = LOWER(TRIM(q.destination_city))
        AND q.service_type IN ('Ground', 'Ocean', 'Drayage', 'Intermodal')
      ORDER BY q.quote_id
      LIMIT 20
    `);
    
    console.log(`Found ${sameCityRes.rows.length} same-city quotes (potential warehouse ops):\n`);
    for (const row of sameCityRes.rows) {
      console.log(`  Quote ${row.quote_id}: ${row.service_type} | ${row.origin_city} -> ${row.destination_city} | $${row.quoted_price}`);
    }

    // 3. Find per-unit pricing patterns (keywords like "per container", "each")
    console.log('\n--- POTENTIAL PER-UNIT PRICING (notes contain "per", "each", "container") ---');
    const perUnitRes = await client.query(`
      SELECT DISTINCT ON (q.quote_id)
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        sqr.quoted_price,
        LEFT(sqr.notes, 150) as notes
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND (LOWER(sqr.notes) LIKE '%per container%' 
             OR LOWER(sqr.notes) LIKE '%per 40%'
             OR LOWER(sqr.notes) LIKE '%per unit%'
             OR LOWER(sqr.notes) LIKE '% each%'
             OR LOWER(sqr.notes) LIKE '%price is per%')
        AND q.service_type IN ('Ground', 'Ocean', 'Drayage', 'Intermodal')
      ORDER BY q.quote_id, sqr.quoted_price
      LIMIT 20
    `);
    
    console.log(`Found ${perUnitRes.rows.length} potential per-unit pricing quotes:\n`);
    for (const row of perUnitRes.rows) {
      console.log(`  Quote ${row.quote_id}: ${row.service_type} | $${row.quoted_price}`);
      console.log(`    Notes: ${row.notes}`);
    }

    // 4. Find quotes with very low prices for their service type
    console.log('\n--- UNUSUALLY LOW PRICES BY SERVICE TYPE ---');
    const lowPriceRes = await client.query(`
      WITH service_stats AS (
        SELECT 
          q.service_type,
          AVG(sqr.quoted_price) as avg_price,
          STDDEV(sqr.quoted_price) as stddev_price,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sqr.quoted_price) as p25
        FROM shipping_quotes q
        JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
        WHERE sqr.is_pricing_email = true
          AND sqr.quoted_price IS NOT NULL
          AND q.service_type IN ('Ground', 'Ocean', 'Drayage', 'Intermodal')
        GROUP BY q.service_type
      )
      SELECT DISTINCT ON (q.quote_id)
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        sqr.quoted_price,
        ss.avg_price as service_avg,
        ss.p25 as service_p25
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      JOIN service_stats ss ON q.service_type = ss.service_type
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price < ss.p25 * 0.5
        AND sqr.quoted_price >= 500
      ORDER BY q.quote_id, sqr.quoted_price
      LIMIT 15
    `);
    
    console.log(`Found ${lowPriceRes.rows.length} quotes with unusually low prices:\n`);
    for (const row of lowPriceRes.rows) {
      console.log(`  Quote ${row.quote_id}: ${row.service_type} | $${row.quoted_price} (service avg: $${parseFloat(row.service_avg).toFixed(0)}, P25: $${parseFloat(row.service_p25).toFixed(0)})`);
      console.log(`    Route: ${row.origin_city} -> ${row.destination_city}`);
    }

    // 5. Analyze price distribution by service type
    console.log('\n--- PRICE DISTRIBUTION BY SERVICE TYPE ---');
    const distRes = await client.query(`
      SELECT 
        q.service_type,
        COUNT(DISTINCT q.quote_id) as quote_count,
        ROUND(AVG(sqr.quoted_price)::numeric, 0) as avg_price,
        ROUND(PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY sqr.quoted_price)::numeric, 0) as p10,
        ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sqr.quoted_price)::numeric, 0) as p25,
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY sqr.quoted_price)::numeric, 0) as median,
        ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sqr.quoted_price)::numeric, 0) as p75,
        ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY sqr.quoted_price)::numeric, 0) as p90
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 500
        AND sqr.quoted_price <= 30000
        AND q.service_type IN ('Ground', 'Ocean', 'Drayage', 'Intermodal')
      GROUP BY q.service_type
      ORDER BY quote_count DESC
    `);
    
    console.log('Service Type    | Count | Avg    | P10    | P25    | Median | P75    | P90');
    console.log('-'.repeat(85));
    for (const row of distRes.rows) {
      console.log(`${row.service_type.padEnd(15)} | ${String(row.quote_count).padStart(5)} | $${String(row.avg_price).padStart(5)} | $${String(row.p10).padStart(5)} | $${String(row.p25).padStart(5)} | $${String(row.median).padStart(6)} | $${String(row.p75).padStart(5)} | $${String(row.p90).padStart(5)}`);
    }

    // 6. Find quotes that would be good for evaluation (single price, standard range)
    console.log('\n--- CLEAN EVALUATION CANDIDATES (single price, mid-range) ---');
    const cleanRes = await client.query(`
      SELECT 
        q.quote_id,
        q.service_type,
        q.origin_city,
        q.destination_city,
        MAX(sqr.quoted_price) as quoted_price,
        COUNT(*) as price_count,
        q.cargo_weight,
        q.weight_unit
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 1500
        AND sqr.quoted_price <= 5000
        AND q.origin_city IS NOT NULL
        AND q.destination_city IS NOT NULL
        AND LOWER(TRIM(q.origin_city)) != LOWER(TRIM(q.destination_city))
        AND q.service_type IN ('Ground', 'Drayage')
      GROUP BY q.quote_id, q.service_type, q.origin_city, q.destination_city, q.cargo_weight, q.weight_unit
      HAVING COUNT(*) = 1
      ORDER BY q.quote_id
      LIMIT 30
    `);
    
    console.log(`Found ${cleanRes.rows.length} clean evaluation candidates:\n`);
    for (const row of cleanRes.rows) {
      console.log(`  Quote ${row.quote_id}: ${row.service_type} | ${row.origin_city} -> ${row.destination_city} | $${row.quoted_price}`);
    }

  } finally {
    client.release();
    process.exit(0);
  }
}

investigateFailures().catch(e => { console.error(e); process.exit(1); });
