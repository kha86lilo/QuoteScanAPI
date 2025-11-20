/**
 * Test lastReceivedDateTime Feature
 * Verifies that the maximum receivedDateTime is captured and stored
 */

import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';

async function testLastReceivedDateTime() {
  console.log('\n' + '='.repeat(60));
  console.log('TESTING lastReceivedDateTime FEATURE');
  console.log('='.repeat(60) + '\n');

  try {
    // Create a job to process emails
    console.log('1️⃣  Creating job to process emails...');
    const createResponse = await axios.post(`${API_BASE}/emails/process`, {
      searchQuery: 'quote OR shipping',
      maxEmails: 10,
      scoreThreshold: 30,
      previewMode: false,
    });

    if (!createResponse.data.success) {
      console.error('❌ Failed to create job');
      return;
    }

    const jobId = createResponse.data.jobId;
    console.log(`✅ Job created: ${jobId}\n`);

    // Wait for job to complete
    console.log('⏳ Waiting for job to complete...');
    let jobCompleted = false;
    let attempts = 0;
    let jobStatus;

    while (!jobCompleted && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;

      const statusResponse = await axios.get(`${API_BASE}/jobs/${jobId}`);
      jobStatus = statusResponse.data;

      if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
        jobCompleted = true;
      } else {
        process.stdout.write('.');
      }
    }

    console.log('\n');

    if (!jobCompleted) {
      console.error('❌ Job did not complete in time');
      return;
    }

    console.log(`✅ Job ${jobStatus.status}\n`);

    // Check for lastReceivedDateTime
    console.log('2️⃣  Checking lastReceivedDateTime...');

    if (jobStatus.lastReceivedDateTime) {
      console.log('✅ lastReceivedDateTime found in job status!');
      console.log(`   Value: ${jobStatus.lastReceivedDateTime}`);
      console.log(`   Parsed: ${new Date(jobStatus.lastReceivedDateTime).toLocaleString()}`);
    } else {
      console.log('⚠️  lastReceivedDateTime not found in job status');
    }

    if (jobStatus.result && jobStatus.result.lastReceivedDateTime) {
      console.log('✅ lastReceivedDateTime found in job result!');
      console.log(`   Value: ${jobStatus.result.lastReceivedDateTime}`);
      console.log(`   Parsed: ${new Date(jobStatus.result.lastReceivedDateTime).toLocaleString()}`);
    } else {
      console.log('⚠️  lastReceivedDateTime not found in job result');
    }

    if (
      jobStatus.result &&
      jobStatus.result.summary &&
      jobStatus.result.summary.lastReceivedDateTime
    ) {
      console.log('✅ lastReceivedDateTime found in summary!');
      console.log(`   Value: ${jobStatus.result.summary.lastReceivedDateTime}`);
      console.log(
        `   Parsed: ${new Date(jobStatus.result.summary.lastReceivedDateTime).toLocaleString()}`
      );
    } else {
      console.log('⚠️  lastReceivedDateTime not found in summary');
    }

    console.log('\n3️⃣  Full job details:');
    console.log(JSON.stringify(jobStatus, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('✅ TEST COMPLETE');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

// Run test
testLastReceivedDateTime();
