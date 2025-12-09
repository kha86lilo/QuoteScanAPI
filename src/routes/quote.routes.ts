/**
 * Quote Routes
 * Handles all quote-related endpoints
 */

import express, { Router } from 'express';
import * as quoteController from '../controllers/quote.controller.js';

const router: Router = express.Router();

/**
 * Get all quotes from database
 * GET /api/quotes
 */
router.get('/', quoteController.getAllQuotes);

/**
 * Get a single quote by ID
 * GET /api/quotes/:id
 */
router.get('/:id', quoteController.getQuoteById);

/**
 * Search quotes by criteria
 * POST /api/quotes/search
 */
router.post('/search', quoteController.searchQuotes);

/**
 * Delete a quote by ID
 * DELETE /api/quotes/:id
 */
router.delete('/:id', quoteController.deleteQuote);

export default router;
