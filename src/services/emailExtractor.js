/**
 * Email Extractor Service
 * Main business logic for processing shipping quote emails
 */

import * as microsoftGraphService from "./microsoftGraphService.js";
import * as emailFilter from "./emailFilter.js";
import * as db from "../config/db.js";
import { getAIService, getProviderInfo } from "./ai/aiServiceFactory.js";

class EmailExtractorService {
  /**
   * Process emails with smart pre-filtering
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async processEmailsSmart(options = {}) {
    const {
      searchQuery = "quote OR shipping OR freight OR cargo",
      maxEmails = 100,
      startDate = null,
      scoreThreshold = 30,
      previewMode = false,
      aiProvider = null, // Optional: override AI provider
    } = options;

    // Get configured AI service
    const aiService = getAIService(aiProvider);
    const providerInfo = getProviderInfo();

    console.log("\n" + "=".repeat(60));
    console.log("SMART EMAIL EXTRACTION WITH PRE-FILTERING");
    console.log("=".repeat(60));
    console.log(`AI Provider: ${providerInfo.current.toUpperCase()}`);
    console.log(`Model: ${providerInfo.models[providerInfo.current]}`);
    console.log("=".repeat(60) + "\n");

    const results = {
      fetched: 0,
      filtered: { toProcess: 0, toSkip: 0 },
      processed: { successful: 0, skipped: 0, failed: 0 },
      estimatedCost: 0,
      estimatedSavings: 0,
      errors: [],
    };

    try {
      // Fetch emails
      console.log(`Fetching emails with search: '${searchQuery}'`);
      const emails = await microsoftGraphService.fetchEmails({
        searchQuery,
        top: maxEmails,
        startDate,
      });

      results.fetched = emails.length;

      if (emails.length === 0) {
        console.log("No emails found.");
        return results;
      }

      // Pre-filter emails
      console.log(`\n${"=".repeat(60)}`);
      console.log("STEP 1: PRE-FILTERING EMAILS");
      console.log(`${"=".repeat(60)}\n`);

      const { toProcess, toSkip, summary } = emailFilter.filterEmails(
        emails,
        scoreThreshold
      );

      results.filtered.toProcess = toProcess.length;
      results.filtered.toSkip = toSkip.length;
      results.estimatedCost = summary.estimatedCost;
      results.estimatedSavings = summary.estimatedSavings;

      console.log(`Total emails fetched: ${summary.total}`);
      console.log(
        `✓ Passed filter (>= ${scoreThreshold}): ${summary.toProcess} (${summary.processPercentage}%)`
      );
      console.log(`✗ Filtered out: ${summary.toSkip}`);
      console.log(
        `💰 Estimated Claude API cost: $${summary.estimatedCost.toFixed(2)}`
      );
      console.log(
        `💾 Cost savings from filtering: $${summary.estimatedSavings.toFixed(
          2
        )}`
      );

      if (previewMode) {
        console.log("\n⚠️ PREVIEW MODE - No emails will be processed");
        results.preview = { toProcess, toSkip, summary };
        return results;
      }

      if (toProcess.length === 0) {
        console.log(
          "\n❌ No emails passed the filter. Try lowering the threshold or adjusting search terms."
        );
        return results;
      }

      // Process filtered emails
      console.log(`\n${"=".repeat(60)}`);
      console.log(
        `STEP 2: PROCESSING FILTERED EMAILS WITH ${providerInfo.current.toUpperCase()} AI`
      );
      console.log(`${"=".repeat(60)}\n`);

      for (let i = 0; i < toProcess.length; i++) {
        const email = toProcess[i];
        const emailNum = i + 1;
        const subject = (email.subject || "No Subject").substring(0, 50);

        console.log(
          `[${emailNum}/${toProcess.length}] Processing: ${subject}...`
        );

        try {
          // Check if already processed
          const exists = await db.checkEmailExists(email.id);
          if (exists) {
            console.log(`  ⊘ Already processed, skipping`);
            results.processed.skipped++;
            continue;
          }

          // Parse with configured AI service
          const parsedData = await aiService.parseEmail(email);
          const emailHasAttachment = email.hasAttachments || false;
          if (!parsedData && !emailHasAttachment) {
            results.processed.failed++;
            results.errors.push({
              emailId: email.id,
              subject: email.subject,
              error: `Failed to parse with ${providerInfo.current}`,
            });
            continue;
          }

          // Save to database
          await db.saveQuoteToDatabase(email, parsedData);
          console.log(`  ✓ Saved to database`);
          results.processed.successful++;
        } catch (error) {
          console.error(`  ✗ Error processing email:`, error.message);
          results.processed.failed++;
          results.errors.push({
            emailId: email.id,
            subject: email.subject,
            error: error.message,
          });
        }
      }

      // Summary
      console.log("\n" + "=".repeat(60));
      console.log("PROCESSING COMPLETE");
      console.log("=".repeat(60));
      console.log(`📊 Fetched: ${results.fetched} emails`);
      console.log(`✓ Passed filter: ${results.filtered.toProcess} emails`);
      console.log(`⊘ Filtered out: ${results.filtered.toSkip} emails`);
      console.log(`✓ Successfully processed: ${results.processed.successful}`);
      console.log(`⊘ Skipped (already in DB): ${results.processed.skipped}`);
      console.log(`✗ Failed: ${results.processed.failed}`);
      console.log(
        `💰 Actual cost: $${(results.processed.successful * 0.015).toFixed(2)}`
      );
      console.log(`💾 Money saved: $${results.estimatedSavings.toFixed(2)}`);
      console.log("=".repeat(60) + "\n");

      return results;
    } catch (error) {
      console.error("✗ Error in email processing:", error);
      results.errors.push({
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Process emails without pre-filtering (original method)
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async processEmails(options = {}) {
    const {
      searchQuery = "quote OR shipping OR freight OR cargo",
      maxEmails = 100,
      startDate = null,
      aiProvider = null, // Optional: override AI provider
    } = options;

    // Get configured AI service
    const aiService = getAIService(aiProvider);
    const providerInfo = getProviderInfo();

    console.log("\n" + "=".repeat(60));
    console.log("SHIPPING QUOTE EMAIL EXTRACTION");
    console.log("=".repeat(60));
    console.log(`AI Provider: ${providerInfo.current.toUpperCase()}`);
    console.log(`Model: ${providerInfo.models[providerInfo.current]}`);
    console.log("=".repeat(60) + "\n");

    const results = {
      fetched: 0,
      processed: { successful: 0, skipped: 0, failed: 0 },
      errors: [],
    };

    try {
      // Fetch emails
      console.log(`Fetching emails with search: '${searchQuery}'`);
      const emails = await microsoftGraphService.fetchEmails({
        searchQuery,
        top: maxEmails,
        startDate,
      });

      results.fetched = emails.length;

      if (emails.length === 0) {
        console.log("No emails found.");
        return results;
      }

      console.log(`\nProcessing ${emails.length} emails...\n`);

      // Process each email
      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        const emailNum = i + 1;
        const subject = (email.subject || "No Subject").substring(0, 50);

        console.log(`[${emailNum}/${emails.length}] Processing: ${subject}...`);

        try {
          // Check if already processed
          const exists = await db.checkEmailExists(email.id);
          if (exists) {
            console.log(`  ⊘ Already processed, skipping`);
            results.processed.skipped++;
            continue;
          }

          // Parse with configured AI service
          const parsedData = await aiService.parseEmail(email);

          if (!parsedData) {
            results.processed.failed++;
            results.errors.push({
              emailId: email.id,
              subject: email.subject,
              error: `Failed to parse with ${providerInfo.current}`,
            });
            continue;
          }

          // Save to database
          await db.saveQuoteToDatabase(email, parsedData);
          console.log(`  ✓ Saved to database`);
          results.processed.successful++;

          // Delay to avoid rate limiting
          if (i < emails.length - 1) {
            await this.sleep(8000);
          }
        } catch (error) {
          console.error(`  ✗ Error processing email:`, error.message);
          results.processed.failed++;
          results.errors.push({
            emailId: email.id,
            subject: email.subject,
            error: error.message,
          });
        }
      }

      // Summary
      console.log("\n" + "=".repeat(60));
      console.log("PROCESSING COMPLETE");
      console.log("=".repeat(60));
      console.log(`✓ Successfully processed: ${results.processed.successful}`);
      console.log(`⊘ Skipped (already in DB): ${results.processed.skipped}`);
      console.log(`✗ Failed: ${results.processed.failed}`);
      console.log(`Total: ${results.fetched}`);
      console.log("=".repeat(60) + "\n");

      return results;
    } catch (error) {
      console.error("✗ Error in email processing:", error);
      results.errors.push({
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Preview emails that would be processed
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Preview data
   */
  async previewEmails(options = {}) {
    const {
      searchQuery = "quote OR shipping OR freight OR cargo",
      maxEmails = 100,
      startDate = null,
      scoreThreshold = 30,
    } = options;

    const emails = await microsoftGraphService.fetchEmails({
      searchQuery,
      top: maxEmails,
      startDate,
    });

    if (emails.length === 0) {
      return { emails: [], preview: null };
    }

    const preview = emailFilter.generatePreview(emails, scoreThreshold);

    return {
      emails,
      preview,
    };
  }

  /**
   * Get processing statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    return await db.getProcessingStats();
  }

  /**
   * Helper function to sleep
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const emailExtractorService = new EmailExtractorService();
export default emailExtractorService;
export const { processEmailsSmart, processEmails, previewEmails } =
  emailExtractorService;
