/**
 * Quote Controller
 * Handles all quote-related business logic
 */

import type { Request, Response } from 'express';
import * as db from '../config/db.js';
import { asyncHandler, NotFoundError, DatabaseError } from '../middleware/errorHandler.js';

interface SearchQuotesBody {
  clientCompanyName?: string;
  quoteStatus?: string;
  startDate?: string;
  endDate?: string;
  senderEmail?: string;
}

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

/**
 * Get all quotes from database
 */
export const getAllQuotes = asyncHandler(async (req: Request, res: Response) => {
  const { limit: limitStr, offset: offsetStr } = req.query as PaginationQuery;
  const limit = parseInt(limitStr || '50');
  const offset = parseInt(offsetStr || '0');

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
    throw new DatabaseError('fetching quotes', error as Error);
  }
});

/**
 * Get a single quote by ID
 */
export const getQuoteById = asyncHandler(async (req: Request, res: Response) => {
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
    throw new DatabaseError('fetching quote by ID', error as Error);
  }
});

/**
 * Search quotes by criteria
 */
export const searchQuotes = asyncHandler(async (req: Request, res: Response) => {
  const { clientCompanyName, quoteStatus, startDate, endDate, senderEmail } =
    req.body as SearchQuotesBody;

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
    throw new DatabaseError('searching quotes', error as Error);
  }
});

/**
 * Delete a quote by ID
 */
export const deleteQuote = asyncHandler(async (req: Request, res: Response) => {
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
    throw new DatabaseError('deleting quote', error as Error);
  }
});
