# Process New Entries Endpoint

## Overview

The `/api/emails/processnewentries` endpoint provides automated incremental email processing by automatically fetching emails received after the last successful processing job.

## Endpoint

```
POST /api/emails/processnewentries
```

## Features

- ✅ **Zero Configuration**: No request body required
- ✅ **Automatic Incremental Processing**: Uses `lastReceivedDateTime` from the most recent completed job
- ✅ **Large Batch Processing**: Processes up to 1000 emails per job
- ✅ **Smart Filtering**: Uses the standard filtering threshold (30)
- ✅ **Asynchronous Execution**: Returns immediately with job ID

## How It Works

1. **Queries Database**: Retrieves the `last_received_datetime` from the most recent completed job
2. **Builds Request**: Creates a job with optimized parameters:
   - `searchQuery`: Empty (fetches all emails)
   - `maxEmails`: 1000
   - `startDate`: Last received datetime from previous job (or null if no previous job)
   - `scoreThreshold`: 30
   - `previewMode`: false
   - `async`: true (always async)
3. **Creates Job**: Starts background processing
4. **Returns Status URL**: Provides endpoint to check job progress

## Request

### Headers

```
Content-Type: application/json
```

### Body

No request body required. The endpoint automatically configures all parameters.

## Response

### Success (202 Accepted)

```json
{
  "success": true,
  "message": "Job accepted for processing new entries",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "statusUrl": "http://localhost:3000/api/jobs/550e8400-e29b-41d4-a716-446655440000",
  "statusCheckInterval": "5-10 seconds recommended",
  "incrementalProcessing": {
    "startDate": "2025-11-19T14:28:24.000Z",
    "description": "Processing emails received after 2025-11-19T14:28:24.000Z"
  }
}
```

### First Run (No Previous Job)

```json
{
  "success": true,
  "message": "Job accepted for processing new entries",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "statusUrl": "http://localhost:3000/api/jobs/550e8400-e29b-41d4-a716-446655440000",
  "statusCheckInterval": "5-10 seconds recommended",
  "incrementalProcessing": {
    "startDate": null,
    "description": "Processing all emails (no previous job found)"
  }
}
```

### Error (500 Internal Server Error)

```json
{
  "success": false,
  "error": "Error message here"
}
```

## Usage Examples

### Using cURL

```bash
curl -X POST http://localhost:3000/api/emails/processnewentries \
  -H "Content-Type: application/json"
```

### Using JavaScript (axios)

```javascript
import axios from 'axios';

const response = await axios.post('http://localhost:3000/api/emails/processnewentries');
const { jobId, statusUrl, incrementalProcessing } = response.data;

console.log(`Job created: ${jobId}`);
console.log(`Processing emails after: ${incrementalProcessing.startDate}`);

// Check job status
const status = await axios.get(statusUrl);
console.log(status.data);
```

### Using Postman

1. Create a new POST request
2. URL: `http://localhost:3000/api/emails/processnewentries`
3. Headers: `Content-Type: application/json`
4. Body: Leave empty or set to `{}`
5. Send request
6. Copy the `statusUrl` from response
7. Create a GET request to check job status

## Monitoring Job Progress

After starting a job, use the status endpoint:

```bash
GET /api/jobs/{jobId}
```

The response includes:

- Current status (pending, processing, completed, failed)
- Progress information
- Processing results
- The new `lastReceivedDateTime` for the next incremental run

## Use Cases

### Scheduled Incremental Processing

Set up a cron job or scheduler to call this endpoint regularly:

```bash
# Every hour
0 * * * * curl -X POST http://localhost:3000/api/emails/processnewentries

# Every 6 hours
0 */6 * * * curl -X POST http://localhost:3000/api/emails/processnewentries

# Every day at 2 AM
0 2 * * * curl -X POST http://localhost:3000/api/emails/processnewentries
```

### Workflow Automation

```javascript
// Process new entries daily
async function dailyEmailProcessing() {
  try {
    const response = await axios.post('http://localhost:3000/api/emails/processnewentries');

    console.log('Daily processing started:', response.data.jobId);

    // Optional: Wait for completion and send notification
    const jobId = response.data.jobId;
    let completed = false;

    while (!completed) {
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

      const status = await axios.get(`http://localhost:3000/api/jobs/${jobId}`);

      if (status.data.status === 'completed') {
        completed = true;
        console.log('Processing completed!');
        console.log(`Processed: ${status.data.result.processed.successful} emails`);

        // Send notification, update dashboard, etc.
      }
    }
  } catch (error) {
    console.error('Daily processing failed:', error.message);
  }
}

// Schedule to run daily
setInterval(dailyEmailProcessing, 24 * 60 * 60 * 1000);
```

## Benefits

1. **No Manual Configuration**: Automatically determines the correct start date
2. **Prevents Duplicate Processing**: Only processes emails received since last job
3. **Efficient Resource Usage**: Processes only new emails, not the entire inbox
4. **Simple Integration**: Single endpoint call with no parameters
5. **Scalable**: Handles up to 1000 emails per job

## Rate Limiting

This endpoint uses the same rate limiter as `/api/emails/process`:

- 1 request per minute per IP address

## Related Endpoints

- `POST /api/emails/process` - Process emails with custom parameters
- `GET /api/jobs/{jobId}` - Check job status
- `GET /api/jobs` - List all jobs
- `GET /api/jobs/statistics` - Get processing statistics

## Database Schema

The endpoint relies on the `last_received_datetime` column in the `processing_jobs` table:

```sql
ALTER TABLE processing_jobs
ADD COLUMN IF NOT EXISTS last_received_datetime TIMESTAMP;
```

Run the migration:

```bash
node migrations/setup_database.js
```

## Testing

Test the endpoint:

```bash
node tests/test_process_new_entries.js
```

## Troubleshooting

### No emails are processed

- Check that emails exist in the mailbox after the `startDate`
- Verify the `scoreThreshold` (30) is appropriate for your emails
- Check the filter criteria in the email filter service

### Always processes all emails

- Ensure previous jobs completed successfully (status = 'completed')
- Verify `last_received_datetime` column exists in database
- Check that `lastReceivedDateTime` is being saved correctly in completed jobs

### Rate limit errors

- Wait 60 seconds between requests
- Check the rate limiter middleware configuration

## Notes

- First run will process all emails (no previous startDate)
- Subsequent runs will only process emails received after the last job's `lastReceivedDateTime`
- Failed jobs are excluded from the lastReceivedDateTime lookup
- Only completed jobs with non-null `last_received_datetime` are considered
