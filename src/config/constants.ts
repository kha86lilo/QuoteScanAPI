/**
 * Application Constants
 */

export const API_INFO = {
  name: 'Shipping Quote Email Extractor API',
  version: '1.0.0',
  description:
    'Express.js API for extracting shipping quotes from Microsoft 365 emails using Claude AI',
} as const;

export const ENDPOINTS = {
  health: 'GET /api/health',
  processEmails: 'POST /api/emails/process (Rate Limited: 1/min)',
  previewEmails: 'POST /api/emails/preview',
  fetchEmails: 'POST /api/emails/fetch',
  parseEmail: 'POST /api/emails/parse',
  getJobStatus: 'GET /api/jobs/:id',
  getJobResult: 'GET /api/jobs/:id/result',
  getJobStatistics: 'GET /api/jobs/statistics',
  getAllJobs: 'GET /api/jobs',
  cancelJob: 'DELETE /api/jobs/:id',
  getStats: 'GET /api/stats',
  getQuotes: 'GET /api/quotes',
  getQuoteById: 'GET /api/quotes/:id',
  searchQuotes: 'POST /api/quotes/search',
  deleteQuote: 'DELETE /api/quotes/:id',
  testGraph: 'GET /api/test/graph',
  testClaude: 'GET /api/test/claude',
  testDatabase: 'GET /api/test/database',
  testGemini: 'GET /api/test/gemini',
} as const;

export const RATE_LIMITS = {
  emailProcessing: '1 request per minute',
  statusChecks: '30 requests per minute',
  general: '100 requests per 15 minutes',
} as const;
