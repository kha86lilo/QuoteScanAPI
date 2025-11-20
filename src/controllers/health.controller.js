/**
 * Health Controller
 * Handles health checks and connection tests
 */

import * as db from '../config/db.js';
import * as microsoftGraphService from '../services/microsoftGraphService.js';
import * as claudeService from '../services/ai/claudeService.js';
import * as geminiService from '../services/ai/geminiService.js';
import * as emailExtractor from '../services/emailExtractor.js';
import { asyncHandler, ExternalServiceError, DatabaseError } from '../middleware/errorHandler.js';

/**
 * Health check endpoint
 */
export const healthCheck = asyncHandler(async (req, res) => {
  try {
    // Check database connection
    await db.pool.query('SELECT 1');

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        api: 'running',
      },
    });
  } catch (error) {
    throw new DatabaseError('health check', error);
  }
});

/**
 * Get processing statistics
 */
export const getStats = asyncHandler(async (req, res) => {
  const stats = await emailExtractor.getStats();

  res.json({
    success: true,
    stats,
  });
});

/**
 * Test Microsoft Graph connection
 */
export const testGraphConnection = asyncHandler(async (req, res) => {
  try {
    const token = await microsoftGraphService.getAccessToken();

    res.json({
      success: true,
      message: 'Microsoft Graph API connection successful',
      tokenReceived: !!token,
    });
  } catch (error) {
    throw new ExternalServiceError('Microsoft Graph API', error);
  }
});

/**
 * Test Claude API connection
 */
export const testClaudeConnection = asyncHandler(async (req, res) => {
  try {
    const isValid = await claudeService.validateApiKey();

    res.json({
      success: isValid,
      message: isValid ? 'Claude API connection successful' : 'Claude API connection failed',
    });
  } catch (error) {
    throw new ExternalServiceError('Claude API', error);
  }
});

/**
 * Test Gemini API connection
 */
export const testGeminiConnection = asyncHandler(async (req, res) => {
  try {
    const isValid = await geminiService.validateApiKey();
    res.json({
      success: isValid,
      message: isValid ? 'Gemini API connection successful' : 'Gemini API connection failed',
    });
  } catch (error) {
    throw new ExternalServiceError('Gemini API', error);
  }
});

/**
 * Test database connection
 */
export const testDatabaseConnection = asyncHandler(async (req, res) => {
  try {
    const result = await db.pool.query('SELECT NOW() as current_time');

    res.json({
      success: true,
      message: 'Database connection successful',
      currentTime: result.rows[0].current_time,
    });
  } catch (error) {
    throw new DatabaseError('testing connection', error);
  }
});
