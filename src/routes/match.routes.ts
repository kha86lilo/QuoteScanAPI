/**
 * Match Routes
 * Handles quote matching and feedback endpoints
 */

import express, { Router } from 'express';
import * as matchController from '../controllers/match.controller.js';

const router: Router = express.Router();

// =====================================================
// Feedback Statistics (must be before /:matchId routes)
// =====================================================

/**
 * Get overall feedback statistics
 * GET /api/matches/feedback/stats
 * Query params: algorithmVersion, startDate, endDate
 */
router.get('/feedback/stats', matchController.getFeedbackStatistics);

/**
 * Get feedback breakdown by reason
 * GET /api/matches/feedback/by-reason
 */
router.get('/feedback/by-reason', matchController.getFeedbackByReason);

/**
 * Get match criteria performance analysis
 * GET /api/matches/feedback/criteria-performance
 */
router.get('/feedback/criteria-performance', matchController.getMatchCriteriaPerformance);

// =====================================================
// Matching Algorithm Operations
// =====================================================

/**
 * Run matching for specific quote IDs with AI-powered pricing
 * POST /api/matches/run
 * Body: { quoteIds: [1, 2, 3], minScore?: 0.45, maxMatches?: 10, useAI?: true }
 */
router.post('/run', matchController.runMatchingForQuotes);

/**
 * Run matching for all quotes created after a start date with smart pricing
 * POST /api/matches/run-all
 * Body: {
 *   startDate: string,        // Required: ISO date (e.g., '2024-01-01')
 *   minScore?: number,        // Minimum match similarity score (default: 0.3)
 *   maxMatches?: number,      // Max matches per quote (default: 10)
 *   useAI?: boolean,          // Use AI for pricing recommendations (default: true)
 *   limit?: number,           // Max quotes to process (default: 1000)
 *   async?: boolean           // Run as background job (default: true)
 * }
 */
router.post('/run-all', matchController.runAllMatching);
 
/**
 * Analyze a quote request without saving (for testing/preview)
 * POST /api/matches/analyze
 * Body: { origin_city, destination_city, service_type, cargo_description, cargo_weight, ... }
 */
router.post('/analyze', matchController.analyzeQuoteRequest);
 
/**
 * Trigger feedback learning to update matching weights
 * POST /api/matches/learn
 */
router.post('/learn', matchController.triggerLearning);

/**
 * Record pricing outcome for a quote (for learning)
 * POST /api/matches/pricing-outcome/:quoteId
 * Body: { actualPriceQuoted, actualPriceAccepted, jobWon }
 */
router.post('/pricing-outcome/:quoteId', matchController.recordOutcome);

/**
 * Extract quotes from emails and run matching with AI-powered pricing
 * POST /api/matches/extract-and-match
 * Body: {
 *   searchQuery?: string,      // Email search query
 *   maxEmails?: number,        // Max emails to fetch (default: 500)
 *   startDate?: string,        // ISO date to start from
 *   scoreThreshold?: number,   // Email filter score threshold (default: 50)
 *   minScore?: number,         // Minimum match similarity score (default: 0.45)
 *   maxMatches?: number,       // Max matches per quote (default: 3)
 *   useAI?: boolean,           // Use AI for pricing recommendations (default: true)
 *   async?: boolean            // Run as background job (default: true)
 * }
 */
router.post('/extract-and-match', matchController.extractAndMatch);

// =====================================================
// Match CRUD Operations
// =====================================================
 

/**
 * Create multiple matches in bulk
 * POST /api/matches/bulk
 * Body: { matches: [{ sourceQuoteId, matchedQuoteId, similarityScore, ... }] }
 */
router.post('/bulk', matchController.createMatchesBulk);

/**
 * Create a new match
 * POST /api/matches
 * Body: { sourceQuoteId, matchedQuoteId, similarityScore, matchCriteria, suggestedPrice, priceConfidence }
 */
router.post('/', matchController.createMatch);

/**
 * Get a single match by ID
 * GET /api/matches/:matchId
 */
router.get('/:matchId', matchController.getMatchById);

/**
 * Delete a match
 * DELETE /api/matches/:matchId
 */
router.delete('/:matchId', matchController.deleteMatch);

// =====================================================
// Match Feedback Operations
// =====================================================

/**
 * Submit feedback for a match (thumbs up/down)
 * POST /api/matches/:matchId/feedback
 * Body: { rating: 1|-1, feedbackReason?, feedbackNotes?, actualPriceUsed?, userId? }
 */
router.post('/:matchId/feedback', matchController.submitFeedback);

/**
 * Get all feedback for a specific match
 * GET /api/matches/:matchId/feedback
 */
router.get('/:matchId/feedback', matchController.getFeedbackForMatch);

export default router;
