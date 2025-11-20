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
    this.saveJobToDatabase(job).catch((err) => {
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
      const job = await this.getJobFromDatabase(jobId);
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

    // Extract summary if present in result
    if (updates.result && updates.result.summary) {
      job.summary = updates.result.summary;
    }

    // Extract lastReceivedDateTime if present in result
    if (updates.result && updates.result.lastReceivedDateTime) {
      job.lastReceivedDateTime = updates.result.lastReceivedDateTime;
    }

    this.jobs.set(jobId, job);

    // Update database
    await this.updateJobInDatabase(job).catch((err) => {
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
        result: result,
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
   * Removes from in-memory cache but preserves database records with summary data
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
        // This preserves historical summary data for analytics
      }
    }

    if (removedFromMemory > 0) {
      console.log(
        `Cleanup: Removed ${removedFromMemory} old jobs from memory cache (database records preserved)`
      );
    }
  }

  /**
   * Save job to database
   * @param {Object} job - Job object
   */
  async saveJobToDatabase(job) {
    const client = await db.pool.connect();
    try {
      await client.query(
        `
        INSERT INTO processing_jobs (
          job_id, status, created_at, updated_at, started_at, 
          completed_at, job_data, result, error, progress, summary, last_received_datetime
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
        [
          job.id,
          job.status,
          job.createdAt,
          job.updatedAt,
          job.startedAt,
          job.completedAt,
          JSON.stringify(job.data),
          JSON.stringify(job.result),
          JSON.stringify(job.error),
          JSON.stringify(job.progress),
          JSON.stringify(job.summary || null),
          job.lastReceivedDateTime,
        ]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get job from database
   * @param {string} jobId - Job ID
   * @returns {Object|null} - Job object or null
   */
  async getJobFromDatabase(jobId) {
    const client = await db.pool.connect();
    try {
      const result = await client.query('SELECT * FROM processing_jobs WHERE job_id = $1', [jobId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.job_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        data: row.job_data,
        result: row.result,
        error: row.error,
        progress: row.progress,
        summary: row.summary,
        lastReceivedDateTime: row.last_received_datetime,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update job in database
   * @param {Object} job - Job object
   */
  async updateJobInDatabase(job) {
    const client = await db.pool.connect();
    try {
      await client.query(
        `
        UPDATE processing_jobs 
        SET status = $2, updated_at = $3, started_at = $4, 
            completed_at = $5, result = $6, error = $7, progress = $8, summary = $9, last_received_datetime = $10
        WHERE job_id = $1
      `,
        [
          job.id,
          job.status,
          job.updatedAt,
          job.startedAt,
          job.completedAt,
          JSON.stringify(job.result),
          JSON.stringify(job.error),
          JSON.stringify(job.progress),
          JSON.stringify(job.summary || null),
          job.lastReceivedDateTime,
        ]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get job statistics from database
   * @param {Object} filters - Optional filters (e.g., date range, status)
   * @returns {Promise<Object>} - Aggregated statistics
   */
  async getJobStatistics(filters = {}) {
    const client = await db.pool.connect();
    try {
      let whereClause = '';
      const params = [];

      if (filters.startDate) {
        params.push(filters.startDate);
        whereClause = `WHERE created_at >= $${params.length}`;
      }

      if (filters.endDate) {
        params.push(filters.endDate);
        whereClause += whereClause
          ? ` AND created_at <= $${params.length}`
          : `WHERE created_at <= $${params.length}`;
      }

      const result = await client.query(
        `
        SELECT 
          COUNT(*) as total_jobs,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
          SUM((summary->>'fetched')::int) as total_emails_fetched,
          SUM((summary->'processed'->>'successful')::int) as total_emails_processed,
          SUM((summary->>'actualCost')::numeric) as total_cost,
          SUM((summary->>'estimatedSavings')::numeric) as total_savings
        FROM processing_jobs
        ${whereClause}
      `,
        params
      );

      return result.rows[0];
    } finally {
      client.release();
    }
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
