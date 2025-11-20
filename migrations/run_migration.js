/**
 * Database Migration Script
 * Adds summary column to processing_jobs table
 */

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from parent directory
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create connection pool
const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  ssl: {
    rejectUnauthorized: false,
  },
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🔄 Running migration: Add summary column to processing_jobs table...');

    // Read migration file
    const migrationSQL = readFileSync(
      join(__dirname, 'alter_processing_jobs_add_summary.sql'),
      'utf8'
    );

    // Execute migration
    await client.query(migrationSQL);

    console.log('✅ Migration completed successfully!');
    console.log('\nVerifying column was added...');

    // Verify column exists
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'processing_jobs' 
      AND column_name = 'summary'
    `);

    if (result.rows.length > 0) {
      console.log('✅ Summary column verified:');
      console.log(`   Column: ${result.rows[0].column_name}`);
      console.log(`   Type: ${result.rows[0].data_type}`);
    } else {
      console.log('⚠️  Warning: Could not verify summary column');
    }

    console.log('\n✅ Migration complete! You can now restart your application.');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nDetails:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
