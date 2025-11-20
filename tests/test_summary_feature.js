/**
 * Test Script for Summary Storage Feature
 * Tests the new summary storage and job statistics functionality
 */

import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';

console.log('\n' + '='.repeat(60));
console.log('TESTING SUMMARY STORAGE FEATURE');
console.log('='.repeat(60) + '\n');

async function testJobStatistics() {
  try {
    console.log('1️⃣  Testing Job Statistics Endpoint...');

    const response = await axios.get(`${API_BASE}/jobs/statistics`);

    if (response.data.success) {
      console.log('✅ Statistics endpoint working!');
      console.log('\nStatistics:');
      console.log(JSON.stringify(response.data.statistics, null, 2));
    } else {
      console.log('❌ Statistics endpoint failed');
    }
  } catch (error) {
    if (error.response) {
      console.log('❌ Error:', error.response.data);
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

async function testJobCreationAndSummary() {
  try {
    console.log('\n2️⃣  Testing Job Creation with Summary...');

    // Create a test job with preview mode (won't actually process)
    const createResponse = await axios.post(`${API_BASE}/emails/process`, {
      searchQuery: 'test',
      maxEmails: 5,
      scoreThreshold: 30,
      previewMode: true,
      async: true,
    });

    if (createResponse.data.success) {
      const jobId = createResponse.data.jobId;
      console.log(`✅ Job created: ${jobId}`);

      // Wait a bit for processing
      console.log('⏳ Waiting 5 seconds for job to complete...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check job status
      console.log('\n3️⃣  Checking Job Status...');
      const statusResponse = await axios.get(`${API_BASE}/jobs/${jobId}`);

      if (statusResponse.data.success) {
        console.log('✅ Job status retrieved!');
        console.log(`\nStatus: ${statusResponse.data.status}`);

        if (statusResponse.data.summary) {
          console.log('\n✅ Summary data present!');
          console.log('\nSummary:');
          console.log(JSON.stringify(statusResponse.data.summary, null, 2));
        } else {
          console.log('\n⚠️  Summary data not yet available (job may still be processing)');
        }

        console.log('\nFull Response:');
        console.log(JSON.stringify(statusResponse.data, null, 2));
      }
    } else {
      console.log('❌ Job creation failed');
    }
  } catch (error) {
    if (error.response) {
      console.log('❌ Error:', error.response.data);
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

async function testAllJobs() {
  try {
    console.log('\n4️⃣  Testing Get All Jobs with Summary...');

    const response = await axios.get(`${API_BASE}/jobs?limit=5`);

    if (response.data.success) {
      console.log(`✅ Retrieved ${response.data.jobs.length} jobs`);

      const jobsWithSummary = response.data.jobs.filter((j) => j.summary);
      console.log(`📊 Jobs with summary: ${jobsWithSummary.length}`);

      if (jobsWithSummary.length > 0) {
        console.log('\nExample job with summary:');
        console.log(JSON.stringify(jobsWithSummary[0], null, 2));
      }
    } else {
      console.log('❌ Get all jobs failed');
    }
  } catch (error) {
    if (error.response) {
      console.log('❌ Error:', error.response.data);
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

async function runTests() {
  try {
    // Test 1: Statistics endpoint
    await testJobStatistics();

    // Test 2: Create job and check summary
    await testJobCreationAndSummary();

    // Test 3: Get all jobs with summary
    await testAllJobs();

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS COMPLETED');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('Test suite failed:', error);
  }
}

// Run tests
runTests();
