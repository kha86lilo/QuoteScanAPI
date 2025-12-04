-- Migration: Create matching_weight_adjustments table and feedback analytics
-- Description: Tables for storing learned weight adjustments based on user feedback
-- Created: 2024

-- =====================================================
-- Table: matching_weight_adjustments
-- Stores learned weight adjustments per criteria based on feedback
-- =====================================================
CREATE TABLE IF NOT EXISTS matching_weight_adjustments (
  adjustment_id SERIAL PRIMARY KEY,

  -- Which criteria this adjustment applies to
  criteria_name VARCHAR(50) NOT NULL,  -- e.g., 'origin_region', 'cargo_category', 'service_type'

  -- Weight adjustment
  base_weight DECIMAL(5,4) NOT NULL,  -- Original weight from algorithm
  adjusted_weight DECIMAL(5,4) NOT NULL,  -- Learned weight after feedback
  adjustment_factor DECIMAL(5,4) DEFAULT 1.0,  -- Multiplier applied to base weight

  -- Context for when this adjustment applies
  context_filter JSONB,  -- Optional filter: {"service_type": "DRAYAGE", "origin_region": "GULF"}

  -- Learning statistics
  positive_feedback_count INTEGER DEFAULT 0,
  negative_feedback_count INTEGER DEFAULT 0,
  total_matches_count INTEGER DEFAULT 0,
  avg_price_error DECIMAL(12,2),  -- Average difference between suggested and actual price

  -- Algorithm version this applies to
  algorithm_version VARCHAR(20) DEFAULT 'v2-enhanced',

  -- Metadata
  last_calculated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  CONSTRAINT uq_criteria_context UNIQUE(criteria_name, algorithm_version, context_filter),
  CONSTRAINT chk_weight_range CHECK(adjusted_weight >= 0 AND adjusted_weight <= 1)
);

