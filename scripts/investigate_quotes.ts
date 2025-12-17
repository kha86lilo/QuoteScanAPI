import * as db from '../src/config/db.js';

async function investigate() {
  const client = await db.pool.connect();
  try {
    // Check the worst performing quotes
    const quoteIds = [4194, 5722, 5013, 6213, 6214, 7296, 6582, 6614];
    const res = await client.query(`
      SELECT q.quote_id, q.service_type, q.origin_city, q.destination_city,
             q.cargo_description, q.cargo_weight, q.weight_unit,
             sqr.quoted_price, sqr.notes
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE q.quote_id = ANY($1)
        AND sqr.is_pricing_email = true
    `, [quoteIds]);
    
    for (const row of res.rows) {
      console.log('\n' + '='.repeat(60));
      console.log('Quote ID:', row.quote_id);
      console.log('Service:', row.service_type);
      console.log('Route:', row.origin_city, '->', row.destination_city);
      console.log('Cargo:', (row.cargo_description || 'Unknown').substring(0, 100));
      console.log('Weight:', row.cargo_weight, row.weight_unit);
      console.log('Actual Price:', '$' + row.quoted_price);
      console.log('Notes:', (row.notes || '').substring(0, 200));
    }
  } finally {
    client.release();
    process.exit(0);
  }
}
investigate().catch(e => { console.error(e); process.exit(1); });
