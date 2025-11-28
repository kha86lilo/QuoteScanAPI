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