-- =====================================================
-- Table: pricing_history
-- Stores actual pricing outcomes for learning
-- =====================================================
CREATE TABLE IF NOT EXISTS pricing_history (
  history_id SERIAL PRIMARY KEY,

  -- Reference to original quote
  quote_id INTEGER NOT NULL REFERENCES shipping_quotes(quote_id) ON DELETE CASCADE,

  -- What was suggested
  suggested_price DECIMAL(12,2),
  price_confidence DECIMAL(5,4),
  match_count INTEGER,  -- How many matches were found
  top_match_score DECIMAL(5,4),  -- Best match similarity score

  -- What actually happened
  actual_price_quoted DECIMAL(12,2),  -- What price was sent to customer
  actual_price_accepted DECIMAL(12,2),  -- What price customer agreed to
  job_won BOOLEAN,

  -- Quote characteristics (for pattern analysis)
  normalized_service_type VARCHAR(20),
  cargo_category VARCHAR(30),
  origin_region VARCHAR(30),
  destination_region VARCHAR(30),
  weight_range VARCHAR(20),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- Table: lane_pricing_stats
-- Aggregated pricing statistics per lane (route corridor)
-- =====================================================
CREATE TABLE IF NOT EXISTS lane_pricing_stats (
  lane_id SERIAL PRIMARY KEY,

  -- Lane definition
  origin_region VARCHAR(30) NOT NULL,
  destination_region VARCHAR(30) NOT NULL,
  service_type VARCHAR(20) NOT NULL,

  -- Pricing statistics
  quote_count INTEGER DEFAULT 0,
  avg_price DECIMAL(12,2),
  min_price DECIMAL(12,2),
  max_price DECIMAL(12,2),
  stddev_price DECIMAL(12,2),

  -- Per weight range pricing
  price_per_weight_range JSONB,  -- {"LIGHT": {"avg": 500, "count": 10}, "HEAVY": {"avg": 2000, "count": 5}}

  -- Win rate statistics
  total_quotes INTEGER DEFAULT 0,
  won_quotes INTEGER DEFAULT 0,
  win_rate DECIMAL(5,4),

  -- Typical price adjustments
  avg_discount_percent DECIMAL(5,2),  -- Average discount from initial to final price

  -- Metadata
  last_updated TIMESTAMP DEFAULT NOW(),

  CONSTRAINT uq_lane_definition UNIQUE(origin_region, destination_region, service_type)
);

-- =====================================================
-- Indexes for performance
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_weight_adjustments_criteria ON matching_weight_adjustments(criteria_name);
CREATE INDEX IF NOT EXISTS idx_weight_adjustments_version ON matching_weight_adjustments(algorithm_version);

CREATE INDEX IF NOT EXISTS idx_pricing_history_quote ON pricing_history(quote_id);
CREATE INDEX IF NOT EXISTS idx_pricing_history_service ON pricing_history(normalized_service_type);
CREATE INDEX IF NOT EXISTS idx_pricing_history_lane ON pricing_history(origin_region, destination_region);

CREATE INDEX IF NOT EXISTS idx_lane_stats_route ON lane_pricing_stats(origin_region, destination_region);
CREATE INDEX IF NOT EXISTS idx_lane_stats_service ON lane_pricing_stats(service_type);

-- =====================================================
-- Function: Calculate weight adjustments from feedback
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_weight_adjustments()
RETURNS TABLE (
  criteria_name VARCHAR(50),
  positive_rate DECIMAL(5,4),
  suggested_adjustment DECIMAL(5,4)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    key as criteria_name,
    COALESCE(
      SUM(CASE WHEN f.rating = 1 THEN (value::numeric) ELSE 0 END) /
      NULLIF(SUM(value::numeric), 0),
      0
    )::DECIMAL(5,4) as positive_rate,
    -- Suggest increasing weight for criteria that correlate with positive feedback
    CASE
      WHEN COALESCE(SUM(CASE WHEN f.rating = 1 THEN (value::numeric) ELSE 0 END) / NULLIF(SUM(value::numeric), 0), 0) > 0.7
      THEN 1.2  -- Increase by 20%
      WHEN COALESCE(SUM(CASE WHEN f.rating = 1 THEN (value::numeric) ELSE 0 END) / NULLIF(SUM(value::numeric), 0), 0) < 0.3
      THEN 0.8  -- Decrease by 20%
      ELSE 1.0  -- No change
    END::DECIMAL(5,4) as suggested_adjustment
  FROM quote_matches m
  CROSS JOIN LATERAL jsonb_each_text(m.match_criteria)
  LEFT JOIN quote_match_feedback f ON m.match_id = f.match_id
  WHERE f.feedback_id IS NOT NULL
  GROUP BY key;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Function: Update lane pricing stats
-- =====================================================
CREATE OR REPLACE FUNCTION update_lane_pricing_stats()
RETURNS void AS $$
BEGIN
  -- This would be called periodically to refresh lane statistics
  INSERT INTO lane_pricing_stats (
    origin_region, destination_region, service_type,
    quote_count, avg_price, min_price, max_price,
    total_quotes, won_quotes, win_rate,
    last_updated
  )
  SELECT
    ph.origin_region,
    ph.destination_region,
    ph.normalized_service_type,
    COUNT(*),
    AVG(COALESCE(ph.actual_price_accepted, ph.actual_price_quoted, ph.suggested_price)),
    MIN(COALESCE(ph.actual_price_accepted, ph.actual_price_quoted, ph.suggested_price)),
    MAX(COALESCE(ph.actual_price_accepted, ph.actual_price_quoted, ph.suggested_price)),
    COUNT(*),
    SUM(CASE WHEN ph.job_won THEN 1 ELSE 0 END),
    (SUM(CASE WHEN ph.job_won THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0)),
    NOW()
  FROM pricing_history ph
  WHERE ph.origin_region IS NOT NULL
    AND ph.destination_region IS NOT NULL
    AND ph.normalized_service_type IS NOT NULL
  GROUP BY ph.origin_region, ph.destination_region, ph.normalized_service_type
  ON CONFLICT (origin_region, destination_region, service_type)
  DO UPDATE SET
    quote_count = EXCLUDED.quote_count,
    avg_price = EXCLUDED.avg_price,
    min_price = EXCLUDED.min_price,
    max_price = EXCLUDED.max_price,
    total_quotes = EXCLUDED.total_quotes,
    won_quotes = EXCLUDED.won_quotes,
    win_rate = EXCLUDED.win_rate,
    last_updated = NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Comments for documentation
-- =====================================================
COMMENT ON TABLE matching_weight_adjustments IS 'Learned weight adjustments for matching criteria based on user feedback';
COMMENT ON TABLE pricing_history IS 'Historical record of pricing suggestions vs actual outcomes for ML training';
COMMENT ON TABLE lane_pricing_stats IS 'Aggregated pricing statistics per shipping lane for quick lookups';
COMMENT ON FUNCTION calculate_weight_adjustments() IS 'Analyzes feedback to suggest weight adjustments for matching criteria';
COMMENT ON FUNCTION update_lane_pricing_stats() IS 'Refreshes lane pricing statistics from pricing history';
