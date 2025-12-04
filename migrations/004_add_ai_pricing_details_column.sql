-- Migration: Add ai_pricing_details column to quote_matches
-- Description: Store AI pricing recommendation details including reasoning
-- Created: 2024

-- Add column for AI pricing details
ALTER TABLE quote_matches
ADD COLUMN IF NOT EXISTS ai_pricing_details JSONB;

-- Add comment for documentation
COMMENT ON COLUMN quote_matches.ai_pricing_details IS 'AI pricing recommendation details: {recommended_price, floor_price, target_price, ceiling_price, confidence, reasoning}';

-- Create index for querying by AI confidence level
CREATE INDEX IF NOT EXISTS idx_quote_matches_ai_confidence
ON quote_matches ((ai_pricing_details->>'confidence'))
WHERE ai_pricing_details IS NOT NULL;
