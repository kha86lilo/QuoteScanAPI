-- Create email_attachments table
CREATE TABLE IF NOT EXISTS email_attachments (
    id SERIAL PRIMARY KEY,
    email_message_id TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    filename TEXT,
    content_type TEXT,
    size BIGINT,
    download_url TEXT,
    is_inline BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(email_message_id, attachment_id)
);

-- Create index on email_message_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_email_attachments_message_id ON email_attachments(email_message_id);

-- Add comment to table
COMMENT ON TABLE email_attachments IS 'Stores metadata about email attachments from processed shipping quote emails';

