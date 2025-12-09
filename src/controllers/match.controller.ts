/**
 * Match Controller
 * Handles quote matching and feedback operations
 */

import type { Request, Response } from 'express';
import * as db from '../config/db.js';
import { getFeedbackForHistoricalQuotes } from '../config/db.js';
import {
  asyncHandler,
  NotFoundError,
  DatabaseError,
  ValidationError,
} from '../middleware/errorHandler.js';
import {
  processEnhancedMatches,
  findEnhancedMatches,
  generatePricingPrompt,
  normalizeServiceType,
  classifyCargo,
  learnFromFeedback,
  recordPricingOutcome,
  suggestPriceWithFeedback,
} from '../services/enhancedQuoteMatchingService.js';
import emailExtractorService from '../services/mail/emailExtractor.js';
import jobProcessor from '../services/jobProcessor.js';
import { getLatestLastReceivedDateTime } from '../config/db.js';
import type {
  FeedbackReason,
  MatchCriteria,
  Quote,
  MatchResult,
  MatchingOptions,
  LearningResult,
} from '../types/index.js';

// Valid feedback reasons for validation
const VALID_FEEDBACK_REASONS: FeedbackReason[] = [
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

interface MatchQuery {
  limit?: string;
  minScore?: string;
}

interface CreateMatchBody {
  sourceQuoteId: number;
  matchedQuoteId: number;
  similarityScore: number;
  matchCriteria?: MatchCriteria;
  suggestedPrice?: number;
  priceConfidence?: number;
  algorithmVersion?: string;
}

interface BulkMatchBody {
  matches: CreateMatchBody[];
}

interface FeedbackBody {
  rating: 1 | -1;
  feedbackReason?: FeedbackReason;
  feedbackNotes?: string;
  actualPriceUsed?: number;
  userId?: string;
}

interface FeedbackStatsQuery {
  algorithmVersion?: string;
  startDate?: string;
  endDate?: string;
}

interface ExtractAndMatchBody {
  searchQuery?: string;
  maxEmails?: number;
  startDate?: string | null;
  scoreThreshold?: number;
  minScore?: number;
  maxMatches?: number;
  useAI?: boolean;
  async?: boolean;
}

interface RunMatchingBody {
  quoteIds: number[];
  minScore?: number;
  maxMatches?: number;
  useAI?: boolean;
}

interface AnalyzeQuoteBody {
  origin_city?: string;
  origin_state_province?: string;
  origin_country?: string;
  destination_city?: string;
  destination_state_province?: string;
  destination_country?: string;
  service_type?: string;
  cargo_description?: string;
  cargo_weight?: number;
  weight_unit?: string;
  number_of_pieces?: number;
  hazardous_material?: boolean;
}

interface PricingOutcomeBody {
  actualPriceQuoted?: number;
  actualPriceAccepted?: number;
  jobWon?: boolean;
}

/**
 * Get matches for a specific quote
 * GET /api/matches/quote/:quoteId
 */
export const getMatchesForQuote = asyncHandler(async (req: Request, res: Response) => {
  const { quoteId } = req.params;
  const { limit: limitStr, minScore: minScoreStr } = req.query as MatchQuery;
  const limit = parseInt(limitStr || '10');
  const minScore = parseFloat(minScoreStr || '0');

  try {
    const matches = await db.getMatchesForQuote(quoteId, { limit, minScore });

    res.json({
      success: true,
      quoteId: parseInt(quoteId),
      count: matches.length,
      matches,
    });
  } catch (error) {
    throw new DatabaseError('fetching matches for quote', error as Error);
  }
});

/**
 * Get a single match by ID
 * GET /api/matches/:matchId
 */
export const getMatchById = asyncHandler(async (req: Request, res: Response) => {
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
    throw new DatabaseError('fetching match by ID', error as Error);
  }
});

/**
 * Create a new match (typically called by matching algorithm)
 * POST /api/matches
 */
export const createMatch = asyncHandler(async (req: Request, res: Response) => {
  const {
    sourceQuoteId,
    matchedQuoteId,
    similarityScore,
    matchCriteria,
    suggestedPrice,
    priceConfidence,
    algorithmVersion,
  } = req.body as CreateMatchBody;

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
    throw new DatabaseError('creating match', error as Error);
  }
});

/**
 * Create multiple matches in bulk
 * POST /api/matches/bulk
 */
export const createMatchesBulk = asyncHandler(async (req: Request, res: Response) => {
  const { matches } = req.body as BulkMatchBody;

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
    throw new DatabaseError('creating matches in bulk', error as Error);
  }
});

