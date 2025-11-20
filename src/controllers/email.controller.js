/**
 * Email Controller
 * Handles all email-related business logic
 */

import * as emailExtractor from '../services/emailExtractor.js';
import * as microsoftGraphService from '../services/microsoftGraphService.js';
import * as claudeService from '../services/ai/claudeService.js';
import jobProcessor from '../services/jobProcessor.js';
import { getLatestLastReceivedDateTime } from '../config/db.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';

/**
 * Helper function to create and start an email processing job
 * @param {Object} jobData - Job configuration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} options - Additional response options
 */
const createEmailProcessingJob = (jobData, req, res, options = {}) => {
  // Create job
  const jobId = jobProcessor.createJob(jobData);

  // Start processing in background
  jobProcessor.startJob(jobId);

  // Return 202 Accepted with status URL
  const statusUrl = `${req.protocol}://${req.get('host')}/api/jobs/${jobId}`;

  const response = {
    success: true,
    message: options.message || 'Job accepted for processing',
    jobId: jobId,
    statusUrl: statusUrl,
    statusCheckInterval: '5-10 seconds recommended',
    ...options.additionalData,
  };

  return res.status(202).json(response);
};

/**
 * Process emails with filtering (async with job tracking)
 */
export const processEmails = asyncHandler(async (req, res) => {
  const {
    searchQuery = 'quote OR shipping OR freight OR cargo',
    maxEmails = 50,
    startDate = null,
    scoreThreshold = 30,
    previewMode = false,
    async = true, // Default to async processing
  } = req.body;

  const jobData = {
    searchQuery,
    maxEmails,
    startDate,
    scoreThreshold,
    previewMode,
  };

  // If async processing is enabled (default)
  if (async) {
    return createEmailProcessingJob(jobData, req, res);
  }

  // Synchronous processing (for backward compatibility)
  const results = await emailExtractor.processEmails(jobData);

  res.json({
    success: true,
    results,
  });
});

/**
 * Process only new emails since last processing job
 * Automatically uses the lastReceivedDateTime from the most recent completed job
 */
export const processNewEntries = asyncHandler(async (req, res) => {
  // Get the latest lastReceivedDateTime from completed jobs
  const startDate = await getLatestLastReceivedDateTime();

  // Build job data with incremental processing parameters
  const jobData = {
    searchQuery: '',
    maxEmails: 1000,
    startDate: startDate,
    scoreThreshold: 30,
    previewMode: false,
  };

  return createEmailProcessingJob(jobData, req, res, {
    message: 'Job accepted for processing new entries',
    additionalData: {
      incrementalProcessing: {
        startDate: startDate,
        description: startDate
          ? `Processing emails received after ${startDate}`
          : 'Processing all emails (no previous job found)',
      },
    },
  });
});
/**
 * Preview emails that would be processed
 */
export const previewEmails = asyncHandler(async (req, res) => {
  const {
    searchQuery = 'quote OR shipping OR freight OR cargo',
    maxEmails = 50,
    startDate = null,
    scoreThreshold = 30,
  } = req.body;

  const preview = await emailExtractor.previewEmails({
    searchQuery,
    maxEmails,
    startDate,
    scoreThreshold,
  });

  res.json({
    success: true,
    preview,
  });
});

/**
 * Fetch emails from Microsoft 365
 */
export const fetchEmails = asyncHandler(async (req, res) => {
  const {
    searchQuery = 'quote OR shipping OR freight OR cargo',
    maxEmails = 50,
    startDate = null,
  } = req.body;

  const emails = await microsoftGraphService.fetchEmails({
    searchQuery,
    top: maxEmails,
    startDate,
  });

  res.json({
    success: true,
    count: emails.length,
    emails,
  });
});

/**
 * Parse a single email with Claude
 */
export const parseEmail = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ValidationError('Email object is required');
  }

  const parsedData = await claudeService.parseEmailWithClaude(email);

  res.json({
    success: true,
    parsedData,
  });
});
