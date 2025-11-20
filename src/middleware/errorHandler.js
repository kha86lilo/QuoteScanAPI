/**
 * Global Error Handler Middleware
 * Centralized error handling for the API
 */

/**
 * Custom error class for application errors
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Custom error classes for specific error types
 */
export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource) {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service, originalError) {
    super(`External service error: ${service}`, 502);
    this.name = 'ExternalServiceError';
    this.service = service;
    this.originalError = originalError?.message || originalError;
  }
}

export class DatabaseError extends AppError {
  constructor(operation, originalError) {
    super(`Database error during ${operation}`, 500);
    this.name = 'DatabaseError';
    this.operation = operation;
    this.originalError = originalError?.message || originalError;
  }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Error response formatter
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @returns {Object} Formatted error response
 */
const formatErrorResponse = (err, req) => {
  const isProduction = process.env.NODE_ENV === 'production';

  const response = {
    success: false,
    status: err.status || 'error',
    message: err.message || 'Internal server error',
  };

  // Add error name for operational errors
  if (err.isOperational) {
    response.error = err.name || 'Error';
  }

  // Add additional details in development
  if (!isProduction) {
    response.stack = err.stack;

    if (err.originalError) {
      response.originalError = err.originalError;
    }

    if (err.service) {
      response.service = err.service;
    }

    if (err.operation) {
      response.operation = err.operation;
    }
  }

  // Add request info for debugging in development
  if (!isProduction && err.statusCode >= 500) {
    response.request = {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    };
  }

  return response;
};

/**
 * Log error for monitoring and debugging
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 */
const logError = (err, req) => {
  const timestamp = new Date().toISOString();

  console.error('\n' + '='.repeat(80));
  console.error(`[${timestamp}] ERROR OCCURRED`);
  console.error('='.repeat(80));

  // Log request details
  console.error('Request:', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Log error details
  console.error('Error:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    isOperational: err.isOperational,
  });

  // Log stack trace for non-operational errors or in development
  if (!err.isOperational || process.env.NODE_ENV !== 'production') {
    console.error('Stack:', err.stack);
  }

  // Log original error if exists
  if (err.originalError) {
    console.error('Original Error:', err.originalError);
  }

  console.error('='.repeat(80) + '\n');
};

/**
 * Handle specific error types
 * @param {Error} err - Error object
 * @returns {AppError} Transformed error
 */
const handleSpecificErrors = (err) => {
  // PostgreSQL errors
  if (err.code?.startsWith('23')) {
    if (err.code === '23505') {
      return new ConflictError('Duplicate entry: ' + err.detail);
    }
    if (err.code === '23503') {
      return new ValidationError('Foreign key constraint violation');
    }
    if (err.code === '23502') {
      return new ValidationError('Required field is missing');
    }
  }

  // Validation errors
  if (err.name === 'ValidationError' && !(err instanceof AppError)) {
    return new ValidationError(err.message);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return new UnauthorizedError('Invalid token');
  }
  if (err.name === 'TokenExpiredError') {
    return new UnauthorizedError('Token expired');
  }

  // Axios/HTTP errors
  if (err.response) {
    const service = err.config?.baseURL || 'External API';
    return new ExternalServiceError(service, err.response.data || err.message);
  }

  return err;
};

/**
 * Global error handling middleware
 * This should be the last middleware in the chain
 */
export const errorHandler = (err, req, res, next) => {
  // Transform specific error types
  let error = handleSpecificErrors(err);

  // Convert unknown errors to AppError
  if (!(error instanceof AppError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal server error';
    error = new AppError(message, statusCode, false);
  }

  // Log error
  logError(error, req);

  // Send error response
  const response = formatErrorResponse(error, req);
  res.status(error.statusCode || 500).json(response);
};

/**
 * Handle 404 - Not Found
 */
export const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};

/**
 * Handle uncaught exceptions
 */
export const handleUncaughtException = () => {
  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error('Error:', err.name, err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  });
};

/**
 * Handle unhandled promise rejections
 */
export const handleUnhandledRejection = () => {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error('Reason:', reason);
    console.error('Promise:', promise);
    process.exit(1);
  });
};
