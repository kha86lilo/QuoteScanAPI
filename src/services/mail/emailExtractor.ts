/**
 * Email Extractor Service
 * Main business logic for processing shipping quote emails
 */

import * as microsoftGraphService from './microsoftGraphService.js';
import * as emailFilter from './emailFilter.js';
import * as db from '../../config/db.js';
import { getAIService, getProviderInfo } from '../ai/aiServiceFactory.js';
import type {
  Email,
  ProcessingSummary,
  ProcessingError,
  FilterPreview,
  ProcessedResults,
  FilteredResults,
} from '../../types/index.js';

interface ProcessEmailsOptions {
  searchQuery?: string;
  maxEmails?: number;
  startDate?: string | null;
  scoreThreshold?: number;
  previewMode?: boolean;
  aiProvider?: string | null;
}

interface ProcessEmailsResult {
  fetched: number;
  filtered: FilteredResults;
  processed: ProcessedResults;
  estimatedCost: number;
  estimatedSavings: number;
  errors: ProcessingError[];
  lastReceivedDateTime: string | null;
  newQuoteIds: number[];
  preview?: FilterPreview;
  summary?: ProcessingSummary;
}

interface PreviewEmailsOptions {
  searchQuery?: string;
  maxEmails?: number;
  startDate?: string | null;
  scoreThreshold?: number;
}

interface PreviewEmailsResult {
  emails: Email[];
  preview: FilterPreview | null;
}

