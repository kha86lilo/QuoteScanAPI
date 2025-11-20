# Tests

This folder contains test scripts for the Shipping Quote Email Extractor API.

## Available Tests

### `test_setup.js`

Tests the initial setup and configuration of the application:

- Database connection
- Microsoft Graph API authentication
- AI service connectivity (Claude/Gemini/ChatGPT)

**Run:**

```bash
node tests/test_setup.js
```

### `test_summary_feature.js`

Tests the summary storage feature:

- Job statistics endpoint
- Job creation with summary data
- Summary data persistence
- Get all jobs with summaries

**Run:**

```bash
node tests/test_summary_feature.js
```

### `test_last_received_datetime.js`

Tests the lastReceivedDateTime tracking feature:

- Email processing job creation
- Verification of lastReceivedDateTime in job status
- Verification of lastReceivedDateTime in result and summary
- Maximum receivedDateTime calculation from processed emails

**Run:**

```bash
node tests/test_last_received_datetime.js
```

### `test_process_new_entries.js`

Tests the incremental email processing endpoint:

- Calls `/api/emails/processnewentries` endpoint
- Verifies automatic retrieval of lastReceivedDateTime
- Tests incremental processing by calling twice
- Validates startDate is used from previous job

**Run:**

```bash
node tests/test_process_new_entries.js
```

### `verify_column.js`

Database utility script to verify column existence:

- Checks for last_received_datetime column
- Lists all processing_jobs table columns
- Displays column data types

**Run:**

```bash
node tests/verify_column.js
```

## Running Tests

From the project root:

```bash
# Run individual test
node tests/test_setup.js

# Run summary feature test
node tests/test_summary_feature.js
```

## Prerequisites

- Application must be running (for API tests)
- Environment variables configured in `.env`
- Database tables created

## Test Coverage

- ✅ Database connectivity
- ✅ API endpoints
- ✅ Job processing and status tracking
- ✅ Summary data storage and retrieval
- ✅ Statistics aggregation
