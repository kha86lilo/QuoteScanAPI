-- Add lastReceivedDateTime column to processing_jobs table
-- This column stores the maximum receivedDateTime from all emails processed in a job
-- Useful for incremental processing to avoid reprocessing the same emails

ALTER TABLE processing_jobs 
ADD COLUMN IF NOT EXISTS last_received_datetime TIMESTAMP;

-- Add index for efficient querying by last_received_datetime
CREATE INDEX IF NOT EXISTS idx_processing_jobs_last_received_datetime 
ON processing_jobs(last_received_datetime DESC);

-- Add comment to column
COMMENT ON COLUMN processing_jobs.last_received_datetime IS 'Maximum receivedDateTime from emails processed in this job, used for incremental processing';
