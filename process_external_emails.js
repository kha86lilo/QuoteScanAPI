/**
 * Process External Client Emails Only
 * Fetches emails, filters to external only, processes 20 client emails
 */

import * as microsoftGraphService from './src/services/mail/microsoftGraphService.js';
import * as emailExtractor from './src/services/mail/emailExtractor.js';
import * as db from './src/config/db.js';
import dotenv from 'dotenv';

dotenv.config();

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

async function processExternalEmails() {
  console.log(`\n${colors.bright}${colors.cyan}========================================`);
  console.log('📧 PROCESSING EXTERNAL CLIENT EMAILS ONLY');
  console.log(`========================================${colors.reset}\n`);

  try {
    // Step 1: Fetch emails from last 60 days
    console.log(`${colors.cyan}Step 1: Fetching emails from Microsoft Graph...${colors.reset}`);

    const emails = await microsoftGraphService.default.fetchEmails({
      searchQuery: 'quote OR shipping OR freight OR cargo OR oversize OR overweight',
      top: 100,
      startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    });

    console.log(`${colors.green}✓ Fetched ${emails.length} emails from inbox${colors.reset}\n`);

    // Step 2: Filter to external emails only
    console.log(`${colors.cyan}Step 2: Filtering to external client emails only...${colors.reset}`);

    const externalEmails = emails.filter((email) => {
      const senderEmail = email.from?.emailAddress?.address || '';
      const domain = senderEmail.includes('@') ? senderEmail.split('@')[1] : '';
      return domain !== 'seahorseexpress.com';
    });

    console.log(`${colors.green}✓ Found ${externalEmails.length} external client emails${colors.reset}`);
    console.log(`  (${emails.length - externalEmails.length} internal emails excluded)\n`);

    // Step 3: Filter to unprocessed emails
    console.log(`${colors.cyan}Step 3: Filtering out already-processed emails...${colors.reset}`);

    const unprocessedEmails = [];
    for (const email of externalEmails) {
      const exists = await db.checkEmailExists(email.id);
      if (!exists) {
        unprocessedEmails.push(email);
      }
    }

    console.log(`${colors.green}✓ Found ${unprocessedEmails.length} NEW unprocessed external emails${colors.reset}`);
    console.log(
      `  (${externalEmails.length - unprocessedEmails.length} already processed, skipped)\n`
    );

    if (unprocessedEmails.length === 0) {
      console.log(`${colors.yellow}⚠ All external emails have already been processed${colors.reset}\n`);
      return;
    }

    // Limit to 20 for testing
    const emailsToProcess = unprocessedEmails.slice(0, 20);
    console.log(`${colors.cyan}Will process ${emailsToProcess.length} emails${colors.reset}\n`);

    // Step 4: Preview emails
    console.log(`${colors.bright}${colors.cyan}EMAIL PREVIEW:${colors.reset}\n`);
    emailsToProcess.forEach((email, idx) => {
      const sender = email.from?.emailAddress?.address || 'Unknown';
      console.log(`${idx + 1}. ${email.subject?.substring(0, 60) || 'No subject'}...`);
      console.log(`   From: ${sender}`);
      console.log(`   Has attachments: ${email.hasAttachments ? 'Yes' : 'No'}`);
      console.log('');
    });

    // Step 5: Process emails
    console.log(`\n${colors.bright}${colors.cyan}========================================`);
    console.log('🤖 PROCESSING EMAILS WITH AI');
    console.log(`========================================${colors.reset}\n`);

    // Manually call processEmails with the filtered external emails
    // We'll pass them directly to avoid re-fetching
    let successCount = 0;
    let failCount = 0;
    const totalQuotes = [];

    for (let i = 0; i < emailsToProcess.length; i++) {
      const email = emailsToProcess[i];
      console.log(
        `\n[${i + 1}/${emailsToProcess.length}] Processing: ${email.subject?.substring(0, 50)}...`
      );

      try {
        // Import the emailExtractor service
        const { default: emailExtractorService } = await import(
          './src/services/mail/emailExtractor.js'
        );

        // We need to process each email individually
        // Since processEmails expects to fetch, let's use the AI service directly
        const { getAIService } = await import('./src/services/ai/aiServiceFactory.js');
        const aiService = getAIService();

        // Process attachments if any
        let attachmentText = '';
        if (email.hasAttachments) {
          const { processEmailAttachments } = await import('./src/services/attachmentProcessor.js');
          const attachmentResults = await processEmailAttachments(email.id);
          attachmentText = attachmentResults.extractedText || '';
          console.log(
            `  📎 Processed ${attachmentResults.processedCount || 0} attachment(s)`
          );
        }

        // Parse with AI
        const parsedData = await aiService.parseEmail(email, 3, attachmentText);

        if (!parsedData || !parsedData.quotes || parsedData.quotes.length === 0) {
          console.log(`  ${colors.red}✗ No quotes extracted${colors.reset}`);
          failCount++;
          continue;
        }

        // Save to database
        const saveResult = await db.saveQuoteToDatabase(email, parsedData);
        console.log(
          `  ${colors.green}✓ Saved ${saveResult.quotes_count} quote(s) - Confidence: ${(parsedData.confidence * 100).toFixed(0)}%${colors.reset}`
        );

        successCount++;
        totalQuotes.push(...parsedData.quotes);
      } catch (error) {
        console.error(`  ${colors.red}✗ Error:${colors.reset}`, error.message);
        failCount++;
      }
    }

    // Display results
    console.log(`\n${colors.bright}${colors.cyan}========================================`);
    console.log('📊 PROCESSING RESULTS');
    console.log(`========================================${colors.reset}\n`);

    console.log(`Total External Emails:     ${emailsToProcess.length}`);
    console.log(`Successfully Parsed:       ${colors.green}${successCount}${colors.reset}`);
    console.log(`Failed to Parse:           ${colors.red}${failCount}${colors.reset}`);
    console.log(`Total Quotes Saved:        ${colors.bright}${totalQuotes.length}${colors.reset}`);

    console.log(`\n${colors.green}✓ Processing complete!${colors.reset}\n`);
    console.log(
      `${colors.cyan}Next step: Run 'node analyze_quotes.js' to see updated accuracy analysis${colors.reset}\n`
    );
  } catch (error) {
    console.error(`${colors.red}✗ Error:${colors.reset}`, error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

// Run the script
processExternalEmails().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
