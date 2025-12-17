import * as db from '../src/config/db.js';

async function analyze() {
  const client = await db.pool.connect();
  try {
    // 1. Count total historical quotes with pricing
    const totalRes = await client.query(`
      SELECT COUNT(*) as total FROM shipping_quotes 
      WHERE (final_agreed_price IS NOT NULL AND final_agreed_price >= 100 AND final_agreed_price <= 50000)
         OR (initial_quote_amount IS NOT NULL AND initial_quote_amount >= 100 AND initial_quote_amount <= 50000)
    `);
    console.log('Total historical quotes with valid pricing:', totalRes.rows[0].total);

    // 2. Count by service type
    const serviceRes = await client.query(`
      SELECT service_type, COUNT(*) as count,
             ROUND(AVG(COALESCE(final_agreed_price, initial_quote_amount))::numeric, 2) as avg_price
      FROM shipping_quotes 
      WHERE (final_agreed_price IS NOT NULL AND final_agreed_price >= 100 AND final_agreed_price <= 50000)
         OR (initial_quote_amount IS NOT NULL AND initial_quote_amount >= 100 AND initial_quote_amount <= 50000)
      GROUP BY service_type
      ORDER BY count DESC
    `);
    console.log('\nBy Service Type:');
    for (const row of serviceRes.rows) {
      console.log(`  ${row.service_type || 'NULL'}: ${row.count} quotes (avg $${row.avg_price})`);
    }

    // 3. Count available evaluation samples (quotes with staff replies)
    const evalRes = await client.query(`
      SELECT q.service_type, COUNT(DISTINCT q.quote_id) as count
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 500
        AND sqr.quoted_price <= 30000
      GROUP BY q.service_type
      ORDER BY count DESC
    `);
    console.log('\nEvaluation Samples (with staff replies) by Service:');
    for (const row of evalRes.rows) {
      console.log(`  ${row.service_type || 'NULL'}: ${row.count} quotes`);
    }
    
    // 4. Total evaluation samples
    const totalEvalRes = await client.query(`
      SELECT COUNT(DISTINCT q.quote_id) as total
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 500
        AND sqr.quoted_price <= 30000
    `);
    console.log('\nTotal Evaluation Samples:', totalEvalRes.rows[0].total);
    
  } finally {
    client.release();
    process.exit(0);
  }
}
analyze().catch(e => { console.error(e); process.exit(1); });
