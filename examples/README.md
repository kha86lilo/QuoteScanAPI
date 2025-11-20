# Examples

This folder contains example clients and configuration files for the Shipping Quote Email Extractor API.

## Client Examples

### `example_client.js`
Synchronous client demonstrating basic API usage:
- Processing emails synchronously
- Previewing emails before processing
- Fetching quotes from database

**Run:**
```bash
node examples/example_client.js
```

### `example_async_client.js`
Asynchronous client demonstrating job-based processing:
- Creating background jobs
- Polling job status
- Retrieving job results
- Error handling

**Run:**
```bash
node examples/example_async_client.js
```

## Postman Collection

### `Shipping_Quote_Extractor_API.postman_collection.json`
Complete Postman collection with all API endpoints:
- Email processing endpoints
- Job management
- Quote retrieval
- Health checks
- Test endpoints

**Import into Postman:**
1. Open Postman
2. Click "Import"
3. Select this file
4. Configure environment variables

### `Postman_Environment_Local.json`
Environment configuration for local development:
- API base URL
- Authentication tokens
- Test data

**Setup:**
1. Import into Postman
2. Update variables with your credentials
3. Set as active environment

## Usage

### Basic Email Processing

```javascript
import axios from 'axios';

const response = await axios.post('http://localhost:3000/api/emails/process', {
  searchQuery: 'quote OR shipping',
  maxEmails: 50,
  scoreThreshold: 30,
  async: true
});

console.log('Job ID:', response.data.jobId);
```

### Check Job Status

```javascript
const status = await axios.get(`http://localhost:3000/api/jobs/${jobId}`);
console.log('Status:', status.data.status);
console.log('Summary:', status.data.summary);
```

## Prerequisites

- Node.js installed
- Application running on `http://localhost:3000`
- Valid `.env` configuration
- Postman (for collection)

## Support

For more details, see the main project README.
