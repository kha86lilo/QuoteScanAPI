/**
 * Migration Runner
 * Run: node migrations/run-migration.js [migration_number]
 * Examples:
 *   node migrations/run-migration.js        # Run all migrations
 *   node migrations/run-migration.js 002    # Run specific migration
 */

import { pool } from '../src/config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS = [
  {
    file: '001_create_quote_matches_tables.sql',
    tables: ['quote_matches', 'quote_match_feedback'],
  },
  {
    file: '002_create_spammers_table.sql',
    tables: ['spammers'],
  },
  {
    file: '003_create_matching_weights_table.sql',
    tables: ['matching_weight_adjustments', 'pricing_history', 'lane_pricing_stats'],
  },
];

async function runMigration(migrationNumber = null) {
  const client = await pool.connect();

  try {
    const migrationsToRun = migrationNumber
      ? MIGRATIONS.filter((m) => m.file.startsWith(migrationNumber))
      : MIGRATIONS;

    if (migrationsToRun.length === 0) {
      console.log(`No migration found matching: ${migrationNumber}`);
      process.exit(1);
    }

    for (const migration of migrationsToRun) {
      const migrationFile = path.join(__dirname, migration.file);

      if (!fs.existsSync(migrationFile)) {
        console.log(`Migration file not found: ${migration.file}`);
        continue;
      }

      const sql = fs.readFileSync(migrationFile, 'utf8');

      console.log(`Running migration: ${migration.file}`);
      console.log('='.repeat(60));

      await client.query(sql);

      console.log('✓ Migration completed successfully!');

      // Verify tables were created
      if (migration.tables.length > 0) {
        const tables = await client.query(
          `SELECT table_name
           FROM information_schema.tables
           WHERE table_name = ANY($1)`,
          [migration.tables]
        );

        console.log('Tables:');
        tables.rows.forEach((row) => console.log(`  - ${row.table_name}`));

        // Verify indexes
        const indexes = await client.query(
          `SELECT indexname
           FROM pg_indexes
           WHERE tablename = ANY($1)`,
          [migration.tables]
        );

        if (indexes.rows.length > 0) {
          console.log('Indexes:');
          indexes.rows.forEach((row) => console.log(`  - ${row.indexname}`));
        }
      }

      console.log('='.repeat(60));
      console.log('');
    }

    console.log('All migrations completed!');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

const migrationArg = process.argv[2];
runMigration(migrationArg);
