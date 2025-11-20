/**
 * Test processNewEntries Endpoint
 * Verifies incremental email processing functionality
 */

import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';

async function testProcessNewEntries() {
  console.log('\n' + '='.repeat(60));
  console.log('TESTING processNewEntries ENDPOINT');
  console.log('='.repeat(60) + '\n');

  try {
    // Call the processNewEntries endpoint
    console.log('1️⃣  Calling /api/emails/processnewentries...');
    const response = await axios.post(`${API_BASE}/emails/processnewentries`);

    if (!response.data.success) {
      console.error('❌ Request failed');
      console.error(response.data);
      return;
    }

    console.log('✅ Request successful!\n');
    console.log('Response:');
    console.log(JSON.stringify(response.data, null, 2));

    const jobId = response.data.jobId;
    const incrementalInfo = response.data.incrementalProcessing;

    console.log('\n2️⃣  Incremental Processing Info:');
    console.log(`   Start Date: ${incrementalInfo.startDate || 'None (processing all)'}`);
    console.log(`   Description: ${incrementalInfo.description}`);

    // Wait for job to complete
    console.log('\n3️⃣  Waiting for job to complete...');
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

    // Display job results
    console.log('4️⃣  Job Results:');
    if (jobStatus.result) {
      console.log(`   Emails fetched: ${jobStatus.result.fetched || 0}`);
      console.log(`   Emails to process: ${jobStatus.result.filtered?.toProcess || 0}`);
      console.log(`   Emails filtered out: ${jobStatus.result.filtered?.toSkip || 0}`);
      console.log(`   Successfully processed: ${jobStatus.result.processed?.successful || 0}`);
      console.log(`   Last received DateTime: ${jobStatus.result.lastReceivedDateTime || 'N/A'}`);
    }

    // Test calling it again to verify incremental processing
    console.log('\n5️⃣  Testing incremental processing - calling again...');
    const response2 = await axios.post(`${API_BASE}/emails/processnewentries`);

    if (response2.data.success) {
      console.log('✅ Second request successful!');
      console.log(`   Start Date: ${response2.data.incrementalProcessing.startDate}`);
      console.log(`   Description: ${response2.data.incrementalProcessing.description}`);

      if (response2.data.incrementalProcessing.startDate) {
        console.log('✅ Incremental processing is working! Using previous lastReceivedDateTime.');
      } else {
        console.log('⚠️  No startDate found - either no previous job completed or column is null');
      }
    }

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
testProcessNewEntries();
