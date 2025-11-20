/**
 * Test Global Error Handling
 * Tests various error scenarios to ensure proper error handling
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api';

// Helper to make requests and display results
async function testEndpoint(name, method, url, data = null) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing: ${name}`);
  console.log(`${method} ${url}`);
  console.log('='.repeat(70));

  try {
    const config = { method, url: `${BASE_URL}${url}` };
    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    console.log('✓ Status:', response.status);
    console.log('✓ Response:', JSON.stringify(response.data, null, 2));
    return { success: true, data: response.data };
  } catch (error) {
    if (error.response) {
      console.log('✗ Status:', error.response.status);
      console.log('✗ Error Response:', JSON.stringify(error.response.data, null, 2));
      return { success: false, status: error.response.status, data: error.response.data };
    } else {
      console.log('✗ Error:', error.message);
      return { success: false, error: error.message };
    }
  }
}

async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('GLOBAL ERROR HANDLING TESTS');
  console.log('='.repeat(70));

  // Test 1: Valid endpoint (should succeed)
  await testEndpoint('Health Check (Valid)', 'GET', '/health');

  // Test 2: 404 - Not Found
  await testEndpoint('Non-existent Endpoint (404)', 'GET', '/this-does-not-exist');

  // Test 3: Not Found - Job ID
  await testEndpoint('Non-existent Job (404)', 'GET', '/jobs/non-existent-job-id');

  // Test 4: Not Found - Quote ID
  await testEndpoint('Non-existent Quote (404)', 'GET', '/quotes/99999999');

  // Test 5: Validation Error - Missing required field
  await testEndpoint('Parse Email without data (400)', 'POST', '/emails/parse', {});

  // Test 6: Validation Error - Cannot cancel completed job
  // First, get a completed job if any exist
  const jobsResult = await testEndpoint('Get All Jobs', 'GET', '/jobs?status=completed&limit=1');

  if (jobsResult.success && jobsResult.data.jobs && jobsResult.data.jobs.length > 0) {
    const completedJobId = jobsResult.data.jobs[0].jobId;
    await testEndpoint('Cancel Completed Job (400)', 'DELETE', `/jobs/${completedJobId}`);
  } else {
    console.log('\n⚠ Skipping completed job cancellation test (no completed jobs found)');
  }

  // Test 7: Validation Error - Job result for non-completed job
  const allJobsResult = await testEndpoint('Get All Jobs (Any Status)', 'GET', '/jobs?limit=1');

  if (allJobsResult.success && allJobsResult.data.jobs && allJobsResult.data.jobs.length > 0) {
    const job = allJobsResult.data.jobs[0];
    if (job.status !== 'completed') {
      await testEndpoint(
        'Get Result of Non-Completed Job (400)',
        'GET',
        `/jobs/${job.jobId}/result`
      );
    } else {
      console.log('\n⚠ First job is completed, cannot test non-completed job result error');
    }
  }

  // Test 8: Test successful quote retrieval
  const quotesResult = await testEndpoint('Get All Quotes', 'GET', '/quotes?limit=5');

  // Test 9: Search quotes with filters
  await testEndpoint('Search Quotes', 'POST', '/quotes/search', {
    clientCompanyName: 'Test',
    startDate: '2024-01-01',
  });

  console.log('\n' + '='.repeat(70));
  console.log('TESTS COMPLETED');
  console.log('='.repeat(70));
  console.log('\nSummary:');
  console.log('- Check that 404 errors return proper NotFoundError responses');
  console.log('- Check that 400 errors return proper ValidationError responses');
  console.log('- Check that successful requests return 200 with success: true');
  console.log('- Check that error messages are clear and descriptive');
  console.log('- In development mode, stack traces should be included');
  console.log('\n');
}

// Run all tests
runTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
