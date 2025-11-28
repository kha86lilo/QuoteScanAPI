/**
 * Match Controller
 * Handles quote matching and feedback operations
 */

import * as db from '../config/db.js';
import {
  asyncHandler,
  NotFoundError,
  DatabaseError,
  ValidationError,
} from '../middleware/errorHandler.js';
import { processMatchesForNewQuotes, rematchQuote } from '../services/quoteMatchingService.js';
import emailExtractorService from '../services/mail/emailExtractor.js';
import jobProcessor from '../services/jobProcessor.js';
import { getLatestLastReceivedDateTime } from '../config/db.js';

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
      throw new ValidationError(
        `Match at index ${i}: sourceQuoteId and matchedQuoteId are required`
      );
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
    throw new ValidationError(
      `feedbackReason must be one of: ${VALID_FEEDBACK_REASONS.join(', ')}`
    );
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
        insight:
          'Compare avg scores between ratings to identify which criteria need higher thresholds',
      },
    });
  } catch (error) {
    throw new DatabaseError('fetching criteria performance', error);
  }
});

// =====================================================
// Matching Algorithm Endpoints
// =====================================================

/**
 * Run matching for specific quote IDs
 * POST /api/matches/run
 * Body: { quoteIds: [1, 2, 3], minScore?: 0.5, maxMatches?: 10 }
 */
export const runMatchingForQuotes = asyncHandler(async (req, res) => {
  const { quoteIds, minScore = 0.5, maxMatches = 10, algorithmVersion = 'v1' } = req.body;

  if (!quoteIds || !Array.isArray(quoteIds) || quoteIds.length === 0) {
    throw new ValidationError('quoteIds array is required and cannot be empty');
  }

  // Validate quote IDs are numbers
  for (const id of quoteIds) {
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      throw new ValidationError('All quoteIds must be integers');
    }
  }

  try {
    const results = await processMatchesForNewQuotes(quoteIds, {
      minScore,
      maxMatches,
      algorithmVersion,
    });

    res.json({
      success: true,
      message: `Matching completed for ${results.processed} quotes`,
      results: {
        quotesProcessed: results.processed,
        matchesCreated: results.matchesCreated,
        errors: results.errors,
      },
    });
  } catch (error) {
    throw new DatabaseError('running matching algorithm', error);
  }
});

/**
 * Re-run matching for a single quote (deletes existing matches first)
 * POST /api/matches/rematch/:quoteId
 */
export const rematchSingleQuote = asyncHandler(async (req, res) => {
  const { quoteId } = req.params;
  const { minScore = 0.5, maxMatches = 10, algorithmVersion = 'v1' } = req.body;

  const quoteIdInt = parseInt(quoteId);
  if (isNaN(quoteIdInt)) {
    throw new ValidationError('quoteId must be a valid integer');
  }

  // Verify quote exists
  const quote = await db.getQuoteForMatching(quoteIdInt);
  if (!quote) {
    throw new NotFoundError(`Quote with ID: ${quoteId}`);
  }

  try {
    const results = await rematchQuote(quoteIdInt, {
      minScore,
      maxMatches,
      algorithmVersion,
    });

    res.json({
      success: true,
      message: `Re-matching completed for quote ${quoteId}`,
      results: {
        quotesProcessed: results.processed,
        matchesCreated: results.matchesCreated,
        errors: results.errors,
      },
    });
  } catch (error) {
    throw new DatabaseError('re-matching quote', error);
  }
});

/**
 * Run matching for all unmatched quotes
 * POST /api/matches/run-all
 * Body: { minScore?: 0.5, maxMatches?: 10, limit?: 100 }
 */
export const runMatchingForAllUnmatched = asyncHandler(async (req, res) => {
  const { minScore = 0.5, maxMatches = 10, limit = 100, algorithmVersion = 'v1' } = req.body;

  try {
    // Get quotes that don't have any matches yet
    const client = await db.pool.connect();
    let unmatchedQuoteIds;
    try {
      const result = await client.query(
        `SELECT q.quote_id
         FROM shipping_quotes q
         LEFT JOIN quote_matches m ON q.quote_id = m.source_quote_id
         WHERE m.match_id IS NULL
         ORDER BY q.created_at DESC
         LIMIT $1`,
        [limit]
      );
      unmatchedQuoteIds = result.rows.map((r) => r.quote_id);
    } finally {
      client.release();
    }

    if (unmatchedQuoteIds.length === 0) {
      return res.json({
        success: true,
        message: 'No unmatched quotes found',
        results: {
          quotesProcessed: 0,
          matchesCreated: 0,
          errors: [],
        },
      });
    }

    const results = await processMatchesForNewQuotes(unmatchedQuoteIds, {
      minScore,
      maxMatches,
      algorithmVersion,
    });

    res.json({
      success: true,
      message: `Matching completed for ${results.processed} unmatched quotes`,
      results: {
        unmatchedFound: unmatchedQuoteIds.length,
        quotesProcessed: results.processed,
        matchesCreated: results.matchesCreated,
        errors: results.errors,
      },
    });
  } catch (error) {
    throw new DatabaseError('running matching for unmatched quotes', error);
  }
});

