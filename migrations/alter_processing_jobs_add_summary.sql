-- Add summary column to processing_jobs table
-- This stores processing summary data and will be preserved during cleanup

ALTER TABLE processing_jobs 
ADD COLUMN IF NOT EXISTS summary JSONB;

-- Add index for querying summary data
CREATE INDEX IF NOT EXISTS idx_processing_jobs_summary ON processing_jobs USING GIN (summary);

-- Add comment
COMMENT ON COLUMN processing_jobs.summary IS 'Processing summary including filtered/processed counts, costs, and savings';

-- Example summary structure:
-- {
--   "fetched": 100,
--   "filtered": {"toProcess": 30, "toSkip": 70},
--   "processed": {"successful": 25, "skipped": 3, "failed": 2},
--   "estimatedCost": 0.45,
--   "estimatedSavings": 1.05,
--   "actualCost": 0.38,
--   "aiProvider": "claude",
--   "model": "claude-3-5-sonnet-20241022"
-- }
