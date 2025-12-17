-- Migration: Create ai_pricing_recommendations table
-- Description: Dedicated table to store AI pricing recommendations for quotes
-- Created: 2024

-- =====================================================
-- Table: ai_pricing_recommendations
-- Stores AI pricing recommendations with reasoning
-- =====================================================
CREATE TABLE IF NOT EXISTS ai_pricing_recommendations (
  id SERIAL PRIMARY KEY,

  -- References
  quote_id INTEGER NOT NULL REFERENCES shipping_quotes(quote_id) ON DELETE CASCADE,
  email_id INTEGER REFERENCES shipping_emails(email_id) ON DELETE SET NULL,

  -- AI Pricing Details
  ai_recommended_price DECIMAL(12,2),
  ai_reasoning TEXT,
  confidence VARCHAR(10),  -- 'HIGH', 'MEDIUM', 'LOW'

  -- Price Range
  floor_price DECIMAL(12,2),
  ceiling_price DECIMAL(12,2),
  target_price DECIMAL(12,2),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Ensure one AI pricing per quote (allows upsert on re-processing)
  CONSTRAINT uq_ai_pricing_quote UNIQUE(quote_id)
);

-- =====================================================
-- Indexes for performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_ai_pricing_quote ON ai_pricing_recommendations(quote_id);
CREATE INDEX IF NOT EXISTS idx_ai_pricing_email ON ai_pricing_recommendations(email_id);
CREATE INDEX IF NOT EXISTS idx_ai_pricing_confidence ON ai_pricing_recommendations(confidence);
CREATE INDEX IF NOT EXISTS idx_ai_pricing_created ON ai_pricing_recommendations(created_at DESC);

-- =====================================================
-- Comments for documentation
-- =====================================================
COMMENT ON TABLE ai_pricing_recommendations IS 'Stores AI pricing recommendations for shipping quotes with reasoning and confidence levels';
COMMENT ON COLUMN ai_pricing_recommendations.quote_id IS 'Reference to the shipping quote being priced';
COMMENT ON COLUMN ai_pricing_recommendations.email_id IS 'Reference to the source email (nullable)';
COMMENT ON COLUMN ai_pricing_recommendations.ai_recommended_price IS 'AI recommended price for the quote';
COMMENT ON COLUMN ai_pricing_recommendations.ai_reasoning IS 'AI explanation for the pricing recommendation';
COMMENT ON COLUMN ai_pricing_recommendations.confidence IS 'Confidence level: HIGH, MEDIUM, or LOW';
COMMENT ON COLUMN ai_pricing_recommendations.floor_price IS 'Minimum recommended price';
COMMENT ON COLUMN ai_pricing_recommendations.ceiling_price IS 'Maximum recommended price';
COMMENT ON COLUMN ai_pricing_recommendations.target_price IS 'Target/optimal price point';
