import * as db from '../src/config/db.js';
import dotenv from 'dotenv';

dotenv.config();

// Analyze the worst failures from two-phase evaluation
const worstQuotes = [
  { id: 13790, phase: 'OCEAN_INTERMODAL', actual: 1925, suggested: 10395, error: 440 },
  { id: 7732, phase: 'OCEAN_INTERMODAL', actual: 5335, suggested: 18976, error: 256 },
  { id: 4194, phase: 'DRAYAGE_SHORT_HAUL', actual: 1200, suggested: 3900, error: 225 },
  { id: 5302, phase: 'DRAYAGE_SHORT_HAUL', actual: 1315, suggested: 3627, error: 176 },
  { id: 3866, phase: 'CLEAN_GROUND_DRAYAGE', actual: 3850, suggested: 1217, error: 68 },
  { id: 3874, phase: 'CLEAN_GROUND_DRAYAGE', actual: 3918, suggested: 1387, error: 65 },
  { id: 6721, phase: 'CLEAN_GROUND_DRAYAGE', actual: 5150, suggested: 1837, error: 64 },
];

async function analyzeFailures() {
  const client = await db.pool.connect();

  try {
    console.log('='.repeat(80));
    console.log('ANALYZING WORST PREDICTIONS');
    console.log('='.repeat(80));

    for (const q of worstQuotes) {
      console.log(`\n--- Quote ${q.id} (${q.phase}) ---`);
      console.log(`Actual: $${q.actual.toLocaleString()}, Suggested: $${q.suggested.toLocaleString()}, Error: ${q.error}%`);

      // Get quote details
      const quoteRes = await client.query(`
        SELECT 
          q.quote_id,
          q.service_type,
          q.origin_city, q.origin_state, q.origin_country,
          q.destination_city, q.destination_state, q.destination_country,
          q.cargo_description,
          q.weight_lbs,
          q.dimensions,
          q.subject
        FROM shipping_quotes q
        WHERE q.quote_id = $1
      `, [q.id]);

      if (quoteRes.rows.length > 0) {
        const quote = quoteRes.rows[0];
        console.log(`\nQuote Details:`);
        console.log(`  Service: ${quote.service_type}`);
        console.log(`  Route: ${quote.origin_city}, ${quote.origin_state}, ${quote.origin_country} -> ${quote.destination_city}, ${quote.destination_state}, ${quote.destination_country}`);
        console.log(`  Weight: ${quote.weight_lbs ? `${quote.weight_lbs.toLocaleString()} lbs` : 'Not specified'}`);
        console.log(`  Dimensions: ${quote.dimensions || 'Not specified'}`);
        console.log(`  Cargo: ${quote.cargo_description?.substring(0, 150)}...`);
        console.log(`  Subject: ${quote.subject?.substring(0, 100)}`);
      }

      // Get all pricing replies for this quote
      const repliesRes = await client.query(`
        SELECT 
          reply_id,
          quoted_price,
          notes,
          is_pricing_email
        FROM staff_quotes_replies
        WHERE related_quote_id = $1
        AND is_pricing_email = true
        ORDER BY quoted_price
      `, [q.id]);

      console.log(`\nPricing Replies (${repliesRes.rows.length}):`);
      for (const reply of repliesRes.rows) {
        console.log(`  - $${reply.quoted_price?.toLocaleString()} | Notes: ${reply.notes?.substring(0, 80) || 'N/A'}`);
      }

      // Check for similar historical quotes
      if (quoteRes.rows.length > 0) {
        const quote = quoteRes.rows[0];
        const similarRes = await client.query(`
          SELECT 
            q.quote_id,
            q.origin_city,
            q.destination_city,
            q.service_type,
            q.weight_lbs,
            MAX(sqr.quoted_price) as max_price
          FROM shipping_quotes q
          JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
          WHERE q.quote_id != $1
            AND q.service_type = $2
            AND sqr.is_pricing_email = true
            AND sqr.quoted_price IS NOT NULL
            AND sqr.quoted_price >= 100
          GROUP BY q.quote_id, q.origin_city, q.destination_city, q.service_type, q.weight_lbs
          ORDER BY q.quote_id DESC
          LIMIT 5
        `, [q.id, quote.service_type]);

        console.log(`\nSimilar Historical Quotes (${quote.service_type}):`);
        for (const sim of similarRes.rows) {
          console.log(`  - Quote ${sim.quote_id}: ${sim.origin_city} -> ${sim.destination_city}, Weight: ${sim.weight_lbs?.toLocaleString() || 'N/A'} lbs, Price: $${sim.max_price?.toLocaleString()}`);
        }
      }
    }

    // Check patterns in failures
    console.log('\n' + '='.repeat(80));
    console.log('PATTERN ANALYSIS');
    console.log('='.repeat(80));

    // 1. Check if failures have special cargo
    console.log('\n--- Special Cargo in Failures ---');
    for (const q of worstQuotes) {
      const cargoRes = await client.query(`
        SELECT cargo_description, weight_lbs FROM shipping_quotes WHERE quote_id = $1
      `, [q.id]);
      if (cargoRes.rows.length > 0) {
        const cargo = cargoRes.rows[0].cargo_description?.toLowerCase() || '';
        const weight = cargoRes.rows[0].weight_lbs;
        const hasHeavyEquipment = /excavator|loader|forklift|generator|compactor|backhoe|truck|equipment/i.test(cargo);
        const hasContainers = /container|40'|20'/i.test(cargo);
        console.log(`Quote ${q.id}: Heavy Equipment: ${hasHeavyEquipment}, Containers: ${hasContainers}, Weight: ${weight?.toLocaleString() || 'N/A'} lbs`);
      }
    }

    // 2. Analyze price distribution by service type
    console.log('\n--- Price Distribution by Service Type ---');
    const priceDistRes = await client.query(`
      SELECT 
        q.service_type,
        COUNT(*) as count,
        AVG(sqr.quoted_price)::int as avg_price,
        MIN(sqr.quoted_price)::int as min_price,
        MAX(sqr.quoted_price)::int as max_price,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sqr.quoted_price)::int as median_price
      FROM shipping_quotes q
      JOIN staff_quotes_replies sqr ON q.quote_id = sqr.related_quote_id
      WHERE sqr.is_pricing_email = true
        AND sqr.quoted_price IS NOT NULL
        AND sqr.quoted_price >= 100
        AND sqr.quoted_price <= 50000
      GROUP BY q.service_type
      ORDER BY count DESC
    `);

    console.log('Service Type | Count | Avg | Median | Min | Max');
    for (const row of priceDistRes.rows) {
      console.log(`${row.service_type?.padEnd(12)} | ${row.count?.toString().padStart(5)} | $${row.avg_price?.toLocaleString().padStart(6)} | $${row.median_price?.toLocaleString().padStart(6)} | $${row.min_price?.toLocaleString().padStart(5)} | $${row.max_price?.toLocaleString().padStart(6)}`);
    }

    // 3. Check for multi-unit pricing in failures
    console.log('\n--- Multi-Unit Pricing Check ---');
    for (const q of worstQuotes) {
      const notesRes = await client.query(`
        SELECT notes, quoted_price FROM staff_quotes_replies 
        WHERE related_quote_id = $1 AND is_pricing_email = true
      `, [q.id]);
      for (const note of notesRes.rows) {
        const noteTxt = note.notes?.toLowerCase() || '';
        if (/per (unit|container|piece|truck|40|20)/i.test(noteTxt)) {
          console.log(`Quote ${q.id}: PER-UNIT PRICING DETECTED - "${note.notes?.substring(0, 100)}"`);
        }
      }
    }

  } finally {
    client.release();
    process.exit(0);
  }
}

analyzeFailures().catch(console.error);
