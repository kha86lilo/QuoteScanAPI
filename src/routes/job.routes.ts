/**
 * Job Routes
 * Handles all job status and result endpoints
 */

import express, { Router } from 'express';
import * as jobController from '../controllers/job.controller.js';
import { statusCheckLimiter } from '../middleware/rateLimiter.js';

const router: Router = express.Router();

/**
 * Get job statistics
 * GET /api/jobs/statistics
 */
router.get('/statistics', statusCheckLimiter, jobController.getJobStatistics);

/**
 * Get all jobs
 * GET /api/jobs
 */
router.get('/', statusCheckLimiter, jobController.getAllJobs);

/**
 * Get job status by ID
 * GET /api/jobs/:id
 */
router.get('/:id', statusCheckLimiter, jobController.getJobStatus);

/**
 * Get job result (completed jobs only)
 * GET /api/jobs/:id/result
 */
router.get('/:id/result', statusCheckLimiter, jobController.getJobResult);

/**
 * Cancel a job
 * DELETE /api/jobs/:id
 */
router.delete('/:id', jobController.cancelJob);

export default router;
