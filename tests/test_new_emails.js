/**
 * Test Script: Fetch and Process New Emails
 * Fetches 20 new unprocessed emails and processes them through the updated AI system
 */

import * as microsoftGraphService from '../src/services/mail/microsoftGraphService.js';
import * as emailExtractor from '../src/services/mail/emailExtractor.js';
import * as db from '../src/config/db.js';
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

async function fetchAndProcessNewEmails() {
  console.log(`\n${colors.bright}${colors.cyan}========================================`);
  console.log('📧 FETCHING NEW UNPROCESSED EMAILS');
  console.log(`========================================${colors.reset}\n`);

  try {
    // Step 1: Get the latest processed email date
    console.log(`${colors.cyan}Step 1: Finding latest processed email...${colors.reset}`);
    const latestDate = await db.getLatestLastReceivedDateTime();

    if (latestDate) {
      console.log(`${colors.green}✓ Latest processed email: ${latestDate}${colors.reset}`);
      console.log(`  Will fetch emails received AFTER this date\n`);
    } else {
      console.log(`${colors.yellow}⚠ No previously processed emails found${colors.reset}`);
      console.log(`  Will fetch recent emails (last 30 days)\n`);
    }

    // Step 2: Fetch new emails from Microsoft Graph
    console.log(`${colors.cyan}Step 2: Fetching emails from Microsoft Graph...${colors.reset}`);

    const startDate = latestDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const emails = await microsoftGraphService.default.fetchEmails({ 
    maxEmails: 1000,
    startDate: startDate ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    scoreThreshold: 30,
    previewMode: false,
  });

    console.log(`${colors.green}✓ Fetched ${emails.length} emails from inbox${colors.reset}\n`);

    if (emails.length === 0) {
      console.log(`${colors.yellow}⚠ No new emails found to process${colors.reset}\n`);
      return;
    }

    // Step 3: Filter to get only new unprocessed emails
    console.log(`${colors.cyan}Step 3: Filtering out already-processed emails...${colors.reset}`);

    const newEmails = [];
    for (const email of emails) {
      const exists = await db.checkEmailExists(email.id);
      if (!exists) {
        newEmails.push(email);
      }
    }

    console.log(`${colors.green}✓ Found ${newEmails.length} NEW unprocessed emails${colors.reset}`);
    console.log(`  (${emails.length - newEmails.length} already processed, skipped)\n`);

    if (newEmails.length === 0) {
      console.log(`${colors.yellow}⚠ All fetched emails have already been processed${colors.reset}\n`);
      return;
    }

    // Limit to 20 for testing
    const emailsToProcess = newEmails.slice(0, 20);
    console.log(`${colors.cyan}Will process ${emailsToProcess.length} emails (limited to 20 for testing)${colors.reset}\n`);

    // Step 4: Preview emails before processing
    console.log(`${colors.bright}${colors.cyan}EMAIL PREVIEW:${colors.reset}\n`);
    emailsToProcess.forEach((email, idx) => {
      const sender = email.from?.emailAddress?.address || 'Unknown';
      const senderDomain = sender.includes('@') ? sender.split('@')[1] : 'Unknown';
      const isInternal = senderDomain === 'seahorseexpress.com';

      console.log(`${idx + 1}. ${email.subject?.substring(0, 60) || 'No subject'}...`);
      console.log(`   From: ${email.from?.emailAddress?.name || 'Unknown'} <${sender}>`);
      console.log(`   Date: ${email.receivedDateTime}`);
      console.log(`   ${isInternal ? colors.red + '⚠ INTERNAL (should be filtered)' + colors.reset : colors.green + '✓ External client email' + colors.reset}`);
      console.log('');
    });

    // Step 5: Process emails
    console.log(`\n${colors.bright}${colors.cyan}========================================`);
    console.log('🤖 PROCESSING EMAILS WITH AI');
    console.log(`========================================${colors.reset}\n`);

    const result = await emailExtractor.processEmails({
      searchQuery: 'quote OR shipping OR freight OR cargo',
      maxEmails: emailsToProcess.length,
      scoreThreshold: 30,
      previewMode: false,
      // Pass the emails directly to avoid re-fetching
      emailsToProcess: emailsToProcess,
    });

    // Display results
    console.log(`\n${colors.bright}${colors.cyan}========================================`);
    console.log('📊 PROCESSING RESULTS');
    console.log(`========================================${colors.reset}\n`);

    console.log(`Total Fetched:         ${result.fetched || emailsToProcess.length}`);
    console.log(`Passed Pre-filter:     ${colors.green}${result.passed_filter || 0}${colors.reset}`);
    console.log(`Failed Pre-filter:     ${colors.yellow}${result.failed_filter || 0}${colors.reset}`);
    console.log(`Successfully Parsed:   ${colors.green}${result.success || 0}${colors.reset}`);
    console.log(`Failed to Parse:       ${colors.red}${result.failed || 0}${colors.reset}`);
    console.log(`Total Quotes Saved:    ${colors.bright}${result.total_quotes || 0}${colors.reset}`);

    if (result.average_confidence !== undefined) {
      const confidenceColor = result.average_confidence >= 0.8 ? colors.green :
                              result.average_confidence >= 0.5 ? colors.yellow : colors.red;
      console.log(`Average Confidence:    ${confidenceColor}${(result.average_confidence * 100).toFixed(0)}%${colors.reset}`);
    }

    // Step 6: Show filter details
    if (result.filter_details) {
      console.log(`\n${colors.bright}FILTER BREAKDOWN:${colors.reset}`);
      console.log(`Internal Seahorse emails excluded: ${result.filter_details.internal_excluded || 0}`);
      console.log(`Spam/automated excluded: ${result.filter_details.spam_excluded || 0}`);
      console.log(`Low relevance score: ${result.filter_details.low_score || 0}`);
    }

    console.log(`\n${colors.green}✓ Processing complete!${colors.reset}\n`);
    console.log(`${colors.cyan}Next step: Run 'node analyze_quotes.js' to see accuracy analysis${colors.reset}\n`);

  } catch (error) {
    console.error(`${colors.red}✗ Error:${colors.reset}`, error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

// Run the script
fetchAndProcessNewEmails().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
