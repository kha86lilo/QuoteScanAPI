# Database Migrations

This folder contains SQL migration scripts and setup tools for the database schema.

## Migration Files

### `create_processing_jobs_table.sql`

Creates the `processing_jobs` table for tracking asynchronous email processing jobs.

**Columns:**

- `job_id` - Unique identifier (UUID)
- `status` - Job status (pending, processing, completed, failed)
- `created_at`, `updated_at` - Timestamps
- `started_at`, `completed_at` - Processing timestamps
- `job_data` - Job configuration (JSONB)
- `result` - Processing results (JSONB)
- `error` - Error details if failed (JSONB)
- `progress` - Current progress (JSONB)
- `summary` - Processing summary (JSONB)

### `create_email_attachments_table.sql`

Creates the `email_attachments` table for storing email attachment metadata and extracted text.

### `alter_processing_jobs_add_summary.sql`

Adds the `summary` JSONB column to existing `processing_jobs` table.

**Summary Structure:**

```json
{
  "fetched": 100,
  "filtered": { "toProcess": 30, "toSkip": 70 },
  "processed": { "successful": 25, "skipped": 3, "failed": 2 },
  "estimatedCost": 0.45,
  "estimatedSavings": 1.05,
  "actualCost": 0.38,
  "aiProvider": "claude",
  "model": "claude-3-5-sonnet-20241022"
}
```

### `alter_processing_jobs_add_last_received_datetime.sql`

Adds the `last_received_datetime` TIMESTAMP column to track the maximum receivedDateTime from emails processed in each job.

**Purpose:**

- Enables incremental email processing
- Allows filtering emails by date range in subsequent jobs
- Helps avoid reprocessing the same emails

## Setup Scripts

### `setup_database.js`

**Recommended** - Automated database setup script.

Handles:

- Creates tables if they don't exist
- Adds summary column if missing
- Verifies table structure
- Idempotent (safe to run multiple times)

**Run:**

```bash
node migrations/setup_database.js
```

### `run_migration.js`

Standalone migration runner for adding the summary column.

**Run:**

```bash
node migrations/run_migration.js
```

## Running Migrations

### Initial Setup

```bash
# Run complete database setup (recommended)
node migrations/setup_database.js
```

### Manual SQL Execution

If you prefer manual execution:

```bash
# Using psql
psql -h <host> -U <user> -d <database> -f migrations/create_processing_jobs_table.sql
psql -h <host> -U <user> -d <database> -f migrations/create_email_attachments_table.sql
psql -h <host> -U <user> -d <database> -f migrations/alter_processing_jobs_add_summary.sql
```

### Using Supabase Dashboard

1. Open Supabase Dashboard
2. Navigate to SQL Editor
3. Copy contents of SQL file
4. Execute query

## Migration Order

1. `create_processing_jobs_table.sql` - Create base table
2. `create_email_attachments_table.sql` - Create attachments table
3. `alter_processing_jobs_add_summary.sql` - Add summary column
4. `alter_processing_jobs_add_last_received_datetime.sql` - Add last received datetime tracking

Or simply run:

```bash
node migrations/setup_database.js
```

## Verification

After running migrations:

```sql
-- Verify processing_jobs table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'processing_jobs';

-- Check if summary column exists
SELECT EXISTS (
  SELECT FROM information_schema.columns
  WHERE table_name = 'processing_jobs'
  AND column_name = 'summary'
);
```

## Rollback

To remove columns (not recommended):

```sql
-- Remove summary column
ALTER TABLE processing_jobs DROP COLUMN IF EXISTS summary;

-- Remove last_received_datetime column
ALTER TABLE processing_jobs DROP COLUMN IF EXISTS last_received_datetime;
```

## Environment Variables

Migration scripts require these environment variables (from `.env`):

```env
SUPABASE_DB_HOST=your-host
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=your-user
SUPABASE_DB_PASSWORD=your-password
SUPABASE_DB_PORT=6543
```

## Support

For issues or questions about migrations, refer to the main project documentation.