class EmailExtractorService {
  /**
   * Process emails with pre-filtering
   */
  async processEmails(options: ProcessEmailsOptions = {}): Promise<ProcessEmailsResult> {
    const {
      searchQuery = '',
      maxEmails = 100,
      startDate = null,
      scoreThreshold = 30,
      previewMode = false,
      aiProvider = null,
    } = options;

    const aiService = getAIService(aiProvider);
    const providerInfo = getProviderInfo();

    console.log('\n' + '='.repeat(60));
    console.log('EMAIL EXTRACTION WITH PRE-FILTERING');
    console.log('='.repeat(60));
    console.log(`AI Provider: ${providerInfo.current.toUpperCase()}`);
    console.log(`Model: ${providerInfo.models[providerInfo.current as keyof typeof providerInfo.models]}`);
    console.log('='.repeat(60) + '\n');

    const results: ProcessEmailsResult = {
      fetched: 0,
      filtered: { toProcess: 0, toSkip: 0 },
      processed: { successful: 0, skipped: 0, failed: 0 },
      estimatedCost: 0,
      estimatedSavings: 0,
      errors: [],
      lastReceivedDateTime: null,
      newQuoteIds: [],
    };

    try {
      console.log(`Fetching emails with search: '${searchQuery}'`);
      const emails = await microsoftGraphService.default.fetchEmails({
        searchQuery,
        top: maxEmails,
        startDate,
      });

      results.fetched = emails.length;

      if (emails.length === 0) {
        console.log('No emails found.');
        return results;
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log('STEP 1: PRE-FILTERING EMAILS');
      console.log(`${'='.repeat(60)}\n`);

      const { toProcess, toSkip, summary } = await emailFilter.filterEmails(emails, scoreThreshold);

      results.filtered.toProcess = toProcess.length;
      results.filtered.toSkip = toSkip.length;
      results.estimatedCost = summary.estimatedCost;
      results.estimatedSavings = summary.estimatedSavings;

      if (emails.length > 0) {
        const maxReceivedDateTime = emails.reduce((max, email) => {
          const emailDate = new Date(email.receivedDateTime || '');
          return emailDate > max ? emailDate : max;
        }, new Date(0));
        results.lastReceivedDateTime = maxReceivedDateTime.toISOString();
      }

      console.log(`Total emails fetched: ${summary.total}`);
      console.log(
        `Passed filter (>= ${scoreThreshold}): ${summary.toProcess} (${summary.processPercentage}%)`
      );
      console.log(`Filtered out: ${summary.toSkip}`);
      console.log(`Estimated API cost: $${summary.estimatedCost.toFixed(2)}`);
      console.log(`Cost savings from filtering: $${summary.estimatedSavings.toFixed(2)}`);

      if (previewMode) {
        console.log('\nPREVIEW MODE - No emails will be processed');
        results.preview = { toProcess: [], toSkip: [], summary, threshold: scoreThreshold };
        return results;
      }

      if (toProcess.length === 0) {
        console.log(
          '\nNo emails passed the filter. Try lowering the threshold or adjusting search terms.'
        );
        return results;
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(
        `STEP 2: PROCESSING FILTERED EMAILS WITH ${providerInfo.current.toUpperCase()} AI`
      );
      console.log(`${'='.repeat(60)}\n`);

      for (let i = 0; i < toProcess.length; i++) {
        const email = toProcess[i];
        if (!email) continue;

        const emailNum = i + 1;
        const subject = (email.subject || 'No Subject').substring(0, 50);

        console.log(`[${emailNum}/${toProcess.length}] Processing: ${subject}...`);

        try {
          const exists = await db.checkEmailExists(email.id);
          if (exists) {
            console.log(`  Already processed, skipping`);
            results.processed.skipped++;
            continue;
          }
          const parsedData = await aiService.parseEmail(email, 3, email.attachmentText || '');

          if (!parsedData) {
            results.processed.failed++;
            results.errors.push({
              emailId: email.id,
              subject: email.subject,
              error: `Failed to parse with ${providerInfo.current}`,
            });
            continue;
          }

          if (!parsedData.quotes || parsedData.quotes.length === 0) {
            console.log(`  Warning: No quotes extracted from email`);
            results.processed.failed++;
            results.errors.push({
              emailId: email.id,
              subject: email.subject,
              error: 'No quotes found in parsed data',
            });
            continue;
          }

          const saveResult = await db.saveQuoteToDatabase(email, parsedData);
          console.log(`  Saved ${saveResult.quotes_count} quote(s) to database`);
          results.processed.successful++;

          if (saveResult.quote_ids && saveResult.quote_ids.length > 0) {
            results.newQuoteIds.push(...saveResult.quote_ids);
          }
        } catch (error) {
          const err = error as Error;
          console.error(`  Error processing email:`, err.message);
          results.processed.failed++;
          results.errors.push({
            emailId: email.id,
            subject: email.subject,
            error: err.message,
          });
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('PROCESSING COMPLETE');
      console.log('='.repeat(60));
      console.log(`Fetched: ${results.fetched} emails`);
      console.log(`Passed filter: ${results.filtered.toProcess} emails`);
      console.log(`Filtered out: ${results.filtered.toSkip} emails`);
      console.log(`Successfully processed: ${results.processed.successful}`);
      console.log(`Skipped (already in DB): ${results.processed.skipped}`);
      console.log(`Failed: ${results.processed.failed}`);
      console.log(`New quote IDs: ${results.newQuoteIds.length}`);
      const requestPrice = parseFloat(process.env.REQUEST_PRICE || '') || 0.015;
      const actualCost = results.processed.successful * requestPrice;
      console.log(`Actual cost: $${actualCost.toFixed(2)}`);
      console.log(`Money saved: $${results.estimatedSavings.toFixed(2)}`);
      console.log('='.repeat(60) + '\n');

      results.summary = {
        fetched: results.fetched,
        filtered: results.filtered,
        processed: results.processed,
        newQuoteIds: results.newQuoteIds,
        estimatedCost: results.estimatedCost,
        estimatedSavings: results.estimatedSavings,
        actualCost: actualCost,
        aiProvider: providerInfo.current,
        model: providerInfo.models[providerInfo.current as keyof typeof providerInfo.models],
        searchQuery: searchQuery,
        scoreThreshold: scoreThreshold,
        completedAt: new Date().toISOString(),
        lastReceivedDateTime: results.lastReceivedDateTime,
      };

      return results;
    } catch (error) {
      const err = error as Error;
      console.error('Error in email processing:', err);
      results.errors.push({
        error: err.message,
        stack: err.stack,
      });
      throw error;
    }
  }

  /**
   * Preview emails that would be processed
   */
  async previewEmails(options: PreviewEmailsOptions = {}): Promise<PreviewEmailsResult> {
    const {
      searchQuery = 'quote OR shipping OR freight OR cargo',
      maxEmails = 100,
      startDate = null,
      scoreThreshold = 30,
    } = options;

    const emails = await microsoftGraphService.default.fetchEmails({
      searchQuery,
      top: maxEmails,
      startDate,
    });

    if (emails.length === 0) {
      return { emails: [], preview: null };
    }

    const preview = await emailFilter.generatePreview(emails, scoreThreshold);

    return {
      emails,
      preview,
    };
  }

  /**
   * Get processing statistics
   */
  async getStats() {
    return await db.getProcessingStats();
  }

  /**
   * Helper function to sleep
   */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const emailExtractorService = new EmailExtractorService();
export default emailExtractorService;
export const processEmails = emailExtractorService.processEmails.bind(emailExtractorService);
export const previewEmails = emailExtractorService.previewEmails.bind(emailExtractorService);
