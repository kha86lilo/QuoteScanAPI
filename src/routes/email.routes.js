/**
 * Email Routes
 * Handles all email-related endpoints
 */

import express from 'express';
import * as emailController from '../controllers/email.controller.js';

const router = express.Router();

/**
 * Process emails with smart filtering
 * POST /api/emails/process-smart
 */
router.post('/process-smart', emailController.processEmailsSmart);

/**
 * Process emails without filtering
 * POST /api/emails/process
 */
router.post('/process', emailController.processEmails);

/**
 * Preview emails that would be processed
 * POST /api/emails/preview
 */
router.post('/preview', emailController.previewEmails);

/**
 * Fetch emails from Microsoft 365
 * POST /api/emails/fetch
 */
router.post('/fetch', emailController.fetchEmails);

/**
 * Parse a single email with Claude
 * POST /api/emails/parse
 */
router.post('/parse', emailController.parseEmail);

export default router;
