/**
 * Quote Controller
 * Handles all quote-related business logic
 */

import * as db from '../config/db.js';
import { asyncHandler, NotFoundError, DatabaseError } from '../middleware/errorHandler.js';

/**
 * Get all quotes from database
 */
export const getAllQuotes = asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const { quotes, totalCount } = await db.getAllQuotes(limit, offset);

    res.json({
      success: true,
      quotes,
      pagination: {
        limit,
        offset,
        total: totalCount,
        hasMore: offset + limit < totalCount,
      },
    });
  } catch (error) {
    throw new DatabaseError('fetching quotes', error);
  }
});

/**
 * Get a single quote by ID
 */
export const getQuoteById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const quote = await db.getQuoteById(id);

    if (!quote) {
      throw new NotFoundError(`Quote with ID: ${id}`);
    }

    res.json({
      success: true,
      quote,
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('fetching quote by ID', error);
  }
});

/**
 * Search quotes by criteria
 */
export const searchQuotes = asyncHandler(async (req, res) => {
  const { clientCompanyName, quoteStatus, startDate, endDate, senderEmail } = req.body;

  try {
    const quotes = await db.searchQuotes({
      clientCompanyName,
      quoteStatus,
      startDate,
      endDate,
      senderEmail,
    });

    res.json({
      success: true,
      count: quotes.length,
      quotes,
    });
  } catch (error) {
    throw new DatabaseError('searching quotes', error);
  }
});

/**
 * Delete a quote by ID
 */
export const deleteQuote = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await db.deleteQuote(id);

    if (!deleted) {
      throw new NotFoundError(`Quote with ID: ${id}`);
    }

    res.json({
      success: true,
      message: 'Quote deleted successfully',
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('deleting quote', error);
  }
});
