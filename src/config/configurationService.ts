/**
 * Configuration Service
 * Fetches and caches configuration values from the database
 */

import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';

dotenv.config();

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
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Cache configuration values with TTL
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const configCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get a configuration value by key
 */
async function getConfigValue<T>(key: string): Promise<T | null> {
  // Check cache first
  const cached = configCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT value FROM configuration WHERE key = $1',
      [key]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const value = result.rows[0].value as T;

    // Cache the value
    configCache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return value;
  } catch (error) {
    const err = error as { code?: string };
    // Table might not exist yet
    if (err.code === '42P01') {
      console.warn('Configuration table does not exist');
      return null;
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get list of ignored email addresses
 */
async function getIgnoredEmails(): Promise<string[]> {
  const value = await getConfigValue<string[]>('Ignored_Emails');
  return value || [];
}

/**
 * Get list of ignored service types
 */
async function getIgnoredServices(): Promise<string[]> {
  const value = await getConfigValue<string[]>('Ignored_Services');
  return value || [];
}

/**
 * Check if an email address should be ignored
 */
async function isEmailIgnored(emailAddress: string): Promise<boolean> {
  if (!emailAddress) return false;
  const ignoredEmails = await getIgnoredEmails();
  return ignoredEmails.some(
    (ignored) => ignored.toLowerCase() === emailAddress.toLowerCase()
  );
}

/**
 * Check if a service type should be ignored
 */
async function isServiceIgnored(serviceType: string): Promise<boolean> {
  if (!serviceType) return false;
  const ignoredServices = await getIgnoredServices();
  return ignoredServices.some(
    (ignored) => ignored.toLowerCase() === serviceType.toLowerCase()
  );
}

/**
 * Clear configuration cache
 */
function clearConfigCache(): void {
  configCache.clear();
}

/**
 * Set a configuration value
 */
async function setConfigValue<T>(key: string, value: T): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO configuration (key, value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET
         value = $2::jsonb,
         updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );

    // Update cache
    configCache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  } finally {
    client.release();
  }
}

export {
  getConfigValue,
  setConfigValue,
  getIgnoredEmails,
  getIgnoredServices,
  isEmailIgnored,
  isServiceIgnored,
  clearConfigCache,
};
