/**
 * Rate Limiting Middleware
 * Limits the number of requests per time window
 */

import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for email processing endpoints
 * Allows only 1 request per 60 seconds (configurable via env)
 */
export const emailProcessingLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1, // 1 request per window
  message: {
    success: false,
    error: 'Too many processing requests. Please wait before submitting another job.',
    retryAfter: 'Check the Retry-After header for when you can retry',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    res.status(429).json({
      success: false,
      error: 'Too many processing requests',
      message:
        'You have exceeded the rate limit. Only one email processing job is allowed at a time.',
      retryAfter: `${retryAfter} seconds`,
      resetTime: new Date(req.rateLimit.resetTime).toISOString(),
    });
  },
  // Skip rate limiting for certain conditions (e.g., admins)
  skip: (req) => {
    // Skip rate limiting if admin token is provided
    const adminToken = process.env.ADMIN_API_TOKEN;
    if (adminToken && req.headers['x-admin-token'] === adminToken) {
      return true;
    }
    return false;
  },
});

/**
 * Rate limiter for general API endpoints
 * More lenient than processing limiter
 */
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for status check endpoints
 * Very lenient to allow frequent status polling
 */
export const statusCheckLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute (poll every 2 seconds)
  message: {
    success: false,
    error: 'Too many status check requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export default {
  emailProcessingLimiter,
  generalApiLimiter,
  statusCheckLimiter,
};