/**
 * Delete a match
 * DELETE /api/matches/:matchId
 */
export const deleteMatch = asyncHandler(async (req: Request, res: Response) => {
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
    throw new DatabaseError('deleting match', error as Error);
  }
});

// =====================================================
// Feedback Endpoints
// =====================================================

/**
 * Submit feedback for a match
 * POST /api/matches/:matchId/feedback
 */
export const submitFeedback = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params;
  const { rating, feedbackReason, feedbackNotes, actualPriceUsed, userId } =
    req.body as FeedbackBody;

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
    throw new DatabaseError('submitting feedback', error as Error);
  }
});

/**
 * Get feedback for a specific match
 * GET /api/matches/:matchId/feedback
 */
export const getFeedbackForMatch = asyncHandler(async (req: Request, res: Response) => {
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
    throw new DatabaseError('fetching feedback for match', error as Error);
  }
});

/**
 * Get overall feedback statistics
 * GET /api/matches/feedback/stats
 */
export const getFeedbackStatistics = asyncHandler(async (req: Request, res: Response) => {
  const { algorithmVersion, startDate, endDate } = req.query as FeedbackStatsQuery;

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
    throw new DatabaseError('fetching feedback statistics', error as Error);
  }
});

/**
 * Get feedback breakdown by reason
 * GET /api/matches/feedback/by-reason
 */
export const getFeedbackByReason = asyncHandler(async (req: Request, res: Response) => {
  try {
    const breakdown = await db.getFeedbackByReason();

    res.json({
      success: true,
      breakdown,
    });
  } catch (error) {
    throw new DatabaseError('fetching feedback by reason', error as Error);
  }
});

/**
 * Get match criteria performance analysis
 * GET /api/matches/feedback/criteria-performance
 */
export const getMatchCriteriaPerformance = asyncHandler(async (req: Request, res: Response) => {
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
    throw new DatabaseError('fetching criteria performance', error as Error);
  }
});

// =====================================================
// Extract and Match Combined Endpoints
// =====================================================

/**
 * Extract quotes from emails and run matching (async job)
 * POST /api/matches/extract-and-match
 * Body: { searchQuery?, maxEmails?, startDate?, scoreThreshold?, minScore?, maxMatches?, useAI?, async? }
 */
export const extractAndMatch = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ExtractAndMatchBody;
  const lastProcessDate =
    body.startDate ??
    (await getLatestLastReceivedDateTime()) ??
    new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // Default to 3 days ago

  const {
    searchQuery = '',
    maxEmails = 500,
    scoreThreshold = 50,
    minScore = 0.45,
    maxMatches = 3,
    useAI = true,
    async: isAsync = true,
  } = body;

  const startDate = body.startDate ?? lastProcessDate;

  const jobData = {
    searchQuery,
    maxEmails,
    startDate,
    scoreThreshold,
    matchingOptions: {
      minScore,
      maxMatches,
      useAI,
    } as MatchingOptions,
  };

  if (isAsync) {
    const jobId = await jobProcessor.createJob(jobData);

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
    const extractionResults = await emailExtractorService.processEmails({
      searchQuery,
      maxEmails,
      startDate,
      scoreThreshold,
    });

    let matchingResults: MatchResult = {
      processed: 0,
      matchesCreated: 0,
      errors: [],
      matchDetails: [],
    };

    if (extractionResults.newQuoteIds && extractionResults.newQuoteIds.length > 0) {
      matchingResults = await processEnhancedMatches(extractionResults.newQuoteIds, {
        minScore,
        maxMatches,
        useAI,
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
          matchDetails: matchingResults.matchDetails,
          errors: matchingResults.errors,
        },
      },
    });
  } catch (error) {
    throw new DatabaseError('extract and match operation', error as Error);
  }
});

// =====================================================
// Matching Endpoints
// =====================================================

/**
 * Run matching for specific quote IDs
 * POST /api/matches/run
 * Body: { quoteIds: [1, 2, 3], minScore?: 0.45, maxMatches?: 10, useAI?: true }
 */
