/**
 * Health Routes
 * Handles health checks and connection tests
 */

import express from 'express';
import * as healthController from '../controllers/health.controller.js';

const router = express.Router();

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/', healthController.healthCheck);

/**
 * Get processing statistics
 * GET /api/stats
 */
router.get('/stats', healthController.getStats);

/**
 * Test Microsoft Graph connection
 * GET /api/test/graph
 */
router.get('/test/graph', healthController.testGraphConnection);

/**
 * Test Claude API connection
 * GET /api/test/claude
 */
router.get('/test/claude', healthController.testClaudeConnection);

/**
 * Test Gemini API connection
 * GET /api/test/gemini
 */
router.get('/test/gemini', healthController.testGeminiConnection);

/**
 * Test database connection
 * GET /api/test/database
 */
router.get('/test/database', healthController.testDatabaseConnection);

export default router;
