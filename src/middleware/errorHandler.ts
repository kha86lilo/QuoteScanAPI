/**
 * Global Error Handler Middleware
 * Centralized error handling for the API
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Custom error class for application errors
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  status: string;
  service?: string;
  operation?: string;
  originalError?: string;

  constructor(message: string, statusCode = 500, isOperational = true) {
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
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
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
  constructor(message: string) {
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
  constructor(service: string, originalError?: Error | string) {
    super(`External service error: ${service}`, 502);
    this.name = 'ExternalServiceError';
    this.service = service;
    this.originalError =
      originalError instanceof Error ? originalError.message : originalError;
  }
}

export class DatabaseError extends AppError {
  constructor(operation: string, originalError?: Error | string) {
    super(`Database error during ${operation}`, 500);
    this.name = 'DatabaseError';
    this.operation = operation;
    this.originalError =
      originalError instanceof Error ? originalError.message : originalError;
  }
}

type AsyncFunction = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Async handler wrapper to catch errors in async route handlers
 */
export const asyncHandler = (fn: AsyncFunction): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

interface ErrorResponse {
  success: boolean;
  status: string;
  message: string;
  error?: string;
  stack?: string;
  originalError?: string;
  service?: string;
  operation?: string;
  request?: {
    method: string;
    url: string;
    ip?: string;
  };
}

/**
 * Error response formatter
 */
const formatErrorResponse = (err: AppError, req: Request): ErrorResponse => {
  const isProduction = process.env.NODE_ENV === 'production';

  const response: ErrorResponse = {
    success: false,
    status: err.status || 'error',
    message: err.message || 'Internal server error',
  };

  if (err.isOperational) {
    response.error = err.name || 'Error';
  }

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
 */
const logError = (err: AppError, req: Request): void => {
  const timestamp = new Date().toISOString();

  console.error('\n' + '='.repeat(80));
  console.error(`[${timestamp}] ERROR OCCURRED`);
  console.error('='.repeat(80));

  console.error('Request:', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  console.error('Error:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    isOperational: err.isOperational,
  });

  if (!err.isOperational || process.env.NODE_ENV !== 'production') {
    console.error('Stack:', err.stack);
  }

  if (err.originalError) {
    console.error('Original Error:', err.originalError);
  }

  console.error('='.repeat(80) + '\n');
};

interface PostgresError extends Error {
  code?: string;
  detail?: string;
}

interface AxiosError extends Error {
  response?: {
    data?: unknown;
  };
  config?: {
    baseURL?: string;
  };
}

/**
 * Handle specific error types
 */
const handleSpecificErrors = (err: Error | AppError): AppError => {
  const pgErr = err as PostgresError;
  if (pgErr.code?.startsWith('23')) {
    if (pgErr.code === '23505') {
      return new ConflictError('Duplicate entry: ' + pgErr.detail);
    }
    if (pgErr.code === '23503') {
      return new ValidationError('Foreign key constraint violation');
    }
    if (pgErr.code === '23502') {
      return new ValidationError('Required field is missing');
    }
  }

  if (err.name === 'ValidationError' && !(err instanceof AppError)) {
    return new ValidationError(err.message);
  }

  if (err.name === 'JsonWebTokenError') {
    return new UnauthorizedError('Invalid token');
  }
  if (err.name === 'TokenExpiredError') {
    return new UnauthorizedError('Token expired');
  }

  const axiosErr = err as AxiosError;
  if (axiosErr.response) {
    const service = axiosErr.config?.baseURL || 'External API';
    return new ExternalServiceError(
      service,
      (axiosErr.response.data as string) || axiosErr.message
    );
  }

  if (err instanceof AppError) {
    return err;
  }

  return new AppError(err.message || 'Internal server error', 500, false);
};

/**
 * Global error handling middleware
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let error: AppError = handleSpecificErrors(err);

  if (!(error instanceof AppError)) {
    const statusCode = (error as AppError).statusCode || 500;
    const message = (error as Error).message || 'Internal server error';
    error = new AppError(message, statusCode, false);
  }

  logError(error, req);

  const response = formatErrorResponse(error, req);
  res.status(error.statusCode || 500).json(response);
};

/**
 * Handle 404 - Not Found
 */
export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.originalUrl}`);
  next(error);
};

/**
 * Handle uncaught exceptions
 */
export const handleUncaughtException = (): void => {
  process.on('uncaughtException', (err: Error) => {
    console.error('UNCAUGHT EXCEPTION! Shutting down...');
    console.error('Error:', err.name, err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  });
};

/**
 * Handle unhandled promise rejections
 */
export const handleUnhandledRejection = (): void => {
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    console.error('UNHANDLED REJECTION! Shutting down...');
    console.error('Reason:', reason);
    console.error('Promise:', promise);
    process.exit(1);
  });
};
