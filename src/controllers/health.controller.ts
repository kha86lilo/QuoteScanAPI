/**
 * Health Controller
 * Handles health checks and connection tests
 */

import type { Request, Response } from 'express';
import * as db from '../config/db.js';
import microsoftGraphService from '../services/mail/microsoftGraphService.js';
import claudeService from '../services/ai/claudeService.js';
import geminiService from '../services/ai/geminiService.js';
import emailExtractorService from '../services/mail/emailExtractor.js';
import { asyncHandler, ExternalServiceError, DatabaseError } from '../middleware/errorHandler.js';

/**
 * Health check endpoint
 */
export const healthCheck = asyncHandler(async (_req: Request, res: Response) => {
  try {
    await db.testConnection();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        api: 'running',
      },
    });
  } catch (error) {
    throw new DatabaseError('health check', error as Error);
  }
});

/**
 * Get processing statistics
 */
export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await emailExtractorService.getStats();

  res.json({
    success: true,
    stats,
  });
});

/**
 * Test Microsoft Graph connection
 */
export const testGraphConnection = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const token = await microsoftGraphService.getAccessToken();

    res.json({
      success: true,
      message: 'Microsoft Graph API connection successful',
      tokenReceived: !!token,
    });
  } catch (error) {
    throw new ExternalServiceError('Microsoft Graph API', error as Error);
  }
});

/**
 * Test Claude API connection
 */
export const testClaudeConnection = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const isValid = await claudeService.validateApiKey();

    res.json({
      success: isValid,
      message: isValid ? 'Claude API connection successful' : 'Claude API connection failed',
    });
  } catch (error) {
    throw new ExternalServiceError('Claude API', error as Error);
  }
});

/**
 * Test Gemini API connection
 */
export const testGeminiConnection = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const isValid = await geminiService.validateApiKey();
    res.json({
      success: isValid,
      message: isValid ? 'Gemini API connection successful' : 'Gemini API connection failed',
    });
  } catch (error) {
    throw new ExternalServiceError('Gemini API', error as Error);
  }
});

/**
 * Test database connection
 */
export const testDatabaseConnection = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const currentTime = await db.getCurrentTime();

    res.json({
      success: true,
      message: 'Database connection successful',
      currentTime,
    });
  } catch (error) {
    throw new DatabaseError('testing connection', error as Error);
  }
});
