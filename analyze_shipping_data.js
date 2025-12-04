/**
 * Analyze shipping_emails and shipping_quotes data for pattern discovery
 * This script will help understand historical pricing patterns and improve matching accuracy
 */

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  ssl: { rejectUnauthorized: false },
});

async function analyzeData() {
  const client = await pool.connect();

  try {
    console.log('='.repeat(80));
    console.log('SHIPPING DATA ANALYSIS REPORT');
    console.log('='.repeat(80));

    // 1. Overall Statistics
    console.log('\n📊 OVERALL STATISTICS');
    console.log('-'.repeat(40));
    const stats = await client.query(`
      SELECT
        COUNT(DISTINCT e.email_id) as total_emails,
        COUNT(q.quote_id) as total_quotes,
        COUNT(CASE WHEN q.final_agreed_price IS NOT NULL THEN 1 END) as quotes_with_final_price,
        COUNT(CASE WHEN q.initial_quote_amount IS NOT NULL THEN 1 END) as quotes_with_initial_price,
        COUNT(CASE WHEN q.job_won = true THEN 1 END) as jobs_won,
        MIN(e.email_received_date) as earliest_email,
        MAX(e.email_received_date) as latest_email
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
    `);
    console.log(stats.rows[0]);

    // 2. Service Types Distribution
    console.log('\n🚚 SERVICE TYPES DISTRIBUTION');
    console.log('-'.repeat(40));
    const serviceTypes = await client.query(`
      SELECT
        COALESCE(service_type, 'UNKNOWN') as service_type,
        COUNT(*) as count,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_initial_quote,
        ROUND(AVG(final_agreed_price)::numeric, 2) as avg_final_price,
        MIN(initial_quote_amount) as min_price,
        MAX(initial_quote_amount) as max_price
      FROM shipping_quotes
      WHERE initial_quote_amount IS NOT NULL OR final_agreed_price IS NOT NULL
      GROUP BY service_type
      ORDER BY count DESC
    `);
    console.table(serviceTypes.rows);

    // 3. Route Analysis (Origin-Destination patterns)
    console.log('\n🗺️ TOP ROUTES (Origin → Destination)');
    console.log('-'.repeat(40));
    const routes = await client.query(`
      SELECT
        CONCAT(
          COALESCE(origin_city, 'Unknown'), ', ', COALESCE(origin_country, 'Unknown'),
          ' → ',
          COALESCE(destination_city, 'Unknown'), ', ', COALESCE(destination_country, 'Unknown')
        ) as route,
        COUNT(*) as count,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_initial_quote,
        ROUND(AVG(final_agreed_price)::numeric, 2) as avg_final_price
      FROM shipping_quotes
      GROUP BY origin_city, origin_country, destination_city, destination_country
      ORDER BY count DESC
      LIMIT 20
    `);
    console.table(routes.rows);

    // 4. Origin Countries
    console.log('\n🌍 ORIGIN COUNTRIES');
    console.log('-'.repeat(40));
    const originCountries = await client.query(`
      SELECT
        COALESCE(origin_country, 'UNKNOWN') as origin_country,
        COUNT(*) as count,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_price
      FROM shipping_quotes
      GROUP BY origin_country
      ORDER BY count DESC
      LIMIT 15
    `);
    console.table(originCountries.rows);

    // 5. Destination Countries
    console.log('\n🏁 DESTINATION COUNTRIES');
    console.log('-'.repeat(40));
    const destCountries = await client.query(`
      SELECT
        COALESCE(destination_country, 'UNKNOWN') as destination_country,
        COUNT(*) as count,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_price
      FROM shipping_quotes
      GROUP BY destination_country
      ORDER BY count DESC
      LIMIT 15
    `);
    console.table(destCountries.rows);

    // 6. Weight Ranges and Pricing
    console.log('\n⚖️ WEIGHT RANGES AND PRICING');
    console.log('-'.repeat(40));
    const weightRanges = await client.query(`
      SELECT
        CASE
          WHEN cargo_weight IS NULL THEN 'Unknown'
          WHEN cargo_weight < 100 THEN '< 100 kg'
          WHEN cargo_weight < 500 THEN '100-500 kg'
          WHEN cargo_weight < 1000 THEN '500-1000 kg'
          WHEN cargo_weight < 5000 THEN '1-5 tons'
          WHEN cargo_weight < 10000 THEN '5-10 tons'
          ELSE '> 10 tons'
        END as weight_range,
        COUNT(*) as count,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_price,
        ROUND(AVG(CASE WHEN cargo_weight > 0 THEN initial_quote_amount / cargo_weight END)::numeric, 2) as avg_price_per_kg
      FROM shipping_quotes
      GROUP BY
        CASE
          WHEN cargo_weight IS NULL THEN 'Unknown'
          WHEN cargo_weight < 100 THEN '< 100 kg'
          WHEN cargo_weight < 500 THEN '100-500 kg'
          WHEN cargo_weight < 1000 THEN '500-1000 kg'
          WHEN cargo_weight < 5000 THEN '1-5 tons'
          WHEN cargo_weight < 10000 THEN '5-10 tons'
          ELSE '> 10 tons'
        END
      ORDER BY count DESC
    `);
    console.table(weightRanges.rows);

    // 7. Cargo Types/Descriptions Analysis
    console.log('\n📦 COMMON CARGO DESCRIPTIONS (Keywords)');
    console.log('-'.repeat(40));
    const cargoDescriptions = await client.query(`
      SELECT
        cargo_description,
        COUNT(*) as count,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_price
      FROM shipping_quotes
      WHERE cargo_description IS NOT NULL AND cargo_description != ''
      GROUP BY cargo_description
      ORDER BY count DESC
      LIMIT 20
    `);
    console.table(cargoDescriptions.rows);

    // 8. Client Analysis
    console.log('\n👥 TOP CLIENTS BY QUOTE COUNT');
    console.log('-'.repeat(40));
    const clients = await client.query(`
      SELECT
        COALESCE(client_company_name, 'Unknown') as client,
        COUNT(*) as quote_count,
        COUNT(CASE WHEN job_won = true THEN 1 END) as won,
        ROUND(AVG(final_agreed_price)::numeric, 2) as avg_final_price
      FROM shipping_quotes
      GROUP BY client_company_name
      ORDER BY quote_count DESC
      LIMIT 15
    `);
    console.table(clients.rows);

    // 9. Price Negotiation Analysis
    console.log('\n💰 PRICE NEGOTIATION PATTERNS');
    console.log('-'.repeat(40));
    const negotiation = await client.query(`
      SELECT
        COUNT(*) as total_with_both_prices,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_initial,
        ROUND(AVG(final_agreed_price)::numeric, 2) as avg_final,
        ROUND(AVG((initial_quote_amount - final_agreed_price) / NULLIF(initial_quote_amount, 0) * 100)::numeric, 2) as avg_discount_percent,
        ROUND(AVG(discount_given)::numeric, 2) as avg_explicit_discount
      FROM shipping_quotes
      WHERE initial_quote_amount IS NOT NULL AND final_agreed_price IS NOT NULL
    `);
    console.table(negotiation.rows);

    // 10. Sample Quotes with Full Details
    console.log('\n📋 SAMPLE QUOTES WITH PRICING (Last 20)');
    console.log('-'.repeat(40));
    const samples = await client.query(`
      SELECT
        q.quote_id,
        q.origin_city,
        q.origin_country,
        q.destination_city,
        q.destination_country,
        q.cargo_description,
        q.cargo_weight,
        q.weight_unit,
        q.number_of_pieces,
        q.service_type,
        q.initial_quote_amount,
        q.final_agreed_price,
        q.quote_status,
        q.created_at::date as quote_date,
        e.email_sender_email
      FROM shipping_quotes q
      LEFT JOIN shipping_emails e ON q.email_id = e.email_id
      WHERE q.initial_quote_amount IS NOT NULL OR q.final_agreed_price IS NOT NULL
      ORDER BY q.created_at DESC
      LIMIT 20
    `);
    console.table(samples.rows);

    // 11. Port/Terminal Patterns (for drayage)
    console.log('\n🚢 PORT/TERMINAL PATTERNS');
    console.log('-'.repeat(40));
    const ports = await client.query(`
      SELECT
        origin_city,
        origin_country,
        COUNT(*) as shipments,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_price
      FROM shipping_quotes
      WHERE LOWER(origin_city) LIKE '%port%'
         OR LOWER(origin_full_address) LIKE '%port%'
         OR LOWER(origin_full_address) LIKE '%terminal%'
         OR LOWER(origin_full_address) LIKE '%pier%'
      GROUP BY origin_city, origin_country
      ORDER BY shipments DESC
      LIMIT 10
    `);
    console.table(ports.rows);

    // 12. Hazmat Analysis
    console.log('\n☢️ HAZARDOUS MATERIAL SHIPMENTS');
    console.log('-'.repeat(40));
    const hazmat = await client.query(`
      SELECT
        COALESCE(hazardous_material::text, 'Not Specified') as hazmat,
        COUNT(*) as count,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_price
      FROM shipping_quotes
      GROUP BY hazardous_material
      ORDER BY count DESC
    `);
    console.table(hazmat.rows);

    // 13. Monthly Trend
    console.log('\n📅 MONTHLY QUOTE TRENDS');
    console.log('-'.repeat(40));
    const monthly = await client.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as quotes,
        ROUND(AVG(initial_quote_amount)::numeric, 2) as avg_price,
        SUM(CASE WHEN job_won = true THEN 1 ELSE 0 END) as jobs_won
      FROM shipping_quotes
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month DESC
      LIMIT 12
    `);
    console.table(monthly.rows);

    // 14. Full dump for pattern analysis
    console.log('\n📊 EXPORTING FULL DATA FOR ANALYSIS...');
    console.log('-'.repeat(40));
    const fullData = await client.query(`
      SELECT
        q.*,
        e.email_subject,
        e.email_sender_email,
        e.email_body_preview
      FROM shipping_quotes q
      LEFT JOIN shipping_emails e ON q.email_id = e.email_id
      ORDER BY q.created_at DESC
    `);

    console.log(`Total records exported: ${fullData.rows.length}`);

    // Save to JSON for further analysis
    const fs = await import('fs');
    fs.writeFileSync('shipping_data_export.json', JSON.stringify(fullData.rows, null, 2));
    console.log('Data exported to shipping_data_export.json');

  } finally {
    client.release();
    await pool.end();
  }
}

analyzeData().catch(console.error);
