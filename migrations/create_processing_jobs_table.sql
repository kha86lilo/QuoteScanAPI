-- Create processing_jobs table for tracking async email processing jobs
-- This table stores job metadata, status, and results

CREATE TABLE IF NOT EXISTS processing_jobs (
    job_id VARCHAR(36) PRIMARY KEY,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    job_data JSONB NOT NULL,
    result JSONB,
    error JSONB,
    progress JSONB DEFAULT '{"current": 0, "total": 0, "percentage": 0}'::jsonb
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON processing_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_completed_at ON processing_jobs(completed_at DESC);

-- Add comment to table
COMMENT ON TABLE processing_jobs IS 'Tracks asynchronous email processing jobs with status and results';

-- Column comments
COMMENT ON COLUMN processing_jobs.job_id IS 'Unique identifier for the job (UUID)';
COMMENT ON COLUMN processing_jobs.status IS 'Current status: pending, processing, completed, or failed';
COMMENT ON COLUMN processing_jobs.created_at IS 'When the job was created';
COMMENT ON COLUMN processing_jobs.updated_at IS 'When the job was last updated';
COMMENT ON COLUMN processing_jobs.started_at IS 'When the job started processing';
COMMENT ON COLUMN processing_jobs.completed_at IS 'When the job finished (success or failure)';
COMMENT ON COLUMN processing_jobs.job_data IS 'Job configuration including search parameters';
COMMENT ON COLUMN processing_jobs.result IS 'Processing results when completed';
COMMENT ON COLUMN processing_jobs.error IS 'Error details if failed';
COMMENT ON COLUMN processing_jobs.progress IS 'Current progress information';
