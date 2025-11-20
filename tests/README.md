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
