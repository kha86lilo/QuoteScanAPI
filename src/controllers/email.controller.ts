/**
 * Email Controller
 * Handles all email-related business logic
 */

import type { Request, Response } from 'express';
import * as emailExtractor from '../services/mail/emailExtractor.js';
import * as microsoftGraphService from '../services/mail/microsoftGraphService.js';
import claudeService from '../services/ai/claudeService.js';
import jobProcessor from '../services/jobProcessor.js';
import {
  getLatestLastReceivedDateTime,
  getConversationIds,
  saveStaffRepliesBulk,
  getOriginalEmailIdByConversation,
  getAllStaffReplies,
} from '../config/db.js';
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js';
import type { Email, JobData, StaffReply } from '../types/index.js';

interface ProcessEmailsBody {
  searchQuery?: string;
  maxEmails?: number;
  startDate?: string | null;
  scoreThreshold?: number;
  previewMode?: boolean;
  async?: boolean;
}

interface CreateJobOptions {
  message?: string;
  additionalData?: Record<string, unknown>;
}

/**
 * Helper function to create and start an email processing job
 */
const createEmailProcessingJob = async (
  jobData: JobData,
  req: Request,
  res: Response,
  options: CreateJobOptions = {}
): Promise<Response> => {
  // Create job (now async - persists to database first)
  const jobId = await jobProcessor.createJob(jobData);

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
export const processEmails = asyncHandler(async (req: Request, res: Response): Promise<Response | void> => {
  const {
    searchQuery = 'quote OR shipping OR freight OR cargo',
    maxEmails = 50,
    startDate = null,
    scoreThreshold = 30,
    previewMode = false,
    async = true, // Default to async processing
  } = req.body as ProcessEmailsBody;

  const jobData: JobData = {
    searchQuery,
    maxEmails,
    startDate,
    scoreThreshold,
    previewMode,
  };

  // If async processing is enabled (default)
  if (async) {
    return await createEmailProcessingJob(jobData, req, res);
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
export const processNewEmails = asyncHandler(async (req: Request, res: Response) => {
  // Get the latest lastReceivedDateTime from completed jobs
  const startDate = await getLatestLastReceivedDateTime();

  // Build job data with incremental processing parameters
  const jobData: JobData = {
    maxEmails: 500,
    startDate: startDate ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    scoreThreshold: 30,
    previewMode: false,
  };

  return await createEmailProcessingJob(jobData, req, res, {
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
export const previewEmails = asyncHandler(async (req: Request, res: Response) => {
  const {
    searchQuery = 'quote OR shipping OR freight OR cargo',
    maxEmails = 50,
    startDate = null,
    scoreThreshold = 30,
  } = req.body as ProcessEmailsBody;

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
export const fetchEmails = asyncHandler(async (req: Request, res: Response) => {
  const {
    searchQuery = 'quote OR shipping OR freight OR cargo',
    maxEmails = 50,
    startDate = null,
  } = req.body as ProcessEmailsBody;

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

interface ParseEmailBody {
  email?: Email;
}

/**
 * Parse a single email with Claude
 */
export const parseEmail = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as ParseEmailBody;

  if (!email) {
    throw new ValidationError('Email object is required');
  }

  const parsedData = await claudeService.parseEmailWithClaude(email);

  res.json({
    success: true,
    parsedData,
  });
});

// Staff names to filter replies from
const STAFF_SENDER_NAMES = ['danny nasser', 'tina merkab', 'seahorse express'];

interface ExtractRepliesBody {
  senderNames?: string[];
}

/**
 * Extract staff replies from email conversations
 * 1. Gets conversation IDs from shipping_emails where sender matches staff names
 * 2. Fetches all emails in those conversations from Microsoft Graph
 * 3. Filters to only emails from staff members
 * 4. Saves to staff_replies table
 */
export const extractReplies = asyncHandler(async (req: Request, res: Response) => {
  const { senderNames = STAFF_SENDER_NAMES } = req.body as ExtractRepliesBody;

  // Step 1: Get all conversation IDs from shipping_emails
  console.log(`Searching for conversations, filtering by senders: ${senderNames.join(', ')}`);
  const conversationIds = await getConversationIds();

  if (conversationIds.length === 0) {
    return res.json({
      success: true,
      message: 'No conversations found matching the specified senders',
      results: {
        conversationsFound: 0,
        repliesFetched: 0,
        repliesSaved: 0,
      },
    });
  }

  console.log(`Found ${conversationIds.length} conversations`);

  // Step 2: Fetch emails from Microsoft Graph for these conversations
  const emails = await microsoftGraphService.fetchEmailsByConversationIds({
    conversationIds,
    senderNames,
  });

  console.log(`Fetched ${emails.length} emails from staff members`);

  if (emails.length === 0) {
    return res.json({
      success: true,
      message: 'No staff replies found in the conversations',
      results: {
        conversationsFound: conversationIds.length,
        repliesFetched: 0,
        repliesSaved: 0,
      },
    });
  }

  // Step 3: Transform emails to StaffReply format and save
  const staffReplies: StaffReply[] = [];

  for (const email of emails) {
    const originalEmailId = email.conversationId
      ? await getOriginalEmailIdByConversation(email.conversationId)
      : null;

    staffReplies.push({
      email_message_id: email.id,
      conversation_id: email.conversationId || '',
      original_email_id: originalEmailId ?? undefined,
      sender_name: email.from?.emailAddress?.name,
      sender_email: email.from?.emailAddress?.address,
      subject: email.subject,
      body_preview: email.bodyPreview,
      received_date: email.receivedDateTime,
      has_attachments: email.hasAttachments,
    });
  }

  // Step 4: Save to database
  const savedReplies = await saveStaffRepliesBulk(staffReplies);

  res.json({
    success: true,
    message: `Successfully extracted and saved ${savedReplies.length} staff replies`,
    results: {
      conversationsFound: conversationIds.length,
      repliesFetched: emails.length,
      repliesSaved: savedReplies.length,
    },
  });
});

/**
 * Get all staff replies with pagination
 */
export const getStaffReplies = asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;

  const { replies, totalCount } = await getAllStaffReplies(limit, offset);

  res.json({
    success: true,
    data: replies,
    pagination: {
      limit,
      offset,
      total: totalCount,
      hasMore: offset + replies.length < totalCount,
    },
  });
});
