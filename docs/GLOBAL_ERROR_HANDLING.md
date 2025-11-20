# Global Error Handling

This document describes the comprehensive global error handling system implemented in the Shipping Quote Email Extractor API.

## Overview

The application now features a centralized error handling system that provides:

- **Consistent error responses** across all endpoints
- **Custom error classes** for different error types
- **Automatic async error catching** with middleware wrapper
- **Detailed logging** for debugging and monitoring
- **Environment-aware responses** (more details in development, sanitized in production)
- **Proper HTTP status codes** for different error scenarios

## Architecture

### 1. Error Handler Middleware (`src/middleware/errorHandler.js`)

The error handling system consists of several components:

#### Custom Error Classes

**Base Error Class:**

- `AppError` - Base class for all operational errors

**Specific Error Types:**

- `ValidationError` (400) - Invalid input or business rule violations
- `NotFoundError` (404) - Resource not found
- `UnauthorizedError` (401) - Authentication required
- `ForbiddenError` (403) - Insufficient permissions
- `ConflictError` (409) - Resource conflicts (e.g., duplicates)
- `RateLimitError` (429) - Too many requests
- `ExternalServiceError` (502) - Third-party service failures
- `DatabaseError` (500) - Database operation failures

#### AsyncHandler Wrapper

```javascript
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

This wrapper eliminates the need for try-catch blocks in async route handlers. Simply wrap your controller functions:

```javascript
export const getQuotes = asyncHandler(async (req, res) => {
  const quotes = await db.query('SELECT * FROM quotes');
  res.json({ success: true, quotes });
});
```

### 2. Error Response Format

#### Development Mode Response

```json
{
  "success": false,
  "status": "fail",
  "message": "Quote with ID: 99999999 not found",
  "error": "NotFoundError",
  "stack": "NotFoundError: Quote with ID: 99999999 not found\n    at file:///...",
  "request": {
    "method": "GET",
    "url": "/api/quotes/99999999",
    "ip": "::1"
  }
}
```

#### Production Mode Response

```json
{
  "success": false,
  "status": "fail",
  "message": "Quote with ID: 99999999 not found",
  "error": "NotFoundError"
}
```

### 3. HTTP Status Codes

| Status Code | Error Type               | Description                         |
| ----------- | ------------------------ | ----------------------------------- |
| 400         | ValidationError          | Invalid input or request parameters |
| 401         | UnauthorizedError        | Authentication required             |
| 403         | ForbiddenError           | Access denied                       |
| 404         | NotFoundError            | Resource not found                  |
| 409         | ConflictError            | Resource conflict (duplicate, etc.) |
| 429         | RateLimitError           | Rate limit exceeded                 |
| 500         | AppError / DatabaseError | Internal server error               |
| 502         | ExternalServiceError     | External service failure            |

## Usage Examples

### Controller Examples

#### Using Custom Error Classes

```javascript
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

// Example 1: Not Found
export const getJobById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await jobProcessor.getJob(id);

  if (!job) {
    throw new NotFoundError(`Job with ID: ${id}`);
  }

  res.json({ success: true, job });
});

// Example 2: Validation Error
export const parseEmail = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ValidationError('Email object is required');
  }

  const parsed = await parseService.parse(email);
  res.json({ success: true, data: parsed });
});

// Example 3: Database Error with Try-Catch
export const getAllQuotes = asyncHandler(async (req, res) => {
  try {
    const quotes = await db.query('SELECT * FROM quotes');
    res.json({ success: true, quotes });
  } catch (error) {
    throw new DatabaseError('fetching quotes', error);
  }
});

// Example 4: External Service Error
export const testGraphConnection = asyncHandler(async (req, res) => {
  try {
    const token = await microsoftGraphService.getAccessToken();
    res.json({ success: true, tokenReceived: !!token });
  } catch (error) {
    throw new ExternalServiceError('Microsoft Graph API', error);
  }
});
```

### Error Handling Features

#### 1. Automatic PostgreSQL Error Handling

The error handler automatically converts PostgreSQL errors:

- `23505` → `ConflictError` (Duplicate entry)
- `23503` → `ValidationError` (Foreign key violation)
- `23502` → `ValidationError` (NOT NULL violation)

#### 2. Automatic HTTP Error Handling

Axios/HTTP errors are automatically converted to `ExternalServiceError`.

#### 3. JWT Error Handling

JWT-related errors are converted to `UnauthorizedError`:

- `JsonWebTokenError` → Invalid token
- `TokenExpiredError` → Token expired

## Server Setup

The error handling is configured in `src/server.js`:

```javascript
import {
  errorHandler,
  notFoundHandler,
  handleUncaughtException,
  handleUnhandledRejection,
} from './middleware/errorHandler.js';

