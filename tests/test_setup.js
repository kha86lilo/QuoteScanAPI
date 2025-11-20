/**
 * Test Setup Script
 * Tests database connection, Microsoft Graph API, and Claude API
 */

import * as db from '../src/config/db.js';
import microsoftGraphService from '../src/services/microsoftGraphService.js';
import claudeService from '../src/services/ai/claudeService.js';
import geminiService from '../src/services/ai/geminiService.js';

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('TESTING SHIPPING QUOTE EMAIL EXTRACTOR API');
  console.log('='.repeat(60) + '\n');

  let allPassed = true;

  // Test 1: Database Connection
  console.log('Test 1: Database Connection');
  console.log('-'.repeat(60));
  try {
    const result = await db.pool.query('SELECT NOW() as current_time, version() as version');
    console.log('✓ Database connection successful');
    console.log(`  Current time: ${result.rows[0].current_time}`);
    console.log(`  PostgreSQL version: ${result.rows[0].version.split(',')[0]}`);
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    allPassed = false;
  }

  console.log();

  // Test 2: Microsoft Graph API
  console.log('Test 2: Microsoft Graph API Connection');
  console.log('-'.repeat(60));
  try {
    const token = await microsoftGraphService.getAccessToken();
    if (token) {
      console.log('✓ Microsoft Graph API authentication successful');
      console.log(`  Token received (first 20 chars): ${token.substring(0, 20)}...`);
    } else {
      console.error('✗ Failed to get access token');
      allPassed = false;
    }
  } catch (error) {
    console.error('✗ Microsoft Graph API connection failed:', error.message);
    allPassed = false;
  }

  console.log();

  // Test 3: Claude API
  console.log('Test 3: Claude API Connection');
  console.log('-'.repeat(60));
  try {
    const isValid = await claudeService.validateApiKey();
    if (isValid) {
      console.log('✓ Claude API connection successful');
      console.log('  API key is valid');
    } else {
      console.error('✗ Claude API validation failed');
      allPassed = false;
    }
  } catch (error) {
    console.error('✗ Claude API connection failed:', error.message);
    allPassed = false;
  }

  console.log();

  // Test 4: Check Database Schema
  console.log('Test 4: Database Schema Check');
  console.log('-'.repeat(60));
  try {
    const result = await db.pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'shipping_quotes'
    `);

    if (result.rows.length > 0) {
      console.log('✓ shipping_quotes table exists');

      // Count records
      const countResult = await db.pool.query('SELECT COUNT(*) FROM shipping_quotes');
      console.log(`  Total quotes in database: ${countResult.rows[0].count}`);
    } else {
      console.error('✗ shipping_quotes table does not exist');
      console.log('  Please run the SQL schema creation script');
      allPassed = false;
    }
  } catch (error) {
    console.error('✗ Database schema check failed:', error.message);
    allPassed = false;
  }

  console.log();

  // Test 5: Fetch Sample Emails (optional)
  console.log('Test 5: Fetch Sample Emails (Optional)');
  console.log('-'.repeat(60));
  try {
    const emails = await microsoftGraphService.fetchEmails({
      searchQuery: 'quote OR shipping',
      top: 3,
    });

    if (emails && emails.length > 0) {
      console.log(`✓ Successfully fetched ${emails.length} sample email(s)`);
      emails.forEach((email, i) => {
        console.log(`  ${i + 1}. ${email.subject || 'No Subject'}`);
      });
    } else {
      console.log('⚠ No emails found (this is okay for testing)');
    }
  } catch (error) {
    console.log('⚠ Could not fetch sample emails:', error.message);
    console.log('  (This is not critical - other tests passed)');
  }

  // Test 6: Gemini API
  console.log('Test 6: Gemini API Connection');
  console.log('-'.repeat(60));
  try {
    const isValid = await geminiService.validateApiKey();
    if (isValid) {
      console.log('✓ Gemini API connection successful');
      console.log('  API key is valid');
    } else {
      console.error('✗ Gemini API validation failed');
      allPassed = false;
    }
  } catch (error) {
    console.error('✗ Gemini API connection failed:', error.message);
    allPassed = false;
  }
  console.log();

  // Summary
  console.log();
  console.log('='.repeat(60));
  if (allPassed) {
    console.log('✓ ALL TESTS PASSED');
    console.log('Your API is ready to use!');
  } else {
    console.log('✗ SOME TESTS FAILED');
    console.log('Please check the error messages above and fix the issues.');
  }
  console.log('='.repeat(60) + '\n');

  // Close database connection
  await db.pool.end();
  process.exit(allPassed ? 0 : 1);
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error during testing:', error);
  process.exit(1);
});
