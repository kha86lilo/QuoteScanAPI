/**
 * Quote Controller
 * Handles all quote-related business logic
 */

import * as db from '../config/db.js';

/**
 * Get all quotes from database
 */
export const getAllQuotes = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await db.pool.query(
      `SELECT * FROM shipping_quotes 
       ORDER BY processed_at DESC 
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
        hasMore: offset + limit < totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching quotes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get a single quote by ID
 */
export const getQuoteById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.pool.query(
      'SELECT * FROM shipping_quotes WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Quote not found'
      });
    }

    res.json({
      success: true,
      quote: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Search quotes by criteria
 */
export const searchQuotes = async (req, res) => {
  try {
    const { clientCompanyName, quoteStatus, startDate, endDate } = req.body;

    let query = 'SELECT * FROM shipping_quotes WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (clientCompanyName) {
      query += ` AND client_company_name ILIKE $${paramIndex}`;
      params.push(`%${clientCompanyName}%`);
      paramIndex++;
    }

    if (quoteStatus) {
      query += ` AND quote_status = $${paramIndex}`;
      params.push(quoteStatus);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND processed_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND processed_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ' ORDER BY processed_at DESC LIMIT 100';

    const result = await db.pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      quotes: result.rows
    });
  } catch (error) {
    console.error('Error searching quotes:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Delete a quote by ID
 */
export const deleteQuote = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.pool.query(
      'DELETE FROM shipping_quotes WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Quote not found'
      });
    }

    res.json({
      success: true,
      message: 'Quote deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting quote:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
