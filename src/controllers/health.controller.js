/**
 * Health Controller
 * Handles health checks and connection tests
 */

import * as db from '../config/db.js';
import * as microsoftGraphService from '../services/microsoftGraphService.js';
import * as claudeService from '../services/ai/claudeService.js';
import * as geminiService from '../services/ai/geminiService.js';
import * as emailExtractor from '../services/emailExtractor.js';

/**
 * Health check endpoint
 */
export const healthCheck = async (req, res) => {
  try {
    // Check database connection
    await db.pool.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        api: 'running'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
};

/**
 * Get processing statistics
 */
export const getStats = async (req, res) => {
  try {
    const stats = await emailExtractor.getStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Test Microsoft Graph connection
 */
export const testGraphConnection = async (req, res) => {
  try {
    const token = await microsoftGraphService.getAccessToken();
    
    res.json({
      success: true,
      message: 'Microsoft Graph API connection successful',
      tokenReceived: !!token
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Test Claude API connection
 */
export const testClaudeConnection = async (req, res) => {
  try {
    const isValid = await claudeService.validateApiKey();
    
    res.json({
      success: isValid,
      message: isValid ? 'Claude API connection successful' : 'Claude API connection failed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Test Gemini API connection
 */
export const testGeminiConnection = async (req, res) => {
  try {
    const isValid = await geminiService.validateApiKey();
    res.json({
      success: isValid,
      message: isValid ? 'Gemini API connection successful' : 'Gemini API connection failed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Test database connection
 */
export const testDatabaseConnection = async (req, res) => {
  try {
    const result = await db.pool.query('SELECT NOW() as current_time');
    
    res.json({
      success: true,
      message: 'Database connection successful',
      currentTime: result.rows[0].current_time
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