// Handle process-level errors
handleUncaughtException();
handleUnhandledRejection();

// ... middleware setup ...

// 404 handler - must be before error handler
app.use(notFoundHandler);

// Global error handler - must be last
app.use(errorHandler);
```

## Error Logging

All errors are logged with comprehensive details:

```
================================================================================
[2025-11-20T12:13:43.329Z] ERROR OCCURRED
================================================================================
Request: {
  method: 'GET',
  url: '/api/quotes/99999999',
  ip: '::1',
  userAgent: 'curl/7.68.0'
}
Error: {
  name: 'NotFoundError',
  message: 'Quote with ID: 99999999 not found',
  statusCode: 404,
  isOperational: true
}
Stack: NotFoundError: Quote with ID: 99999999 not found
    at file:///D:/chipa/src/controllers/quote.controller.js:55:13
    ...
================================================================================
```

## Process-Level Error Handling

### Uncaught Exceptions

```javascript
handleUncaughtException();
```

Catches any unhandled synchronous errors and logs them before shutting down gracefully.

### Unhandled Promise Rejections

```javascript
handleUnhandledRejection();
```

Catches any unhandled promise rejections and logs them before shutting down gracefully.

## Best Practices

### 1. Always Use asyncHandler

Wrap all async controller functions with `asyncHandler`:

```javascript
// ✅ Good
export const getQuotes = asyncHandler(async (req, res) => {
  // Your code here
});

// ❌ Bad
export const getQuotes = async (req, res) => {
  try {
    // Your code here
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

### 2. Throw Appropriate Error Types

Use specific error classes instead of generic errors:

```javascript
// ✅ Good
throw new NotFoundError(`User with ID: ${id}`);

// ❌ Bad
throw new Error('Not found');
```

### 3. Provide Context in Error Messages

Include relevant information in error messages:

```javascript
// ✅ Good
throw new NotFoundError(`Quote with ID: ${id}`);
throw new ValidationError('Email object is required');
throw new DatabaseError('fetching quotes', error);

// ❌ Bad
throw new NotFoundError('Not found');
throw new ValidationError('Invalid input');
```

### 4. Let Database Errors Propagate When Appropriate

For expected database errors (like NOT FOUND), handle them explicitly:

```javascript
try {
  const result = await db.query('SELECT * FROM quotes WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    throw new NotFoundError(`Quote with ID: ${id}`);
  }

  return result.rows[0];
} catch (error) {
  if (error instanceof NotFoundError) throw error;
  throw new DatabaseError('fetching quote', error);
}
```

## Testing Error Handling

Run the error handling test suite:

```bash
node tests/test_error_handling.js
```

This tests:

- Valid endpoint responses (200)
- 404 Not Found errors
- 400 Validation errors
- Database errors
- Error message clarity
- Stack traces in development mode

## Migration Guide

### Before (Old Code)

```javascript
export const getQuote = async (req, res) => {
  try {
    const { id } = req.params;
    const quote = await db.query('SELECT * FROM quotes WHERE id = $1', [id]);

    if (!quote) {
      return res.status(404).json({
        success: false,
        error: 'Quote not found',
      });
    }

    res.json({ success: true, quote });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
```

### After (New Code)

```javascript
import { asyncHandler, NotFoundError, DatabaseError } from '../middleware/errorHandler.js';

export const getQuote = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query('SELECT * FROM quotes WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new NotFoundError(`Quote with ID: ${id}`);
    }

    res.json({ success: true, quote: result.rows[0] });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new DatabaseError('fetching quote', error);
  }
});
```

## Summary of Changes

1. ✅ Created `src/middleware/errorHandler.js` with:
   - Custom error classes
   - `asyncHandler` wrapper
   - Global error handler
   - 404 handler
   - Process-level error handlers

2. ✅ Updated `src/server.js`:
   - Added error handling imports
   - Configured process-level handlers
   - Replaced old error middleware with new handlers

3. ✅ Updated all controllers:
   - `src/controllers/email.controller.js`
   - `src/controllers/job.controller.js`
   - `src/controllers/quote.controller.js`
   - `src/controllers/health.controller.js`
   - All wrapped with `asyncHandler`
   - All using custom error classes

4. ✅ Created test suite:
   - `tests/test_error_handling.js`

5. ✅ Bug fixes:
   - Fixed quote ID column name (`quote_id` vs `id`)

## Benefits

- **Consistency**: All errors follow the same format
- **Developer Experience**: No more repetitive try-catch blocks
- **Debugging**: Comprehensive logging and stack traces in development
- **Security**: Sanitized error responses in production
- **Maintainability**: Centralized error handling logic
- **Type Safety**: Specific error classes for different scenarios
- **Monitoring**: Structured logs for error tracking systems
