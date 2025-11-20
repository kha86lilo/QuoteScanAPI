/**
 * Example Client for Async Email Processing
 * Demonstrates how to use the new rate-limited async processing API
 */

import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000/api';

/**
 * Process emails asynchronously with status polling
 */
async function processEmailsAsync() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('ASYNC EMAIL PROCESSING EXAMPLE');
    console.log('='.repeat(60) + '\n');

    // Step 1: Submit processing job
    console.log('Step 1: Submitting email processing job...');
    const submitResponse = await axios.post(`${API_BASE_URL}/emails/process`, {
      searchQuery: 'quote OR shipping OR freight',
      maxEmails: 20,
      scoreThreshold: 30,
      previewMode: false,
      async: true, // Enable async processing
    });

    const { jobId, statusUrl, message } = submitResponse.data;
    console.log(`✓ ${message}`);
    console.log(`  Job ID: ${jobId}`);
    console.log(`  Status URL: ${statusUrl}`);
    console.log(`  Recommended polling interval: 5-10 seconds\n`);

    // Step 2: Poll for job status
    console.log('Step 2: Polling for job status...\n');
    let completed = false;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes maximum (5 sec intervals)

    while (!completed && attempts < maxAttempts) {
      attempts++;

      // Wait before polling
      await sleep(5000); // 5 seconds

      try {
        const statusResponse = await axios.get(`${API_BASE_URL}/jobs/${jobId}`);
        const status = statusResponse.data;

        // Display progress
        const progressBar = createProgressBar(status.progress.percentage);
        process.stdout.write(
          `\r[${progressBar}] ${status.progress.percentage}% - Status: ${status.status}`
        );

        if (status.status === 'completed') {
          console.log('\n\n✓ Job completed successfully!');
          console.log('\nResults:');
          console.log(`  Emails fetched: ${status.result.fetched}`);
          console.log(`  Passed filter: ${status.result.filtered.toProcess}`);
          console.log(`  Filtered out: ${status.result.filtered.toSkip}`);
          console.log(`  Successfully processed: ${status.result.processed.successful}`);
          console.log(`  Skipped (already in DB): ${status.result.processed.skipped}`);
          console.log(`  Failed: ${status.result.processed.failed}`);
          console.log(`  Duration: ${status.duration}`);

          if (status.result.estimatedCost) {
            console.log(`\n  💰 Estimated cost: $${status.result.estimatedCost.toFixed(2)}`);
            console.log(`  💾 Money saved: $${status.result.estimatedSavings.toFixed(2)}`);
          }

          completed = true;
        } else if (status.status === 'failed') {
          console.log('\n\n✗ Job failed!');
          console.log('Error:', status.error);
          completed = true;
        }
      } catch (error) {
        if (error.response?.status === 404) {
          console.log('\n\n✗ Job not found. It may have been cleaned up.');
          completed = true;
        } else {
          console.error('\nError checking status:', error.message);
          // Continue polling despite errors
        }
      }
    }

    if (attempts >= maxAttempts) {
      console.log('\n\n⚠ Maximum polling attempts reached. Job may still be processing.');
    }

    console.log('\n' + '='.repeat(60) + '\n');
  } catch (error) {
    if (error.response?.status === 429) {
      console.error('\n✗ Rate limit exceeded!');
      console.error('  Error:', error.response.data.error);
      console.error('  Retry after:', error.response.data.retryAfter);
      console.error('  Reset time:', error.response.data.resetTime);
    } else {
      console.error('\n✗ Error:', error.message);
      if (error.response?.data) {
        console.error('  Details:', error.response.data);
      }
    }
  }
}

/**
 * Test rate limiting by submitting multiple requests
 */
async function testRateLimit() {
  console.log('\n' + '='.repeat(60));
  console.log('RATE LIMIT TEST');
  console.log('='.repeat(60) + '\n');

  console.log('Attempting to submit 3 jobs in quick succession...\n');

  for (let i = 1; i <= 3; i++) {
    try {
      console.log(`Attempt ${i}:`);
      const response = await axios.post(`${API_BASE_URL}/emails/process`, {
        searchQuery: 'test',
        maxEmails: 5,
        async: true,
      });
      console.log(`  ✓ Job accepted: ${response.data.jobId}\n`);
    } catch (error) {
      if (error.response?.status === 429) {
        console.log(`  ✗ Rate limited!`);
        console.log(`     Retry after: ${error.response.data.retryAfter}`);
        console.log(`     Reset time: ${error.response.data.resetTime}\n`);
      } else {
        console.log(`  ✗ Error: ${error.message}\n`);
      }
    }

    // Small delay between attempts
    await sleep(500);
  }

  console.log('='.repeat(60) + '\n');
}

/**
 * List all jobs
 */
async function listJobs() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('ALL JOBS');
    console.log('='.repeat(60) + '\n');

    const response = await axios.get(`${API_BASE_URL}/jobs?limit=10`);
    const { jobs, total } = response.data;

    console.log(`Total jobs: ${total}\n`);

    if (jobs.length === 0) {
      console.log('No jobs found.');
    } else {
      jobs.forEach((job, index) => {
        console.log(`${index + 1}. Job ID: ${job.jobId}`);
        console.log(`   Status: ${job.status}`);
        console.log(`   Created: ${new Date(job.createdAt).toLocaleString()}`);
        if (job.completedAt) {
          console.log(`   Completed: ${new Date(job.completedAt).toLocaleString()}`);
        }
        console.log(`   Progress: ${job.progress.percentage}%\n`);
      });
    }

    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('Error listing jobs:', error.message);
  }
}

/**
 * Get detailed job status
 */
async function getJobDetails(jobId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/jobs/${jobId}`);
    console.log('\nJob Details:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error getting job details:', error.message);
  }
}

/**
 * Helper: Create a progress bar
 */
function createProgressBar(percentage, width = 40) {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Helper: Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main execution
const command = process.argv[2];

switch (command) {
  case 'process':
    processEmailsAsync();
    break;
  case 'rate-limit':
    testRateLimit();
    break;
  case 'list':
    listJobs();
    break;
  case 'status':
    const jobId = process.argv[3];
    if (!jobId) {
      console.error('Please provide a job ID: node example_async_client.js status <jobId>');
    } else {
      getJobDetails(jobId);
    }
    break;
  default:
    console.log('Usage:');
    console.log('  node example_async_client.js process         - Process emails asynchronously');
    console.log('  node example_async_client.js rate-limit      - Test rate limiting');
    console.log('  node example_async_client.js list            - List all jobs');
    console.log('  node example_async_client.js status <jobId>  - Get job status');
}
