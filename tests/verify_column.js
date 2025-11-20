/**
 * Verify last_received_datetime column exists
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function verifyColumn() {
  const client = await pool.connect();
  try {
    console.log('Checking for last_received_datetime column...\n');

    const result = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'processing_jobs' 
      AND column_name = 'last_received_datetime'
    `);

    if (result.rows.length > 0) {
      console.log('✅ Column exists!');
      console.log('Column details:', result.rows[0]);
    } else {
      console.log('❌ Column not found');
    }

    console.log('\nAll processing_jobs columns:');
    const allColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'processing_jobs'
      ORDER BY ordinal_position
    `);

    allColumns.rows.forEach((col) => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
  } finally {
    client.release();
    await pool.end();
  }
}

verifyColumn().catch(console.error);
