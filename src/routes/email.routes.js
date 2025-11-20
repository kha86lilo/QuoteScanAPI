/**
 * Email Routes
 * Handles all email-related endpoints
 */

import express from 'express';
import * as emailController from '../controllers/email.controller.js';
import { emailProcessingLimiter, generalApiLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

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
router.post('/processnewentries', emailProcessingLimiter, emailController.processNewEntries);

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

export default router;
