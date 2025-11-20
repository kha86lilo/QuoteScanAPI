/**
 * Example Client Script
 * Demonstrates how to use the Shipping Quote Email Extractor API
 */

const axios = require('axios');

// Configuration
const API_BASE_URL = 'http://localhost:3000/api';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 300000, // 5 minutes timeout for long operations
});

/**
 * Example 1: Health Check
 */
async function checkHealth() {
  console.log('\n=== Example 1: Health Check ===');
  try {
    const response = await api.get('/health');
    console.log('Status:', response.data.status);
    console.log('Services:', response.data.services);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

/**
 * Example 2: Preview Emails
 */
async function previewEmails() {
  console.log('\n=== Example 2: Preview Emails ===');
  try {
    const response = await api.post('/emails/preview', {
      searchQuery: 'quote OR shipping OR freight',
      maxEmails: 10,
      scoreThreshold: 30,
    });

    const { preview } = response.data;
    console.log(`\nTotal emails: ${preview.summary.total}`);
    console.log(`To process: ${preview.summary.toProcess} (${preview.summary.processPercentage}%)`);
    console.log(`To skip: ${preview.summary.toSkip}`);
    console.log(`Estimated cost: $${preview.summary.estimatedCost.toFixed(2)}`);
    console.log(`Estimated savings: $${preview.summary.estimatedSavings.toFixed(2)}`);

    console.log('\nEmails to process:');
    preview.toProcess.slice(0, 3).forEach((email, i) => {
      console.log(`  ${i + 1}. [Score: ${email.score}] ${email.subject}`);
      console.log(`     From: ${email.from}`);
      console.log(`     Reason: ${email.reason}`);
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

/**
 * Example 3: Process Emails with Filtering
 */
async function processEmails() {
  console.log('\n=== Example 3: Process Emails with Filtering ===');
  try {
    const response = await api.post('/emails/process', {
      searchQuery: 'quote OR shipping',
      maxEmails: 5, // Start small for testing
      scoreThreshold: 30,
      previewMode: false,
    });

    const { results } = response.data;
    console.log(`\nFetched: ${results.fetched} emails`);
    console.log(`Passed filter: ${results.filtered.toProcess}`);
    console.log(`Filtered out: ${results.filtered.toSkip}`);
    console.log(`Successfully processed: ${results.processed.successful}`);
    console.log(`Already in DB: ${results.processed.skipped}`);
    console.log(`Failed: ${results.processed.failed}`);
    console.log(`Actual cost: $${(results.processed.successful * 0.015).toFixed(2)}`);

    if (results.errors && results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.forEach((err) => {
        console.log(`  - ${err.subject}: ${err.error}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

/**
 * Example 4: Get Processing Statistics
 */
async function getStats() {
  console.log('\n=== Example 4: Get Processing Statistics ===');
  try {
    const response = await api.get('/stats');
    const { stats } = response.data;

    console.log(`\nTotal emails processed: ${stats.total_emails}`);
    console.log(`Approved quotes: ${stats.approved_quotes}`);
    console.log(`Jobs won: ${stats.jobs_won}`);
    console.log(`Average confidence: ${parseFloat(stats.avg_confidence || 0).toFixed(2)}`);
    console.log(`Last processed: ${stats.last_processed || 'Never'}`);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

/**
 * Example 5: Get Recent Quotes
 */
async function getRecentQuotes() {
  console.log('\n=== Example 5: Get Recent Quotes ===');
  try {
    const response = await api.get('/quotes', {
      params: { limit: 5, offset: 0 },
    });

    const { quotes, pagination } = response.data;
    console.log(`\nShowing ${quotes.length} of ${pagination.total} quotes:\n`);

    quotes.forEach((quote, i) => {
      console.log(`${i + 1}. ${quote.client_company_name || 'Unknown Company'}`);
      console.log(`   Contact: ${quote.contact_person_name || 'N/A'}`);
      console.log(`   Status: ${quote.quote_status || 'N/A'}`);
      console.log(
        `   Origin: ${quote.origin_city || 'N/A'} → Destination: ${quote.destination_city || 'N/A'}`
      );
      console.log(`   Confidence: ${quote.ai_confidence_score || 0}`);
      console.log(`   Processed: ${new Date(quote.processed_at).toLocaleString()}`);
      console.log();
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

/**
 * Example 6: Search Quotes
 */
async function searchQuotes() {
  console.log('\n=== Example 6: Search Quotes ===');
  try {
    const response = await api.post('/quotes/search', {
      quoteStatus: 'Pending',
      // clientCompanyName: 'Acme',
      // startDate: '2024-01-01',
      // endDate: '2024-12-31'
    });

    const { quotes, count } = response.data;
    console.log(`\nFound ${count} pending quote(s):\n`);

    quotes.slice(0, 5).forEach((quote, i) => {
      console.log(`${i + 1}. ${quote.client_company_name || 'Unknown'}`);
      console.log(`   Email: ${quote.email_subject || 'N/A'}`);
      console.log(`   Amount: $${quote.initial_quote_amount || 'N/A'}`);
      console.log();
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

/**
 * Example 7: Test All Connections
 */
async function testConnections() {
  console.log('\n=== Example 7: Test All Connections ===');

  // Test Graph API
  try {
    const graphResponse = await api.get('/test/graph');
    console.log('Microsoft Graph API:', graphResponse.data.message);
  } catch (error) {
    console.error('Microsoft Graph API: Failed -', error.response?.data.error);
  }

  // Test Claude API
  try {
    const claudeResponse = await api.get('/test/claude');
    console.log('Claude API:', claudeResponse.data.message);
  } catch (error) {
    console.error('Claude API: Failed -', error.response?.data.error);
  }

  // Test Gemini API
  try {
    const geminiResponse = await api.get('/test/gemini');
    console.log('Gemini API:', geminiResponse.data.message);
  } catch (error) {
    console.error('Gemini API: Failed -', error.response?.data?.error || error.message);
  }

  // Test Database
  try {
    const dbResponse = await api.get('/test/database');
    console.log('Database:', dbResponse.data.message);
  } catch (error) {
    console.error('Database: Failed -', error.response?.data.error);
  }
}

/**
 * Example 8: Fetch Raw Emails
 */
async function fetchRawEmails() {
  console.log('\n=== Example 8: Fetch Raw Emails ===');
  try {
    const response = await api.post('/emails/fetch', {
      searchQuery: 'quote',
      maxEmails: 3,
    });

    const { emails, count } = response.data;
    console.log(`\nFetched ${count} email(s):\n`);

    emails.forEach((email, i) => {
      console.log(`${i + 1}. ${email.subject}`);
      console.log(
        `   From: ${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>`
      );
      console.log(`   Date: ${new Date(email.receivedDateTime).toLocaleString()}`);
      console.log(`   Has Attachments: ${email.hasAttachments ? 'Yes' : 'No'}`);
      console.log(`   Preview: ${email.bodyPreview?.substring(0, 100)}...`);
      console.log();
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

/**
 * Main function - Run all examples
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('SHIPPING QUOTE EMAIL EXTRACTOR API - CLIENT EXAMPLES');
  console.log('='.repeat(60));

  try {
    await checkHealth();
    await testConnections();
    await getStats();
    await previewEmails();
    await getRecentQuotes();
    await searchQuotes();

    // Uncomment to actually fetch and process emails:
    // await fetchRawEmails();
    // await processEmails();
  } catch (error) {
    console.error('\nFatal error:', error.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Examples completed!');
  console.log('='.repeat(60) + '\n');
}

// Run examples
if (require.main === module) {
  main();
}

module.exports = {
  api,
  checkHealth,
  previewEmails,
  processEmails,
  getStats,
  getRecentQuotes,
  searchQuotes,
  testConnections,
  fetchRawEmails,
};