// =====================================================
// Extract and Match Combined Endpoints
// =====================================================

/**
 * Extract quotes from emails and run matching (async job)
 * POST /api/matches/extract-and-match
 * Body: { searchQuery?, maxEmails?, startDate?, scoreThreshold?, minScore?, maxMatches?, async? }
 */
export const extractAndMatch = asyncHandler(async (req, res) => {
  const lastProcessDate = await getLatestLastReceivedDateTime();
  const {
    searchQuery = '',
    maxEmails = 300,
    startDate = lastProcessDate ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    scoreThreshold = 50,
    minScore = 0.5,
    maxMatches = 3,
    algorithmVersion = 'v1',
    async = true,
  } = req.body;

  const jobData = {
    searchQuery,
    maxEmails,
    startDate,
    scoreThreshold,
    // Include matching options in job data
    matchingOptions: {
      minScore,
      maxMatches,
      algorithmVersion,
    },
  };

  if (async) {
    // Create job for async processing
    const jobId = await jobProcessor.createJob(jobData);

    // Start processing in background with matching
    processExtractAndMatchJob(jobId, jobData).catch((err) => {
      console.error(`Unhandled error in extract-and-match job ${jobId}:`, err);
    });

    const statusUrl = `${req.protocol}://${req.get('host')}/api/jobs/${jobId}`;

    return res.status(202).json({
      success: true,
      message: 'Extract and match job accepted for processing',
      jobId,
      statusUrl,
      statusCheckInterval: '5-10 seconds recommended',
    });
  }

  // Synchronous processing
  try {
    // Step 1: Extract quotes from emails
    const extractionResults = await emailExtractorService.processEmails({
      searchQuery,
      maxEmails,
      startDate,
      scoreThreshold,
    });

    // Step 2: Run matching on newly extracted quotes
    let matchingResults = { processed: 0, matchesCreated: 0, errors: [] };

    if (extractionResults.newQuoteIds && extractionResults.newQuoteIds.length > 0) {
      matchingResults = await processMatchesForNewQuotes(extractionResults.newQuoteIds, {
        minScore,
        maxMatches,
        algorithmVersion,
      });
    }

    res.json({
      success: true,
      message: 'Extract and match completed successfully',
      results: {
        extraction: {
          fetched: extractionResults.fetched,
          filtered: extractionResults.filtered,
          processed: extractionResults.processed,
          newQuoteIds: extractionResults.newQuoteIds,
        },
        matching: {
          quotesProcessed: matchingResults.processed,
          matchesCreated: matchingResults.matchesCreated,
          errors: matchingResults.errors,
        },
      },
    });
  } catch (error) {
    throw new DatabaseError('extract and match operation', error);
  }
});

/**
 * Helper function to process extract-and-match job asynchronously
 */
async function processExtractAndMatchJob(jobId, jobData) {
  try {
    // Update status to processing
    await jobProcessor.updateJob(jobId, {
      status: 'processing',
      startedAt: new Date().toISOString(),
    });

    console.log(`\nStarting extract-and-match job ${jobId}...`);

    // Step 1: Extract quotes from emails
    const extractionResults = await emailExtractorService.processEmails({
      searchQuery: jobData.searchQuery,
      maxEmails: jobData.maxEmails,
      startDate: jobData.startDate,
      scoreThreshold: jobData.scoreThreshold,
    });

    // Step 2: Run matching on newly extracted quotes
    let matchingResults = { processed: 0, matchesCreated: 0, errors: [] };

    if (extractionResults.newQuoteIds && extractionResults.newQuoteIds.length > 0) {
      const { minScore, maxMatches, algorithmVersion } = jobData.matchingOptions;
      matchingResults = await processMatchesForNewQuotes(extractionResults.newQuoteIds, {
        minScore,
        maxMatches,
        algorithmVersion,
      });
    }

    // Update job with combined results
    await jobProcessor.updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: {
        extraction: {
          fetched: extractionResults.fetched,
          filtered: extractionResults.filtered,
          processed: extractionResults.processed,
          newQuoteIds: extractionResults.newQuoteIds,
          lastReceivedDateTime: extractionResults.lastReceivedDateTime,
        },
        matching: {
          quotesProcessed: matchingResults.processed,
          matchesCreated: matchingResults.matchesCreated,
          errors: matchingResults.errors,
        },
      },
      progress: {
        current: extractionResults.fetched,
        total: extractionResults.fetched,
        percentage: 100,
      },
    });

    console.log(`Extract-and-match job ${jobId} completed successfully`);
  } catch (error) {
    console.error(`Extract-and-match job ${jobId} failed:`, error);

    await jobProcessor.updateJob(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
  }
}