export const runMatchingForQuotes = asyncHandler(async (req: Request, res: Response) => {
  const { quoteIds, minScore = 0.45, maxMatches = 10, useAI = true } =
    req.body as RunMatchingBody;

  if (!quoteIds || !Array.isArray(quoteIds) || quoteIds.length === 0) {
    throw new ValidationError('quoteIds array is required and cannot be empty');
  }

  for (const id of quoteIds) {
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      throw new ValidationError('All quoteIds must be integers');
    }
  }

  try {
    const results = await processEnhancedMatches(quoteIds, {
      minScore,
      maxMatches,
      useAI,
    });

    res.json({
      success: true,
      message: `Matching completed for ${results.processed} quotes`,
      results: {
        quotesProcessed: results.processed,
        matchesCreated: results.matchesCreated,
        matchDetails: results.matchDetails,
        errors: results.errors,
      },
    });
  } catch (error) {
    throw new DatabaseError('running matching algorithm', error as Error);
  }
});

/**
 * Get pricing suggestion with AI prompt for a quote
 * GET /api/matches/pricing-suggestion/:quoteId
 * Returns matches + AI prompt for pricing recommendation
 */
export const getPricingSuggestion = asyncHandler(async (req: Request, res: Response) => {
  const { quoteId } = req.params;
  const { limit: limitStr } = req.query as { limit?: string };
  const limit = parseInt(limitStr || '5');

  const quoteIdInt = parseInt(quoteId);
  if (isNaN(quoteIdInt)) {
    throw new ValidationError('quoteId must be a valid integer');
  }

  try {
    // Get the source quote
    const sourceQuote = await db.getQuoteForMatching(quoteIdInt);
    if (!sourceQuote) {
      throw new NotFoundError(`Quote with ID: ${quoteId}`);
    }

    // Get historical quotes for matching
    const historicalQuotes = await db.getHistoricalQuotesForMatching([quoteIdInt], {
      limit: 500,
      onlyWithPrice: true,
    });

    // Get feedback data for historical quotes to boost matches with positive feedback
    const historicalQuoteIds = historicalQuotes.map(q => q.quote_id!).filter(id => id != null);
    const feedbackData = await getFeedbackForHistoricalQuotes(historicalQuoteIds);

    // Find enhanced matches with feedback data
    const matches = findEnhancedMatches(sourceQuote, historicalQuotes, {
      minScore: 0.3,
      maxMatches: limit,
      feedbackData,
    });

    // Generate pricing prompt (now includes feedback details)
    const pricingPrompt = generatePricingPrompt(sourceQuote, matches);

    // Calculate aggregate suggested price
    let aggregateSuggestion: {
      weightedAverage: number;
      range: { low: number; high: number };
      confidence: number;
      basedOn: number;
    } | null = null;

    if (matches.length > 0) {
      const pricesWithConfidence = matches
        .filter((m) => m.suggested_price && m.suggested_price > 0)
        .map((m) => ({
          price: m.suggested_price!,
          confidence: m.price_confidence || 0.5,
          weight: m.similarity_score * (m.price_confidence || 0.5),
        }));

      if (pricesWithConfidence.length > 0) {
        const totalWeight = pricesWithConfidence.reduce((sum, p) => sum + p.weight, 0);
        const weightedAvg =
          pricesWithConfidence.reduce((sum, p) => sum + p.price * p.weight, 0) / totalWeight;

        const prices = pricesWithConfidence.map((p) => p.price);
        aggregateSuggestion = {
          weightedAverage: Math.round(weightedAvg),
          range: {
            low: Math.round(Math.min(...prices) * 0.9),
            high: Math.round(Math.max(...prices) * 1.1),
          },
          confidence: Math.round((totalWeight / pricesWithConfidence.length) * 100) / 100,
          basedOn: pricesWithConfidence.length,
        };
      }
    }

    res.json({
      success: true,
      quoteId: quoteIdInt,
      sourceQuote: {
        route: `${sourceQuote.origin_city || 'Unknown'}, ${sourceQuote.origin_country || ''} → ${sourceQuote.destination_city || 'Unknown'}, ${sourceQuote.destination_country || ''}`,
        service: sourceQuote.service_type,
        normalizedService: normalizeServiceType(sourceQuote.service_type),
        cargo: sourceQuote.cargo_description,
        cargoCategory: classifyCargo(sourceQuote.cargo_description),
        weight: sourceQuote.cargo_weight,
        weightUnit: sourceQuote.weight_unit,
      },
      matchCount: matches.length,
      aggregateSuggestion,
      topMatches: matches.slice(0, 5),
      pricingPrompt,
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('generating pricing suggestion', error as Error);
  }
});

/**
 * Analyze a quote request (for debugging/testing matching)
 * POST /api/matches/analyze
 * Body: { origin_city, destination_city, service_type, cargo_description, cargo_weight, ... }
 */
export const analyzeQuoteRequest = asyncHandler(async (req: Request, res: Response) => {
  const {
    origin_city,
    origin_state_province,
    origin_country = 'USA',
    destination_city,
    destination_state_province,
    destination_country = 'USA',
    service_type,
    cargo_description,
    cargo_weight,
    weight_unit = 'lbs',
    number_of_pieces = 1,
    hazardous_material = false,
  } = req.body as AnalyzeQuoteBody;

  // Build a virtual quote object for analysis
  const virtualQuote: Partial<Quote> = {
    quote_id: -1, // Virtual quote
    origin_city,
    origin_state_province,
    origin_country,
    destination_city,
    destination_state_province,
    destination_country,
    service_type,
    cargo_description,
    cargo_weight,
    weight_unit,
    number_of_pieces,
    hazardous_material,
  };

  try {
    // Get historical quotes
    const historicalQuotes = await db.getHistoricalQuotesForMatching([], {
      limit: 500,
      onlyWithPrice: true,
    });

    // Get feedback data for historical quotes
    const historicalQuoteIds = historicalQuotes.map(q => q.quote_id!).filter(id => id != null);
    const feedbackData = await getFeedbackForHistoricalQuotes(historicalQuoteIds);

    // Find matches with feedback data
    const matches = findEnhancedMatches(virtualQuote as Quote, historicalQuotes, {
      minScore: 0.3,
      maxMatches: 10,
      feedbackData,
    });

    // Generate pricing prompt (now includes feedback details)
    const pricingPrompt = generatePricingPrompt(virtualQuote as Quote, matches);

    res.json({
      success: true,
      analysis: {
        normalizedServiceType: normalizeServiceType(service_type),
        cargoCategory: classifyCargo(cargo_description),
        route: `${origin_city || 'Unknown'}, ${origin_country} → ${destination_city || 'Unknown'}, ${destination_country}`,
      },
      matchCount: matches.length,
      topMatches: matches.slice(0, 5).map((m) => ({
        matchedQuoteId: m.matched_quote_id,
        similarityScore: m.similarity_score,
        suggestedPrice: m.suggested_price,
        priceRange: m.price_range,
        confidence: m.price_confidence,
        matchCriteria: m.match_criteria,
        matchedQuoteData: m.matchedQuoteData,
        feedbackBoost: m.feedbackBoost,
        hasFeedback: m.feedbackData ? m.feedbackData.total_feedback_count > 0 : false,
      })),
      pricingPrompt,
    });
  } catch (error) {
    throw new DatabaseError('analyzing quote request', error as Error);
  }
});

/**
 * Helper function to process extract-and-match job asynchronously
 */
async function processExtractAndMatchJob(
  jobId: string,
  jobData: {
    searchQuery?: string;
    maxEmails?: number;
    startDate?: string | null;
    scoreThreshold?: number;
    matchingOptions?: MatchingOptions;
  }
): Promise<void> {
  try {
    await jobProcessor.updateJob(jobId, {
      status: 'processing',
      startedAt: new Date().toISOString(),
    });

    console.log(`\nStarting extract-and-match job ${jobId}...`);

    const extractionResults = await emailExtractorService.processEmails({
      searchQuery: jobData.searchQuery,
      maxEmails: jobData.maxEmails,
      startDate: jobData.startDate,
      scoreThreshold: jobData.scoreThreshold,
    });

    let matchingResults: MatchResult = {
      processed: 0,
      matchesCreated: 0,
      errors: [],
      matchDetails: [],
    };

    if (extractionResults.newQuoteIds && extractionResults.newQuoteIds.length > 0) {
      const { minScore = 0.45, maxMatches = 10, useAI = true } = jobData.matchingOptions || {};

      matchingResults = await processEnhancedMatches(extractionResults.newQuoteIds, {
        minScore,
        maxMatches,
        useAI,
      });

      if (matchingResults.matchDetails && matchingResults.matchDetails.length > 0) {
        for (const detail of matchingResults.matchDetails) {
          try {
            await recordPricingOutcome(detail.quoteId, {
              suggestedPrice: detail.suggestedPrice ?? undefined,
              priceConfidence: detail.aiPricing
                ? detail.aiPricing.confidence === 'HIGH'
                  ? 0.9
                  : detail.aiPricing.confidence === 'MEDIUM'
                    ? 0.7
                    : 0.5
                : detail.priceRange
                  ? 0.7
                  : 0.5,
              matchCount: detail.matchCount,
              topMatchScore: detail.bestScore,
            });
          } catch (err) {
            console.log(
              `  Note: Could not record pricing outcome for quote ${detail.quoteId}: ${(err as Error).message}`
            );
          }
        }
      }
    }

    // Periodically trigger learning from feedback
    const shouldLearn =
      extractionResults.newQuoteIds &&
      extractionResults.newQuoteIds.length > 0 &&
      Math.random() < 0.1;

    let learningResults: LearningResult | null = null;
    if (shouldLearn) {
      try {
        learningResults = await learnFromFeedback();
      } catch (err) {
        console.log(`  Note: Feedback learning skipped: ${(err as Error).message}`);
      }
    }

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
          processed: matchingResults.processed,
          quotesProcessed: matchingResults.processed,
          matchesCreated: matchingResults.matchesCreated,
          matchDetails: matchingResults.matchDetails,
          errors: matchingResults.errors,
        },
        learning: learningResults,
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
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
  }
}

// =====================================================
// Feedback Learning Endpoints
// =====================================================

/**
 * Trigger feedback learning to update weight adjustments
 * POST /api/matches/learn
 */
export const triggerLearning = asyncHandler(async (req: Request, res: Response) => {
  try {
    const results = await learnFromFeedback();

    res.json({
      success: true,
      message: results.success ? 'Learning completed' : 'Learning failed',
      results,
    });
  } catch (error) {
    throw new DatabaseError('triggering feedback learning', error as Error);
  }
});

/**
 * Record pricing outcome for a quote (for learning)
 * POST /api/matches/pricing-outcome/:quoteId
 * Body: { actualPriceQuoted, actualPriceAccepted, jobWon }
 */
export const recordOutcome = asyncHandler(async (req: Request, res: Response) => {
  const { quoteId } = req.params;
  const { actualPriceQuoted, actualPriceAccepted, jobWon } = req.body as PricingOutcomeBody;

  const quoteIdInt = parseInt(quoteId);
  if (isNaN(quoteIdInt)) {
    throw new ValidationError('quoteId must be a valid integer');
  }

  try {
    const result = await recordPricingOutcome(quoteIdInt, {
      actualPriceQuoted,
      actualPriceAccepted,
      jobWon,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found or pricing history table not available',
      });
    }

    res.json({
      success: true,
      message: 'Pricing outcome recorded',
      outcome: result,
    });
  } catch (error) {
    throw new DatabaseError('recording pricing outcome', error as Error);
  }
});

