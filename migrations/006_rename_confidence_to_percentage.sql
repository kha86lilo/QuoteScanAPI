-- Migration: Rename confidence column to confidence_percentage
-- Description: Change confidence from string ('HIGH', 'MEDIUM', 'LOW') to percentage (0-100)
-- Created: 2024

-- =====================================================
-- Step 1: Add new confidence_percentage column
-- =====================================================
ALTER TABLE ai_pricing_recommendations
ADD COLUMN IF NOT EXISTS confidence_percentage INTEGER;

-- =====================================================
-- Step 2: Migrate existing data
-- =====================================================
UPDATE ai_pricing_recommendations
SET confidence_percentage = CASE
    WHEN confidence = 'HIGH' THEN 85
    WHEN confidence = 'MEDIUM' THEN 70
    WHEN confidence = 'LOW' THEN 55
    ELSE 50
END
WHERE confidence IS NOT NULL AND confidence_percentage IS NULL;

-- =====================================================
-- Step 3: Drop old column and index
-- =====================================================
DROP INDEX IF EXISTS idx_ai_pricing_confidence;
ALTER TABLE ai_pricing_recommendations DROP COLUMN IF EXISTS confidence;

-- =====================================================
-- Step 4: Create new index
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_ai_pricing_confidence_pct ON ai_pricing_recommendations(confidence_percentage);

-- =====================================================
-- Step 5: Update column comment
-- =====================================================
COMMENT ON COLUMN ai_pricing_recommendations.confidence_percentage IS 'Confidence level as percentage (0-100)';
