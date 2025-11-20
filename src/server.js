/**
 * Express Server
 * Main entry point for the Shipping Quote Email Extractor API
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import routes from './routes/index.js';

dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies (increased limit for email content)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined')); // HTTP request logging

// API Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Shipping Quote Email Extractor API',
    version: '1.0.0',
    description: 'Express.js API for extracting shipping quotes from Microsoft 365 emails using Claude AI',
    endpoints: {
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
      testGemini: 'GET /api/test/gemini'
    },
    rateLimits: {
      emailProcessing: '1 request per minute',
      statusChecks: '30 requests per minute',
      general: '100 requests per 15 minutes'
    },
    documentation: 'See README.md for detailed API documentation'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SHIPPING QUOTE EMAIL EXTRACTOR API');
  console.log('='.repeat(60));
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`✓ API Base URL: http://localhost:${PORT}/api`);
  console.log('='.repeat(60) + '\n');
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
  console.log('\n' + '='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received. Shutting down gracefully...');
  process.exit(0);
});

export default app;
