/**
 * Match Controller
 * Handles quote matching and feedback operations
 */

import * as db from '../config/db.js';
import { asyncHandler, NotFoundError, DatabaseError, ValidationError } from '../middleware/errorHandler.js';

// Valid feedback reasons for validation
const VALID_FEEDBACK_REASONS = [
  'good_match',
  'excellent_suggestion',
  'wrong_route',
  'different_cargo',
  'price_outdated',
  'weight_mismatch',
  'service_mismatch',
  'different_client_type',
  'other',
];

/**
 * Get matches for a specific quote
 * GET /api/matches/quote/:quoteId
 */
export const getMatchesForQuote = asyncHandler(async (req, res) => {
  const { quoteId } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  const minScore = parseFloat(req.query.minScore) || 0;

  try {
    const matches = await db.getMatchesForQuote(quoteId, { limit, minScore });

    res.json({
      success: true,
      quoteId: parseInt(quoteId),
      count: matches.length,
      matches,
    });
  } catch (error) {
    throw new DatabaseError('fetching matches for quote', error);
  }
});

/**
 * Get a single match by ID
 * GET /api/matches/:matchId
 */
export const getMatchById = asyncHandler(async (req, res) => {
  const { matchId } = req.params;

  try {
    const match = await db.getMatchById(matchId);

    if (!match) {
      throw new NotFoundError(`Match with ID: ${matchId}`);
    }

    res.json({
      success: true,
      match,
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('fetching match by ID', error);
  }
});

/**
 * Create a new match (typically called by matching algorithm)
 * POST /api/matches
 */
export const createMatch = asyncHandler(async (req, res) => {
  const {
    sourceQuoteId,
    matchedQuoteId,
    similarityScore,
    matchCriteria,
    suggestedPrice,
    priceConfidence,
    algorithmVersion,
  } = req.body;

  // Validation
  if (!sourceQuoteId || !matchedQuoteId) {
    throw new ValidationError('sourceQuoteId and matchedQuoteId are required');
  }

  if (similarityScore === undefined || similarityScore < 0 || similarityScore > 1) {
    throw new ValidationError('similarityScore must be between 0 and 1');
  }

  if (sourceQuoteId === matchedQuoteId) {
    throw new ValidationError('Cannot match a quote with itself');
  }

  try {
    const match = await db.createQuoteMatch({
      sourceQuoteId,
      matchedQuoteId,
      similarityScore,
      matchCriteria,
      suggestedPrice,
      priceConfidence,
      algorithmVersion,
    });

    res.status(201).json({
      success: true,
      message: 'Match created successfully',
      match,
    });
  } catch (error) {
    throw new DatabaseError('creating match', error);
  }
});

/**
 * Create multiple matches in bulk
 * POST /api/matches/bulk
 */
export const createMatchesBulk = asyncHandler(async (req, res) => {
  const { matches } = req.body;

  if (!matches || !Array.isArray(matches) || matches.length === 0) {
    throw new ValidationError('matches array is required and cannot be empty');
  }

  // Validate each match
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!m.sourceQuoteId || !m.matchedQuoteId) {
      throw new ValidationError(`Match at index ${i}: sourceQuoteId and matchedQuoteId are required`);
    }
    if (m.similarityScore === undefined || m.similarityScore < 0 || m.similarityScore > 1) {
      throw new ValidationError(`Match at index ${i}: similarityScore must be between 0 and 1`);
    }
  }

  try {
    const createdMatches = await db.createQuoteMatchesBulk(matches);

    res.status(201).json({
      success: true,
      message: `${createdMatches.length} matches created successfully`,
      count: createdMatches.length,
      matches: createdMatches,
    });
  } catch (error) {
    throw new DatabaseError('creating matches in bulk', error);
  }
});

/**
 * Delete a match
 * DELETE /api/matches/:matchId
 */
export const deleteMatch = asyncHandler(async (req, res) => {
  const { matchId } = req.params;

  try {
    const deleted = await db.deleteMatch(matchId);

    if (!deleted) {
      throw new NotFoundError(`Match with ID: ${matchId}`);
    }

    res.json({
      success: true,
      message: 'Match deleted successfully',
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('deleting match', error);
  }
});

// =====================================================
// Feedback Endpoints
// =====================================================

/**
 * Submit feedback for a match
 * POST /api/matches/:matchId/feedback
 */
export const submitFeedback = asyncHandler(async (req, res) => {
  const { matchId } = req.params;
  const { rating, feedbackReason, feedbackNotes, actualPriceUsed, userId } = req.body;

  // Validation
  if (rating === undefined || (rating !== -1 && rating !== 1)) {
    throw new ValidationError('rating must be -1 (thumbs down) or 1 (thumbs up)');
  }

  if (feedbackReason && !VALID_FEEDBACK_REASONS.includes(feedbackReason)) {
    throw new ValidationError(`feedbackReason must be one of: ${VALID_FEEDBACK_REASONS.join(', ')}`);
  }

  // Verify match exists
  const match = await db.getMatchById(matchId);
  if (!match) {
    throw new NotFoundError(`Match with ID: ${matchId}`);
  }

  try {
    const feedback = await db.submitMatchFeedback({
      matchId: parseInt(matchId),
      userId,
      rating,
      feedbackReason,
      feedbackNotes,
      actualPriceUsed,
    });

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback,
    });
  } catch (error) {
    throw new DatabaseError('submitting feedback', error);
  }
});

/**
 * Get feedback for a specific match
 * GET /api/matches/:matchId/feedback
 */
export const getFeedbackForMatch = asyncHandler(async (req, res) => {
  const { matchId } = req.params;

  try {
    const feedback = await db.getFeedbackForMatch(matchId);

    res.json({
      success: true,
      matchId: parseInt(matchId),
      count: feedback.length,
      feedback,
    });
  } catch (error) {
    throw new DatabaseError('fetching feedback for match', error);
  }
});

/**
 * Get overall feedback statistics
 * GET /api/matches/feedback/stats
 */
export const getFeedbackStatistics = asyncHandler(async (req, res) => {
  const { algorithmVersion, startDate, endDate } = req.query;

  try {
    const stats = await db.getFeedbackStatistics({
      algorithmVersion,
      startDate,
      endDate,
    });

    res.json({
      success: true,
      statistics: stats,
    });
  } catch (error) {
    throw new DatabaseError('fetching feedback statistics', error);
  }
});

/**
 * Get feedback breakdown by reason
 * GET /api/matches/feedback/by-reason
 */
export const getFeedbackByReason = asyncHandler(async (req, res) => {
  try {
    const breakdown = await db.getFeedbackByReason();

    res.json({
      success: true,
      breakdown,
    });
  } catch (error) {
    throw new DatabaseError('fetching feedback by reason', error);
  }
});

/**
 * Get match criteria performance analysis
 * GET /api/matches/feedback/criteria-performance
 */
export const getMatchCriteriaPerformance = asyncHandler(async (req, res) => {
  try {
    const performance = await db.getMatchCriteriaPerformance();

    res.json({
      success: true,
      performance,
      description: {
        rating_1: 'Thumbs up - good matches',
        rating_minus1: 'Thumbs down - poor matches',
        insight: 'Compare avg scores between ratings to identify which criteria need higher thresholds',
      },
    });
  } catch (error) {
    throw new DatabaseError('fetching criteria performance', error);
  }
});
