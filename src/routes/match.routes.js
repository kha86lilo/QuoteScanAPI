/**
 * Match Routes
 * Handles quote matching and feedback endpoints
 */

import express from 'express';
import * as matchController from '../controllers/match.controller.js';

const router = express.Router();

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
 * Run matching for specific quote IDs
 * POST /api/matches/run
 * Body: { quoteIds: [1, 2, 3], minScore?: 0.5, maxMatches?: 10, algorithmVersion?: 'v1' }
 */
router.post('/run', matchController.runMatchingForQuotes);

/**
 * Run matching for all unmatched quotes
 * POST /api/matches/run-all
 * Body: { minScore?: 0.5, maxMatches?: 10, limit?: 100, algorithmVersion?: 'v1' }
 */
router.post('/run-all', matchController.runMatchingForAllUnmatched);

/**
 * Extract quotes from emails and run matching (combined operation)
 * POST /api/matches/extract-and-match
 * Body: {
 *   searchQuery?: string,      // Email search query (default: 'quote OR shipping OR freight OR cargo')
 *   maxEmails?: number,        // Max emails to fetch (default: 50)
 *   startDate?: string,        // ISO date to start from
 *   scoreThreshold?: number,   // Email filter score threshold (default: 30)
 *   minScore?: number,         // Minimum match similarity score (default: 0.5)
 *   maxMatches?: number,       // Max matches per quote (default: 3)
 *   algorithmVersion?: string, // Matching algorithm version (default: 'v1')
 *   async?: boolean            // Run as background job (default: true)
 * }
 */
router.post('/extract-and-match', matchController.extractAndMatch);

/**
 * Re-run matching for a single quote (deletes existing matches first)
 * POST /api/matches/rematch/:quoteId
 * Body: { minScore?: 0.5, maxMatches?: 10, algorithmVersion?: 'v1' }
 */
router.post('/rematch/:quoteId', matchController.rematchSingleQuote);

// =====================================================
// Match CRUD Operations
// =====================================================

/**
 * Get matches for a specific quote
 * GET /api/matches/quote/:quoteId
 * Query params: limit, minScore
 */
router.get('/quote/:quoteId', matchController.getMatchesForQuote);

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
