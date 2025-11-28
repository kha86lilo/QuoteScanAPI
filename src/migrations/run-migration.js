/**
 * Migration Runner
 * Run: node src/migrations/run-migration.js
 */

import { pool } from '../config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const client = await pool.connect();

  try {
    const migrationFile = path.join(__dirname, '001_create_quote_matches_tables.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log('Running migration: 001_create_quote_matches_tables.sql');
    console.log('='.repeat(60));

    await client.query(sql);

    console.log('✓ Migration completed successfully!');
    console.log('='.repeat(60));

    // Verify tables were created
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name IN ('quote_matches', 'quote_match_feedback')
    `);

    console.log('Created tables:');
    tables.rows.forEach((row) => console.log(`  - ${row.table_name}`));

    // Verify indexes
    const indexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename IN ('quote_matches', 'quote_match_feedback')
    `);

    console.log('\nCreated indexes:');
    indexes.rows.forEach((row) => console.log(`  - ${row.indexname}`));
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
