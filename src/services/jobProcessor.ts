/**
 * Job Processor Service
 * Handles asynchronous email processing with status tracking
 */

import { v4 as uuidv4 } from 'uuid';
import * as emailExtractor from './mail/emailExtractor.js';
import * as db from '../config/db.js';
import type { Job, JobData, JobStatus, JobProgress, JobResult, JobStatistics } from '../types/index.js';

interface JobFilters {
  status?: JobStatus;
  startDate?: string;
  endDate?: string;
}

interface DatabaseJobRow {
  job_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  job_data: JobData;
  result: JobResult | null;
  error: { message: string; stack?: string } | null;
  progress: JobProgress;
  last_received_datetime: string | null;
}

class JobProcessor {
  private jobs: Map<string, Job>;

  constructor() {
    this.jobs = new Map();
  }

  /**
   * Create a new job
   */
  async createJob(jobData: JobData): Promise<string> {
    const jobId = uuidv4();
    const job: Job = {
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
      lastReceivedDateTime: undefined,
    };

    await db.saveJobToDatabase(job);
    this.jobs.set(jobId, job);

    return jobId;
  }

  /**
   * Get job status
   */
  async getJob(jobId: string): Promise<Job | null> {
    if (this.jobs.has(jobId)) {
      return this.jobs.get(jobId) || null;
    }

    try {
      const job = await db.getJobFromDatabase(jobId);
      if (job) {
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
   */
  async updateJob(jobId: string, updates: Partial<Job>): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    Object.assign(job, updates, {
      updatedAt: new Date().toISOString(),
    });

    if (updates.result && updates.result.lastReceivedDateTime) {
      job.lastReceivedDateTime = updates.result.lastReceivedDateTime;
    }

    await db.updateJobInDatabase(job);
    this.jobs.set(jobId, job);
  }

  /**
   * Process a job asynchronously
   */
  async processJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    try {
      await this.updateJob(jobId, {
        status: 'processing',
        startedAt: new Date().toISOString(),
      });

      console.log(`\nStarting job ${jobId}...`);

      const result = await emailExtractor.processEmails(job.data);

      await this.updateJob(jobId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: {
          ...result,
          preview: undefined,
        },
        progress: {
          current: result.fetched,
          total: result.fetched,
          percentage: 100,
        },
      });

      console.log(`Job ${jobId} completed successfully`);
    } catch (error) {
      const err = error as Error;
      console.error(`Job ${jobId} failed:`, err);

      await this.updateJob(jobId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: {
          message: err.message,
          stack: err.stack,
        },
      });
    }
  }

  /**
   * Start processing a job (non-blocking)
   */
  startJob(jobId: string): void {
    this.processJob(jobId).catch((err) => {
      console.error(`Unhandled error in job ${jobId}:`, err);
    });
  }

  /**
   * Get all jobs (with optional filtering)
   */
  async getAllJobs(filters: JobFilters = {}): Promise<Job[]> {
    try {
      const client = await db.pool.connect();
      try {
        let query = 'SELECT * FROM processing_jobs';
        const params: string[] = [];

        if (filters.status) {
          query += ' WHERE status = $1';
          params.push(filters.status);
        }

        query += ' ORDER BY created_at DESC';

        const result = await client.query(query, params);

        return result.rows.map((row: DatabaseJobRow) => ({
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
          lastReceivedDateTime: row.last_received_datetime ?? undefined,
        }));
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error fetching jobs from database:', error);
      const jobs = Array.from(this.jobs.values());
      if (filters.status) {
        return jobs.filter((job) => job.status === filters.status);
      }
      return jobs;
    }
  }

  /**
   * Clean up old jobs (older than specified days)
   */
  async cleanupOldJobs(daysOld = 7): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    let removedFromMemory = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const jobDate = new Date(job.createdAt);
      if (jobDate < cutoffDate && (job.status === 'completed' || job.status === 'failed')) {
        this.jobs.delete(jobId);
        removedFromMemory++;
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
   */
  async getJobStatistics(filters: JobFilters = {}): Promise<JobStatistics> {
    return db.getJobStatistics(filters);
  }
}

const jobProcessor = new JobProcessor();

setInterval(
  () => {
    jobProcessor.cleanupOldJobs(7).catch((err) => {
      console.error('Error during job cleanup:', err);
    });
  },
  24 * 60 * 60 * 1000
);

export default jobProcessor;
