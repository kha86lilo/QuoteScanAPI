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
  getUnprocessedStaffReplies,
  saveStaffQuoteReply,
  getAllStaffQuoteReplies,
  checkStaffQuoteReplyExists,
  getQuoteIdsByEmailId,
  getStaffQuoteRepliesByQuoteId,
} from '../config/db.js';
import { getAIService } from '../services/ai/aiServiceFactory.js';
import attachmentProcessor from '../services/attachmentProcessor.js';
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
  startDate?: string | null;
}

/**
 * Extract staff replies from email conversations
 * 1. Gets conversation IDs from shipping_emails where sender matches staff names
 * 2. Fetches all emails in those conversations from Microsoft Graph
 * 3. Filters to only emails from staff members
 * 4. Saves to staff_replies table
 */
export const extractReplies = asyncHandler(async (req: Request, res: Response) => {
  const { senderNames = STAFF_SENDER_NAMES, startDate = null } = req.body as ExtractRepliesBody;

  // Step 1: Get all conversation IDs from shipping_emails
  console.log(`Searching for conversations, filtering by senders: ${senderNames.join(', ')}${startDate ? `, startDate: ${startDate}` : ''}`);
  const conversationIds = await getConversationIds(startDate);

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

interface ProcessStaffQuotesBody {
  maxReplies?: number;
  reprocessAll?: boolean;
}

/**
 * Process staff replies to extract pricing information
 * 1. Gets unprocessed staff replies from database
 * 2. Fetches full email body and attachments from Microsoft Graph
 * 3. Uses AI to determine if email contains pricing
 * 4. Saves results to staff_quotes_replies table
 */
export const processStaffQuotes = asyncHandler(async (req: Request, res: Response) => {
  const { maxReplies = 1000, reprocessAll = false } = req.body as ProcessStaffQuotesBody;

  const aiService = getAIService();

  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING STAFF REPLIES FOR PRICING INFORMATION');
  console.log('='.repeat(60) + '\n');

  // Step 1: Get unprocessed staff replies
  const staffReplies = await getUnprocessedStaffReplies(maxReplies);

  if (staffReplies.length === 0) {
    return res.json({
      success: true,
      message: 'No unprocessed staff replies found',
      results: {
        processed: 0,
        pricingEmails: 0,
        nonPricingEmails: 0,
        failed: 0,
      },
    });
  }

  console.log(`Found ${staffReplies.length} staff replies to process`);

  const results = {
    processed: 0,
    pricingEmails: 0,
    nonPricingEmails: 0,
    failed: 0,
    errors: [] as { replyId: number; subject?: string; error: string }[],
  };

  // Step 2: Process each staff reply
  for (let i = 0; i < staffReplies.length; i++) {
    const staffReply = staffReplies[i];
    if (!staffReply || !staffReply.reply_id) continue;

    const subject = (staffReply.subject || 'No Subject').substring(0, 50);
    console.log(`[${i + 1}/${staffReplies.length}] Processing: ${subject}...`);

    try {
      // Check if already processed (unless reprocessAll is true)
      if (!reprocessAll) {
        const exists = await checkStaffQuoteReplyExists(staffReply.reply_id);
        if (exists) {
          console.log(`  Already processed, skipping`);
          continue;
        }
      }

      // Fetch full email body from Microsoft Graph
      let emailBody = staffReply.body_preview || '';
      let attachmentText = '';

      try {
        // Fetch the full email with body
        const token = await microsoftGraphService.default.getAccessToken();
        const response = await fetch(
          `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${staffReply.email_message_id}?$select=body`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (response.ok) {
          const emailData = (await response.json()) as {
            body?: { content?: string; contentType?: string };
          };
          if (emailData.body?.content) {
            emailBody = emailData.body.content;
            // Strip HTML if needed
            if (emailData.body.contentType === 'html') {
              emailBody = emailBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
            }
          }
        }
      } catch (fetchError) {
        console.log(`  Warning: Could not fetch full email body, using preview`);
      }

      // Fetch attachments if the email has them
      if (staffReply.has_attachments) {
        try {
          console.log(`  Fetching attachments...`);
          const attachmentResults = await attachmentProcessor.processEmailAttachments(
            staffReply.email_message_id
          );
          if (attachmentResults.extractedText) {
            attachmentText = attachmentResults.extractedText;
            console.log(`  Extracted ${attachmentText.length} chars from attachments`);
          }
        } catch (attachError) {
          const err = attachError as Error;
          console.log(`  Warning: Could not process attachments: ${err.message}`);
        }
      }

      // Step 3: Use AI to analyze email for pricing
      const pricingResult = await aiService.parsePricingReply(emailBody, attachmentText);

      if (!pricingResult) {
        console.log(`  Failed to parse with AI`);
        results.failed++;
        results.errors.push({
          replyId: staffReply.reply_id,
          subject: staffReply.subject,
          error: 'AI parsing failed',
        });
        continue;
      }

      // Step 4: Get original email ID and related quote IDs
      const originalEmailId = staffReply.original_email_id ?? null;
      let relatedQuoteIds: number[] | null = null;

      if (originalEmailId) {
        try {
          relatedQuoteIds = await getQuoteIdsByEmailId(originalEmailId);
          if (relatedQuoteIds.length > 0) {
            console.log(`  Found ${relatedQuoteIds.length} related quote(s) from original email`);
          }
        } catch (quoteErr) {
          console.log(`  Warning: Could not fetch related quote IDs`);
        }
      }

      // Step 5: Save result to database (handles multiple quotes)
      const savedEntries = await saveStaffQuoteReply(
        staffReply.reply_id,
        pricingResult,
        originalEmailId,
        relatedQuoteIds,
        emailBody,
        attachmentText || null
      );

      results.processed++;
      if (pricingResult.is_pricing_email) {
        const quotesCount = pricingResult.quotes?.length || (pricingResult.pricing_data ? 1 : 0);
        results.pricingEmails++;
        const firstQuote = pricingResult.quotes?.[0] || pricingResult.pricing_data;
        console.log(`  ✓ Pricing email detected (confidence: ${pricingResult.confidence_score}, quotes: ${quotesCount}, price: $${firstQuote?.quoted_price || 'N/A'})`);
        if (quotesCount > 1) {
          console.log(`    Saved ${savedEntries.length} quote entries`);
        }
      } else {
        results.nonPricingEmails++;
        console.log(`  ✗ Not a pricing email (confidence: ${pricingResult.confidence_score})`);
      }
    } catch (error) {
      const err = error as Error;
      console.error(`  Error processing reply:`, err.message);
      results.failed++;
      results.errors.push({
        replyId: staffReply.reply_id,
        subject: staffReply.subject,
        error: err.message,
      });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total processed: ${results.processed}`);
  console.log(`Pricing emails: ${results.pricingEmails}`);
  console.log(`Non-pricing emails: ${results.nonPricingEmails}`);
  console.log(`Failed: ${results.failed}`);
  console.log('='.repeat(60) + '\n');

  res.json({
    success: true,
    message: `Processed ${results.processed} staff replies`,
    results,
  });
});

/**
 * Get all staff quote replies with pagination
 */
export const getStaffQuoteReplies = asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const onlyPricing = req.query.onlyPricing === 'true';

  const { replies, totalCount } = await getAllStaffQuoteReplies(limit, offset, onlyPricing);

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

/**
 * Get staff quote replies for a specific quote ID
 * GET /api/emails/quotes/:quoteId/replies
 * Returns all staff replies that contain pricing information for the given quote
 */
export const getQuoteReplies = asyncHandler(async (req: Request, res: Response) => {
  const quoteId = parseInt(req.params.quoteId);

  if (isNaN(quoteId)) {
    throw new ValidationError('Invalid quote ID');
  }

  const replies = await getStaffQuoteRepliesByQuoteId(quoteId);

  res.json({
    success: true,
    quoteId,
    data: replies,
    count: replies.length,
  });
});

// =====================================================
// Internal Functions (callable without req/res)
// =====================================================

interface ExtractRepliesInternalOptions {
  senderNames?: string[];
  startDate?: string | null;
}

interface ExtractRepliesInternalResult {
  conversationsFound: number;
  repliesFetched: number;
  repliesSaved: number;
}

/**
 * Internal version of extractReplies for direct calls
 */
export async function extractRepliesInternal(
  options: ExtractRepliesInternalOptions = {}
): Promise<ExtractRepliesInternalResult> {
  const { senderNames = STAFF_SENDER_NAMES, startDate = null } = options;

  // Step 1: Get all conversation IDs from shipping_emails
  console.log(`[extractRepliesInternal] Searching for conversations, filtering by senders: ${senderNames.join(', ')}${startDate ? `, startDate: ${startDate}` : ''}`);
  const conversationIds = await getConversationIds(startDate);

  if (conversationIds.length === 0) {
    return {
      conversationsFound: 0,
      repliesFetched: 0,
      repliesSaved: 0,
    };
  }

  console.log(`[extractRepliesInternal] Found ${conversationIds.length} conversations`);

  // Step 2: Fetch emails from Microsoft Graph for these conversations
  const emails = await microsoftGraphService.fetchEmailsByConversationIds({
    conversationIds,
    senderNames,
  });

  console.log(`[extractRepliesInternal] Fetched ${emails.length} emails from staff members`);

  if (emails.length === 0) {
    return {
      conversationsFound: conversationIds.length,
      repliesFetched: 0,
      repliesSaved: 0,
    };
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

  return {
    conversationsFound: conversationIds.length,
    repliesFetched: emails.length,
    repliesSaved: savedReplies.length,
  };
}

interface ProcessStaffQuotesInternalOptions {
  maxReplies?: number;
  reprocessAll?: boolean;
}

interface ProcessStaffQuotesInternalResult {
  processed: number;
  pricingEmails: number;
  nonPricingEmails: number;
  failed: number;
  errors: { replyId: number; subject?: string; error: string }[];
}

/**
 * Internal version of processStaffQuotes for direct calls
 */
export async function processStaffQuotesInternal(
  options: ProcessStaffQuotesInternalOptions = {}
): Promise<ProcessStaffQuotesInternalResult> {
  const { maxReplies = 1000, reprocessAll = false } = options;

  const aiService = getAIService();

  console.log('\n' + '='.repeat(60));
  console.log('[processStaffQuotesInternal] PROCESSING STAFF REPLIES FOR PRICING INFORMATION');
  console.log('='.repeat(60) + '\n');

  // Step 1: Get unprocessed staff replies
  const staffReplies = await getUnprocessedStaffReplies(maxReplies);

  if (staffReplies.length === 0) {
    return {
      processed: 0,
      pricingEmails: 0,
      nonPricingEmails: 0,
      failed: 0,
      errors: [],
    };
  }

  console.log(`[processStaffQuotesInternal] Found ${staffReplies.length} staff replies to process`);

  const results: ProcessStaffQuotesInternalResult = {
    processed: 0,
    pricingEmails: 0,
    nonPricingEmails: 0,
    failed: 0,
    errors: [],
  };

  // Step 2: Process each staff reply
  for (let i = 0; i < staffReplies.length; i++) {
    const staffReply = staffReplies[i];
    if (!staffReply || !staffReply.reply_id) continue;

    const subject = (staffReply.subject || 'No Subject').substring(0, 50);
    console.log(`[${i + 1}/${staffReplies.length}] Processing: ${subject}...`);

    try {
      // Check if already processed (unless reprocessAll is true)
      if (!reprocessAll) {
        const exists = await checkStaffQuoteReplyExists(staffReply.reply_id);
        if (exists) {
          console.log(`  Already processed, skipping`);
          continue;
        }
      }

      // Fetch full email body from Microsoft Graph
      let emailBody = staffReply.body_preview || '';
      let attachmentText = '';

      try {
        // Fetch the full email with body
        const token = await microsoftGraphService.default.getAccessToken();
        const response = await fetch(
          `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${staffReply.email_message_id}?$select=body`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (response.ok) {
          const emailData = (await response.json()) as {
            body?: { content?: string; contentType?: string };
          };
          if (emailData.body?.content) {
            emailBody = emailData.body.content;
            // Strip HTML if needed
            if (emailData.body.contentType === 'html') {
              emailBody = emailBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
            }
          }
        }
      } catch (fetchError) {
        console.log(`  Warning: Could not fetch full email body, using preview`);
      }

      // Fetch attachments if the email has them
      if (staffReply.has_attachments) {
        try {
          console.log(`  Fetching attachments...`);
          const attachmentResults = await attachmentProcessor.processEmailAttachments(
            staffReply.email_message_id
          );
          if (attachmentResults.extractedText) {
            attachmentText = attachmentResults.extractedText;
            console.log(`  Extracted ${attachmentText.length} chars from attachments`);
          }
        } catch (attachError) {
          const err = attachError as Error;
          console.log(`  Warning: Could not process attachments: ${err.message}`);
        }
      }

      // Step 3: Use AI to analyze email for pricing
      const pricingResult = await aiService.parsePricingReply(emailBody, attachmentText);

      if (!pricingResult) {
        console.log(`  Failed to parse with AI`);
        results.failed++;
        results.errors.push({
          replyId: staffReply.reply_id,
          subject: staffReply.subject,
          error: 'AI parsing failed',
        });
        continue;
      }

      // Step 4: Get original email ID and related quote IDs
      const originalEmailId = staffReply.original_email_id ?? null;
      let relatedQuoteIds: number[] | null = null;

      if (originalEmailId) {
        try {
          relatedQuoteIds = await getQuoteIdsByEmailId(originalEmailId);
          if (relatedQuoteIds.length > 0) {
            console.log(`  Found ${relatedQuoteIds.length} related quote(s) from original email`);
          }
        } catch (quoteErr) {
          console.log(`  Warning: Could not fetch related quote IDs`);
        }
      }

      // Step 5: Save result to database (handles multiple quotes)
      await saveStaffQuoteReply(
        staffReply.reply_id,
        pricingResult,
        originalEmailId,
        relatedQuoteIds,
        emailBody,
        attachmentText || null
      );

      results.processed++;
      if (pricingResult.is_pricing_email) {
        const quotesCount = pricingResult.quotes?.length || (pricingResult.pricing_data ? 1 : 0);
        results.pricingEmails++;
        const firstQuote = pricingResult.quotes?.[0] || pricingResult.pricing_data;
        console.log(`  ✓ Pricing email detected (confidence: ${pricingResult.confidence_score}, quotes: ${quotesCount}, price: $${firstQuote?.quoted_price || 'N/A'})`);
      } else {
        results.nonPricingEmails++;
        console.log(`  ✗ Not a pricing email (confidence: ${pricingResult.confidence_score})`);
      }
    } catch (error) {
      const err = error as Error;
      console.error(`  Error processing reply:`, err.message);
      results.failed++;
      results.errors.push({
        replyId: staffReply.reply_id,
        subject: staffReply.subject,
        error: err.message,
      });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('[processStaffQuotesInternal] PROCESSING COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total processed: ${results.processed}`);
  console.log(`Pricing emails: ${results.pricingEmails}`);
  console.log(`Non-pricing emails: ${results.nonPricingEmails}`);
  console.log(`Failed: ${results.failed}`);
  console.log('='.repeat(60) + '\n');

  return results;
}
