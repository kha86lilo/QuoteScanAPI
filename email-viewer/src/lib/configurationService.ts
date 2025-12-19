/**
 * Configuration Service for Email Viewer
 * Fetches and caches configuration values from the database
 */

import pool from './db';

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
 * Build SQL clause to exclude ignored emails
 * Returns { clause: string, params: unknown[], nextParamIndex: number }
 */
async function buildIgnoredEmailsClause(
  emailColumn: string,
  startParamIndex: number
): Promise<{ clause: string; params: unknown[]; nextParamIndex: number }> {
  const ignoredEmails = await getIgnoredEmails();
  if (ignoredEmails.length === 0) {
    return { clause: '', params: [], nextParamIndex: startParamIndex };
  }
  return {
    clause: `AND LOWER(${emailColumn}) != ALL($${startParamIndex}::text[])`,
    params: [ignoredEmails.map((e) => e.toLowerCase())],
    nextParamIndex: startParamIndex + 1,
  };
}

/**
 * Build SQL clause to exclude ignored services
 * Returns { clause: string, params: unknown[], nextParamIndex: number }
 */
async function buildIgnoredServicesClause(
  serviceColumn: string,
  startParamIndex: number
): Promise<{ clause: string; params: unknown[]; nextParamIndex: number }> {
  const ignoredServices = await getIgnoredServices();
  if (ignoredServices.length === 0) {
    return { clause: '', params: [], nextParamIndex: startParamIndex };
  }
  return {
    clause: `AND UPPER(${serviceColumn}) != ALL($${startParamIndex}::text[])`,
    params: [ignoredServices.map((s) => s.toUpperCase())],
    nextParamIndex: startParamIndex + 1,
  };
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

export {
  getConfigValue,
  getIgnoredEmails,
  getIgnoredServices,
  isEmailIgnored,
  isServiceIgnored,
  buildIgnoredEmailsClause,
  buildIgnoredServicesClause,
  clearConfigCache,
};
