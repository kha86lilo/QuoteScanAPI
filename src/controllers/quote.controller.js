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
    const result = await db.pool.query(
      `SELECT 
         q.*,
         e.email_message_id,
         e.email_subject,
         e.email_received_date,
         e.email_sender_name,
         e.email_sender_email,
         e.email_body_preview,
         e.email_has_attachments,
         e.raw_email_body,
         e.processed_at,
         e.ai_confidence_score,
         e.job_id
       FROM shipping_quotes q
       INNER JOIN shipping_emails e ON q.email_id = e.email_id
       ORDER BY q.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await db.pool.query('SELECT COUNT(*) FROM shipping_quotes');
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      quotes: result.rows,
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
    const result = await db.pool.query(
      `SELECT 
         q.*,
         e.email_message_id,
         e.email_subject,
         e.email_received_date,
         e.email_sender_name,
         e.email_sender_email,
         e.email_body_preview,
         e.email_has_attachments,
         e.raw_email_body,
         e.processed_at,
         e.ai_confidence_score,
         e.job_id
       FROM shipping_quotes q
       INNER JOIN shipping_emails e ON q.email_id = e.email_id
       WHERE q.quote_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(`Quote with ID: ${id}`);
    }

    res.json({
      success: true,
      quote: result.rows[0],
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

  let query = `
    SELECT 
      q.*,
      e.email_message_id,
      e.email_subject,
      e.email_received_date,
      e.email_sender_name,
      e.email_sender_email,
      e.email_body_preview,
      e.email_has_attachments,
      e.raw_email_body,
      e.processed_at,
      e.ai_confidence_score,
      e.job_id
    FROM shipping_quotes q
    INNER JOIN shipping_emails e ON q.email_id = e.email_id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  if (clientCompanyName) {
    query += ` AND q.client_company_name ILIKE $${paramIndex}`;
    params.push(`%${clientCompanyName}%`);
    paramIndex++;
  }

  if (quoteStatus) {
    query += ` AND q.quote_status = $${paramIndex}`;
    params.push(quoteStatus);
    paramIndex++;
  }

  if (senderEmail) {
    query += ` AND e.email_sender_email ILIKE $${paramIndex}`;
    params.push(`%${senderEmail}%`);
    paramIndex++;
  }

  if (startDate) {
    query += ` AND q.created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    query += ` AND q.created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }

  query += ' ORDER BY q.created_at DESC LIMIT 100';

  try {
    const result = await db.pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      quotes: result.rows,
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
    const result = await db.pool.query(
      'DELETE FROM shipping_quotes WHERE quote_id = $1 RETURNING quote_id',
      [id]
    );

    if (result.rows.length === 0) {
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
