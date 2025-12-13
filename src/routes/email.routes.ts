/**
 * Email Routes
 * Handles all email-related endpoints
 */

import express, { Router } from 'express';
import * as emailController from '../controllers/email.controller.js';
import { emailProcessingLimiter, generalApiLimiter } from '../middleware/rateLimiter.js';

const router: Router = express.Router();

/**
 * Process emails with rate limiting
 * POST /api/emails/process
 * Rate limited to 1 request per minute
 */
router.post('/process', emailProcessingLimiter, emailController.processEmails);

/**
 * Process only new emails since last job
 * POST /api/emails/processnewentries
 * Automatically uses lastReceivedDateTime from most recent completed job
 * Rate limited to 1 request per minute
 */
router.post('/processnewemails', emailProcessingLimiter, emailController.processNewEmails);

/**
 * Preview emails that would be processed
 * POST /api/emails/preview
 */
router.post('/preview', generalApiLimiter, emailController.previewEmails);

/**
 * Fetch emails from Microsoft 365
 * POST /api/emails/fetch
 */
router.post('/fetch', generalApiLimiter, emailController.fetchEmails);

/**
 * Parse a single email with Claude
 * POST /api/emails/parse
 */
router.post('/parse', generalApiLimiter, emailController.parseEmail);

/**
 * Extract staff replies from email conversations
 * POST /api/emails/extract-replies
 * Fetches replies from staff members (danny nasser, tina merkab, seahorse express)
 * and stores them in the staff_replies table
 */
router.post('/extract-replies', generalApiLimiter, emailController.extractReplies);

/**
 * Get all staff replies with pagination
 * GET /api/emails/staff-replies
 * Query params: limit, offset
 */
router.get('/staff-replies', generalApiLimiter, emailController.getStaffReplies);

/**
 * Process staff replies to extract pricing information
 * POST /api/emails/process-staff-quotes
 * Analyzes staff replies using AI to determine if they contain pricing
 * Body params: maxReplies (default 50), reprocessAll (default false)
 */
router.post('/process-staff-quotes', emailProcessingLimiter, emailController.processStaffQuotes);

/**
 * Get all staff quote replies with pagination
 * GET /api/emails/staff-quote-replies
 * Query params: limit, offset, onlyPricing (true/false)
 */
router.get('/staff-quote-replies', generalApiLimiter, emailController.getStaffQuoteReplies);

export default router;