/**
 * Get enhanced pricing suggestion with feedback-based adjustments
 * GET /api/matches/smart-pricing/:quoteId
 */
export const getSmartPricing = asyncHandler(async (req: Request, res: Response) => {
  const { quoteId } = req.params;

  const quoteIdInt = parseInt(quoteId);
  if (isNaN(quoteIdInt)) {
    throw new ValidationError('quoteId must be a valid integer');
  }

  try {
    // Get the source quote
    const sourceQuote = await db.getQuoteForMatching(quoteIdInt);
    if (!sourceQuote) {
      throw new NotFoundError(`Quote with ID: ${quoteId}`);
    }

    // Get historical quotes for matching
    const historicalQuotes = await db.getHistoricalQuotesForMatching([quoteIdInt], {
      limit: 500,
      onlyWithPrice: true,
    });

    // Get feedback data for historical quotes
    const historicalQuoteIds = historicalQuotes.map(q => q.quote_id!).filter(id => id != null);
    const feedbackData = await getFeedbackForHistoricalQuotes(historicalQuoteIds);

    // Find enhanced matches with feedback data
    const matches = findEnhancedMatches(sourceQuote, historicalQuotes, {
      minScore: 0.3,
      maxMatches: 10,
      feedbackData,
    });

    // Get smart pricing with feedback adjustments
    const smartPricing = await suggestPriceWithFeedback(sourceQuote, matches);

    res.json({
      success: true,
      quoteId: quoteIdInt,
      sourceQuote: {
        route: `${sourceQuote.origin_city || 'Unknown'} → ${sourceQuote.destination_city || 'Unknown'}`,
        service: sourceQuote.service_type,
        cargo: sourceQuote.cargo_description,
      },
      smartPricing,
      matchCount: matches.length,
      topMatches: matches.slice(0, 3).map((m) => ({
        matchedQuoteId: m.matched_quote_id,
        score: m.similarity_score,
        suggestedPrice: m.suggested_price,
        route: `${m.matchedQuoteData?.origin} → ${m.matchedQuoteData?.destination}`,
        feedbackBoost: m.feedbackBoost,
        hasFeedback: m.feedbackData ? m.feedbackData.total_feedback_count > 0 : false,
      })),
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('generating smart pricing', error as Error);
  }
});
