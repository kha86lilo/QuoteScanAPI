-- Migration: Create spammers table
-- Description: Table for storing email addresses to block from quote processing
-- Created: 2024

-- =====================================================
-- Table: spammers
-- Stores email addresses that should be blocked from quote processing
-- =====================================================
CREATE TABLE IF NOT EXISTS spammers (
  spammer_id SERIAL PRIMARY KEY,
  email_address VARCHAR(255) NOT NULL UNIQUE,
  reason VARCHAR(500),  -- Optional reason for blocking
  added_by VARCHAR(255),  -- Who added this spammer
  created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- Indexes for performance
-- =====================================================

-- Fast lookup by email address (already unique, but explicit index for clarity)
CREATE INDEX IF NOT EXISTS idx_spammers_email ON spammers(email_address);

-- =====================================================
-- Initial data: Add known spammers
-- =====================================================
INSERT INTO spammers (email_address, reason, added_by) VALUES
  ('ramon@rldtrans.com', 'Initial spammer list', 'system')
ON CONFLICT (email_address) DO NOTHING;

-- =====================================================
-- Comments for documentation
-- =====================================================
COMMENT ON TABLE spammers IS 'Email addresses blocked from quote processing';
COMMENT ON COLUMN spammers.email_address IS 'The email address to block (case-insensitive matching recommended)';
COMMENT ON COLUMN spammers.reason IS 'Optional explanation for why this address was blocked';
COMMENT ON COLUMN spammers.added_by IS 'User or system that added this entry';
