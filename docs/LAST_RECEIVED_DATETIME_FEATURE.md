# lastReceivedDateTime Feature Implementation

## Overview

Added tracking of the maximum `receivedDateTime` from emails processed in each job. This enables incremental email processing and helps avoid reprocessing the same emails.

## Changes Made

### 1. Database Schema

**File:** `migrations/alter_processing_jobs_add_last_received_datetime.sql`

- Added `last_received_datetime TIMESTAMP` column to `processing_jobs` table
- Added index for efficient querying: `idx_processing_jobs_last_received_datetime`
- Added column comment explaining its purpose

**Migration Command:**

```bash
node migrations/run_migration.js migrations/alter_processing_jobs_add_last_received_datetime.sql
```

### 2. Email Extractor Service

**File:** `src/services/emailExtractor.js`

**Changes:**

- Added `lastReceivedDateTime: null` to results object initialization
- Calculate maximum `receivedDateTime` from fetched emails:
  ```javascript
  if (emails.length > 0) {
    const maxReceivedDateTime = emails.reduce((max, email) => {
      const emailDate = new Date(email.receivedDateTime);
      return emailDate > max ? emailDate : max;
    }, new Date(0));
    results.lastReceivedDateTime = maxReceivedDateTime.toISOString();
  }
  ```
- Include `lastReceivedDateTime` in the summary object

### 3. Job Processor Service

**File:** `src/services/jobProcessor.js`

**Changes:**

- Added `lastReceivedDateTime: null` to job object initialization
- Extract `lastReceivedDateTime` from result when updating job:
  ```javascript
  if (updates.result && updates.result.lastReceivedDateTime) {
    job.lastReceivedDateTime = updates.result.lastReceivedDateTime;
  }
  ```
- Updated `saveJobToDatabase()` to include `last_received_datetime` column
- Updated `getJobFromDatabase()` to retrieve `last_received_datetime`
- Updated `updateJobInDatabase()` to update `last_received_datetime`

### 4. Database Setup Script

**File:** `migrations/setup_database.js`

- Added check for `last_received_datetime` column
- Automatically runs migration if column doesn't exist
- Idempotent - safe to run multiple times

### 5. Test Files

**Created:**

- `tests/test_last_received_datetime.js` - Tests the feature end-to-end
- `tests/verify_column.js` - Verifies database column exists

### 6. Documentation

**Updated:**

- `migrations/README.md` - Added documentation for new migration
- `tests/README.md` - Added documentation for new test files

## Usage

### Accessing lastReceivedDateTime

When retrieving job status via API:

```javascript
GET /api/jobs/{jobId}

Response:
{
  "jobId": "...",
  "status": "completed",
  "lastReceivedDateTime": "2025-11-19T14:28:24Z",
  "result": {
    "lastReceivedDateTime": "2025-11-19T14:28:24Z",
    "summary": {
      "lastReceivedDateTime": "2025-11-19T14:28:24Z",
      // ... other summary fields
    }
  }
}
```

### Incremental Processing

Use the `lastReceivedDateTime` from a previous job to process only newer emails:

```javascript
// Get last job's lastReceivedDateTime
const lastJob = await getLastCompletedJob();
const startDate = lastJob.lastReceivedDateTime;

// Process only emails received after that date
POST /api/emails/process
{
  "searchQuery": "quote OR shipping",
  "startDate": startDate, // ISO 8601 format
  "maxEmails": 50
}
```

## Benefits

1. **Incremental Processing**: Process only new emails since last run
2. **Avoid Duplicates**: Prevent reprocessing the same emails
3. **Audit Trail**: Track which emails were processed in each job
4. **Performance**: More efficient by filtering emails at the API level
5. **Cost Savings**: Reduce API calls and AI processing costs

## Testing

Run the test to verify the feature:

```bash
# Start the API server
npm start

# In another terminal, run the test
node tests/test_last_received_datetime.js
```

Expected output:

- Job created successfully
- Job completes
- `lastReceivedDateTime` appears in job status, result, and summary

## Database Verification

To verify the column exists:

```bash
node tests/verify_column.js
```

Or query directly:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'processing_jobs'
AND column_name = 'last_received_datetime';
```

## Future Enhancements

Potential improvements:

1. Add API endpoint to get last processed email date
2. Automatically use last job's date in subsequent runs
3. Add date range validation
4. Support multiple date ranges per job
5. Add statistics on date coverage

## Rollback

To remove the column (not recommended):

```sql
ALTER TABLE processing_jobs DROP COLUMN IF EXISTS last_received_datetime;
```

## Notes

- The `lastReceivedDateTime` is calculated from **all fetched emails**, not just processed ones
- If no emails are fetched, `lastReceivedDateTime` remains `null`
- The value is stored as an ISO 8601 timestamp string in the database
- The column is nullable to support existing records without migration data
