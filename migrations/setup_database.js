/**
 * Database Setup Script
 * Creates processing_jobs table with summary column
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

async function setupDatabase() {
  const client = await pool.connect();

  try {
    console.log('🔄 Setting up processing_jobs table...\n');

    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'processing_jobs'
      );
    `);

    const tableExists = tableCheck.rows[0].exists;

    if (!tableExists) {
      console.log('📋 Creating processing_jobs table...');

      // Read and execute create table script
      const createTableSQL = readFileSync(
        join(__dirname, 'create_processing_jobs_table.sql'),
        'utf8'
      );

      await client.query(createTableSQL);
      console.log('✅ Table created successfully!');
    } else {
      console.log('✅ Table already exists');
    }

    // Check if summary column exists
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'processing_jobs' 
      AND column_name = 'summary'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('\n📋 Adding summary column...');

      // Read and execute alter table script
      const alterTableSQL = readFileSync(
        join(__dirname, 'alter_processing_jobs_add_summary.sql'),
        'utf8'
      );

      await client.query(alterTableSQL);
      console.log('✅ Summary column added successfully!');
    } else {
      console.log('✅ Summary column already exists');
    }

    // Check if last_received_datetime column exists
    const lastReceivedCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'processing_jobs' 
      AND column_name = 'last_received_datetime'
    `);

    if (lastReceivedCheck.rows.length === 0) {
      console.log('\n📋 Adding last_received_datetime column...');

      // Read and execute alter table script
      const alterTableSQL = readFileSync(
        join(__dirname, 'alter_processing_jobs_add_last_received_datetime.sql'),
        'utf8'
      );

      await client.query(alterTableSQL);
      console.log('✅ last_received_datetime column added successfully!');
    } else {
      console.log('✅ last_received_datetime column already exists');
    }

    // Verify final structure
    console.log('\n📊 Verifying table structure...');
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'processing_jobs'
      ORDER BY ordinal_position
    `);

    console.log('\nTable columns:');
    columns.rows.forEach((col) => {
      console.log(
        `  - ${col.column_name} (${col.data_type})${col.is_nullable === 'YES' ? ' NULL' : ' NOT NULL'}`
      );
    });

    console.log('\n✅ Database setup complete! You can now start the application.');
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error('\nDetails:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run setup
setupDatabase().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
