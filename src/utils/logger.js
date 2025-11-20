/**
 * Startup Logger Utility
 */

export const logStartup = (port) => {
  const separator = '='.repeat(60);

  console.log(`\n${separator}`);
  console.log('🚀 SHIPPING QUOTE EMAIL EXTRACTOR API');
  console.log(separator);
  console.log(`✓ Server running on port ${port}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ API Base URL: http://localhost:${port}/api`);
  console.log(`${separator}\n`);

  console.log('Available endpoints:');
  console.log('  GET  /                              - API information');
  console.log('  GET  /api/health                    - Health check');
  console.log('  POST /api/emails/process            - Process emails (async, rate limited)');
  console.log('  POST /api/emails/preview            - Preview emails to be processed');
  console.log('  POST /api/emails/fetch              - Fetch emails from Microsoft 365');
  console.log('  POST /api/emails/parse              - Parse a single email with Claude');
  console.log('  GET  /api/jobs/:id                  - Get job status');
  console.log('  GET  /api/jobs/:id/result           - Get job result');
  console.log('  GET  /api/jobs/statistics           - Get job statistics');
  console.log('  GET  /api/jobs                      - Get all jobs');
  console.log('  DELETE /api/jobs/:id                - Cancel a job');
  console.log('  GET  /api/stats                     - Get processing statistics');
  console.log('  GET  /api/quotes                    - Get all quotes');
  console.log('  GET  /api/quotes/:id                - Get quote by ID');
  console.log('  POST /api/quotes/search             - Search quotes');
  console.log('  DELETE /api/quotes/:id              - Delete quote');
  console.log('  GET  /api/test/graph                - Test Microsoft Graph connection');
  console.log('  GET  /api/test/claude               - Test Claude API connection');
  console.log('  GET  /api/test/database             - Test database connection');
  console.log('  GET  /api/test/gemini               - Test Gemini API connection');

  console.log('\n⚡ Rate Limits:');
  console.log('  - Email Processing: 1 request/minute');
  console.log('  - Status Checks: 30 requests/minute');
  console.log('  - General API: 100 requests/15 min');
  console.log(`\n${separator}\n`);
};
