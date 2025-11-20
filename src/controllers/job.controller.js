/**
 * Job Controller
 * Handles job status and result retrieval
 */

import jobProcessor from '../services/jobProcessor.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

/**
 * Get job status by ID
 * GET /api/jobs/:id
 */
export const getJobStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const job = await jobProcessor.getJob(id);

  if (!job) {
    throw new NotFoundError(`Job with ID: ${id}`);
  }

  // Build response based on job status
  const response = {
    success: true,
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
  };

  // Add timing information
  if (job.startedAt) {
    response.startedAt = job.startedAt;
  }
  if (job.completedAt) {
    response.completedAt = job.completedAt;

    // Calculate duration
    const start = new Date(job.startedAt);
    const end = new Date(job.completedAt);
    response.duration = `${Math.round((end - start) / 1000)} seconds`;
  }

  // Add results if completed
  if (job.status === 'completed') {
    response.result = job.result;
    // Include summary separately for easy access
    if (job.summary) {
      response.summary = job.summary;
    }
  }

  // Add error if failed
  if (job.status === 'failed') {
    response.error = job.error;
  }

  // Add estimated time remaining for processing jobs
  if (job.status === 'processing') {
    response.message = 'Job is currently being processed. Check back in a few seconds.';
  }

  res.json(response);
});

/**
 * Get all jobs with optional filtering
 * GET /api/jobs?status=completed
 */
export const getAllJobs = asyncHandler(async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  const filters = {};
  if (status) {
    filters.status = status;
  }

  let jobs = await jobProcessor.getAllJobs(filters);

  // Sort by creation date (newest first)
  jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Pagination
  const total = jobs.length;
  jobs = jobs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

  res.json({
    success: true,
    total,
    limit: parseInt(limit),
    offset: parseInt(offset),
    jobs: jobs.map((job) => ({
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      progress: job.progress,
      summary: job.summary || null,
    })),
  });
});

/**
 * Get job result (completed jobs only)
 * GET /api/jobs/:id/result
 */
export const getJobResult = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const job = await jobProcessor.getJob(id);

  if (!job) {
    throw new NotFoundError(`Job with ID: ${id}`);
  }

  if (job.status !== 'completed') {
    throw new ValidationError(`Job status is '${job.status}'. Only completed jobs have results.`);
  }

  res.json({
    success: true,
    jobId: job.id,
    completedAt: job.completedAt,
    result: job.result,
  });
});

/**
 * Get aggregated job statistics
 * GET /api/jobs/statistics
 */
export const getJobStatistics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const filters = {};
  if (startDate) {
    filters.startDate = startDate;
  }
  if (endDate) {
    filters.endDate = endDate;
  }

  const statistics = await jobProcessor.getJobStatistics(filters);

  res.json({
    success: true,
    filters: {
      startDate: startDate || 'all time',
      endDate: endDate || 'present',
    },
    statistics: {
      totalJobs: parseInt(statistics.total_jobs) || 0,
      completedJobs: parseInt(statistics.completed_jobs) || 0,
      failedJobs: parseInt(statistics.failed_jobs) || 0,
      totalEmailsFetched: parseInt(statistics.total_emails_fetched) || 0,
      totalEmailsProcessed: parseInt(statistics.total_emails_processed) || 0,
      totalCost: parseFloat(statistics.total_cost) || 0,
      totalSavings: parseFloat(statistics.total_savings) || 0,
    },
  });
});

/**
 * Cancel a pending or processing job
 * DELETE /api/jobs/:id
 */
export const cancelJob = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const job = await jobProcessor.getJob(id);

  if (!job) {
    throw new NotFoundError(`Job with ID: ${id}`);
  }

  if (job.status === 'completed' || job.status === 'failed') {
    throw new ValidationError('Cannot cancel completed or failed job');
  }

  // Mark as cancelled (treat as failed)
  await jobProcessor.updateJob(id, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error: {
      message: 'Job cancelled by user',
    },
  });

  res.json({
    success: true,
    message: 'Job cancelled successfully',
    jobId: id,
  });
});
