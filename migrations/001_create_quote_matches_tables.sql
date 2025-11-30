-- Migration: Create quote_matches and quote_match_feedback tables
-- Description: Tables for storing fuzzy match results and user feedback for price suggestions
-- Created: 2024

-- =====================================================
-- Table: quote_matches
-- Stores similarity matches between quotes for price suggestions
-- =====================================================
CREATE TABLE IF NOT EXISTS quote_matches (
  match_id SERIAL PRIMARY KEY,
  source_quote_id INTEGER NOT NULL REFERENCES shipping_quotes(quote_id) ON DELETE CASCADE,
  matched_quote_id INTEGER NOT NULL REFERENCES shipping_quotes(quote_id) ON DELETE CASCADE,

  -- Similarity metrics
  similarity_score DECIMAL(5,4) NOT NULL,  -- Overall score 0.0000 to 1.0000
  match_criteria JSONB,  -- Per-field scores: {"origin": 0.95, "destination": 0.88, "cargo_type": 0.72}

  -- Price suggestion
  suggested_price DECIMAL(12,2),
  price_confidence DECIMAL(5,4),  -- Confidence in price suggestion 0.0000 to 1.0000

  -- Metadata
  match_algorithm_version VARCHAR(20) DEFAULT 'v1',  -- Track which algorithm version created this match
  created_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  CONSTRAINT uq_quote_match_pair UNIQUE(source_quote_id, matched_quote_id),
  CONSTRAINT chk_different_quotes CHECK(source_quote_id != matched_quote_id),
  CONSTRAINT chk_similarity_range CHECK(similarity_score >= 0 AND similarity_score <= 1),
  CONSTRAINT chk_confidence_range CHECK(price_confidence IS NULL OR (price_confidence >= 0 AND price_confidence <= 1))
);

-- =====================================================
-- Table: quote_match_feedback
-- Stores user feedback on matches for algorithm improvement
-- =====================================================
CREATE TABLE IF NOT EXISTS quote_match_feedback (
  feedback_id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES quote_matches(match_id) ON DELETE CASCADE,

  -- User info
  user_id VARCHAR(255),  -- Optional: for multi-user tracking

  -- Feedback
  rating SMALLINT NOT NULL,  -- -1 = thumbs down, 1 = thumbs up
  feedback_reason VARCHAR(50),  -- Categorized: 'wrong_route', 'different_cargo', 'price_outdated', 'good_match', etc.
  feedback_notes TEXT,  -- Free-form user comments

  -- Ground truth data (for learning)
  actual_price_used DECIMAL(12,2),  -- What price the user actually used

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  CONSTRAINT uq_user_match_feedback UNIQUE(match_id, user_id),
  CONSTRAINT chk_rating_values CHECK(rating IN (-1, 1))
);

-- =====================================================
-- Indexes for performance
-- =====================================================

-- Fast lookup of matches for a quote
CREATE INDEX IF NOT EXISTS idx_quote_matches_source ON quote_matches(source_quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_matches_matched ON quote_matches(matched_quote_id);

-- Sort by best matches first
CREATE INDEX IF NOT EXISTS idx_quote_matches_score ON quote_matches(similarity_score DESC);

-- Find recent matches
CREATE INDEX IF NOT EXISTS idx_quote_matches_created ON quote_matches(created_at DESC);

-- Feedback lookups
CREATE INDEX IF NOT EXISTS idx_feedback_match ON quote_match_feedback(match_id);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON quote_match_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_reason ON quote_match_feedback(feedback_reason);

-- =====================================================
-- Useful views
-- =====================================================

-- View: Matches with aggregated feedback stats
CREATE OR REPLACE VIEW quote_matches_with_feedback AS
SELECT
  m.*,
  COUNT(f.feedback_id) as feedback_count,
  AVG(f.rating) as avg_rating,
  COUNT(CASE WHEN f.rating = 1 THEN 1 END) as thumbs_up_count,
  COUNT(CASE WHEN f.rating = -1 THEN 1 END) as thumbs_down_count
FROM quote_matches m
LEFT JOIN quote_match_feedback f ON m.match_id = f.match_id
GROUP BY m.match_id;

-- =====================================================
-- Comments for documentation
-- =====================================================
COMMENT ON TABLE quote_matches IS 'Stores fuzzy match results between shipping quotes for price suggestions';
COMMENT ON TABLE quote_match_feedback IS 'User feedback on quote matches to improve matching algorithm';
COMMENT ON COLUMN quote_matches.match_criteria IS 'JSON object with per-field similarity scores, e.g., {"origin": 0.95, "destination": 0.88}';
COMMENT ON COLUMN quote_matches.match_algorithm_version IS 'Version of matching algorithm that created this match, for A/B testing';
COMMENT ON COLUMN quote_match_feedback.feedback_reason IS 'Categorized reason: wrong_route, different_cargo, price_outdated, weight_mismatch, good_match, excellent_suggestion';
