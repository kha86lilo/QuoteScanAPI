/**
 * Job Processor Service
 * Handles asynchronous email processing with status tracking
 */

import { v4 as uuidv4 } from 'uuid';
import * as emailExtractor from './emailExtractor.js';
import * as db from '../config/db.js';

class JobProcessor {
  constructor() {
    // In-memory job storage (consider Redis or database for production)
    this.jobs = new Map();
  }

  /**
   * Create a new job
   * @param {Object} jobData - Job configuration
   * @returns {string} - Job ID
   */
  createJob(jobData) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      data: jobData,
      result: null,
      error: null,
      progress: {
        current: 0,
        total: 0,
        percentage: 0,
      },
      lastReceivedDateTime: null,
    };

    this.jobs.set(jobId, job);

    // Also save to database
    db.saveJobToDatabase(job).catch((err) => {
      console.error('Error saving job to database:', err);
    });

    return jobId;
  }

  /**
   * Get job status
   * @param {string} jobId - Job ID
   * @returns {Object|null} - Job object or null if not found
   */
  async getJob(jobId) {
    // Try in-memory first
    if (this.jobs.has(jobId)) {
      return this.jobs.get(jobId);
    }

    // Try database
    try {
      const job = await db.getJobFromDatabase(jobId);
      if (job) {
        // Cache it in memory
        this.jobs.set(jobId, job);
      }
      return job;
    } catch (error) {
      console.error('Error retrieving job from database:', error);
      return null;
    }
  }

  /**
   * Update job status
   * @param {string} jobId - Job ID
   * @param {Object} updates - Updates to apply
   */
  async updateJob(jobId, updates) {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    Object.assign(job, updates, {
      updatedAt: new Date().toISOString(),
    });

    

    // Extract lastReceivedDateTime if present in result
    if (updates.result && updates.result.lastReceivedDateTime) {
      job.lastReceivedDateTime = updates.result.lastReceivedDateTime;
    }

    this.jobs.set(jobId, job);

    // Update database
    await db.updateJobInDatabase(job).catch((err) => {
      console.error('Error updating job in database:', err);
    });
  }

  /**
   * Process a job asynchronously
   * @param {string} jobId - Job ID
   */
  async processJob(jobId) {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    try {
      // Update status to processing
      await this.updateJob(jobId, {
        status: 'processing',
        startedAt: new Date().toISOString(),
      });

      console.log(`\nStarting job ${jobId}...`);

      // Process emails
      const result = await emailExtractor.processEmails(job.data);

      // Update job with results
      await this.updateJob(jobId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: {
          ...result,
          preview: undefined
        },
        progress: {
          current: result.fetched,
          total: result.fetched,
          percentage: 100,
        },
      });

      console.log(`Job ${jobId} completed successfully`);
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);

      await this.updateJob(jobId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: {
          message: error.message,
          stack: error.stack,
        },
      });
    }
  }

  /**
   * Start processing a job (non-blocking)
   * @param {string} jobId - Job ID
   */
  startJob(jobId) {
    // Process in background without awaiting
    this.processJob(jobId).catch((err) => {
      console.error(`Unhandled error in job ${jobId}:`, err);
    });
  }

  /**
   * Get all jobs (with optional filtering)
   * @param {Object} filters - Filter options
   * @returns {Array} - Array of jobs
   */
  async getAllJobs(filters = {}) {
    const jobs = Array.from(this.jobs.values());

    if (filters.status) {
      return jobs.filter((job) => job.status === filters.status);
    }

    return jobs;
  }

  /**
   * Clean up old jobs (older than specified days) 
   * @param {number} daysOld - Number of days
   */
  async cleanupOldJobs(daysOld = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    let removedFromMemory = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const jobDate = new Date(job.createdAt);
      if (jobDate < cutoffDate && (job.status === 'completed' || job.status === 'failed')) {
        // Remove from in-memory cache only
        this.jobs.delete(jobId);
        removedFromMemory++;

        // Database records are preserved - do NOT delete from database 
      }
    }

    if (removedFromMemory > 0) {
      console.log(
        `Cleanup: Removed ${removedFromMemory} old jobs from memory cache (database records preserved)`
      );
    }
  }

  /**
   * Get job statistics
   * @param {Object} filters - Optional filters (e.g., date range, status)
   * @returns {Promise<Object>} - Aggregated statistics
   */
  async getJobStatistics(filters = {}) {
    return db.getJobStatistics(filters);
  }
}

// Export singleton instance
const jobProcessor = new JobProcessor();

// Start cleanup task (runs every 24 hours)
setInterval(
  () => {
    jobProcessor.cleanupOldJobs(7).catch((err) => {
      console.error('Error during job cleanup:', err);
    });
  },
  24 * 60 * 60 * 1000
);

export default jobProcessor;
