import { NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * Submit feedback for an AI pricing recommendation on a quote
 * POST /api/quotes/[quoteId]/feedback
 * Body: { userId?, rating, feedbackReason?, feedbackNotes?, actualPriceUsed? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId: quoteIdParam } = await params;
  const quoteId = parseInt(quoteIdParam);

  if (isNaN(quoteId)) {
    return NextResponse.json({ error: 'Invalid quote ID' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const body = await request.json();
    const {
      userId = null,
      rating,
      feedbackReason = null,
      feedbackNotes = null,
      actualPriceUsed = null,
    } = body;

    if (rating !== 1 && rating !== -1) {
      return NextResponse.json({ error: 'Rating must be 1 (thumbs up) or -1 (thumbs down)' }, { status: 400 });
    }

    // Get the AI pricing recommendation ID for this quote
    const aiPriceResult = await client.query(
      `SELECT id FROM ai_pricing_recommendations WHERE quote_id = $1`,
      [quoteId]
    );

    if (aiPriceResult.rows.length === 0) {
      return NextResponse.json({ error: 'No AI pricing recommendation found for this quote' }, { status: 404 });
    }

    const aiPriceId = aiPriceResult.rows[0].id;

    const result = await client.query(
      `INSERT INTO quote_ai_price_feedback (
        ai_price_id, user_id, rating, feedback_reason, feedback_notes, actual_price_used
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (ai_price_id, user_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        feedback_reason = EXCLUDED.feedback_reason,
        feedback_notes = EXCLUDED.feedback_notes,
        actual_price_used = EXCLUDED.actual_price_used,
        created_at = NOW()
      RETURNING *`,
      [aiPriceId, userId, rating, feedbackReason, feedbackNotes, actualPriceUsed]
    );

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting feedback:', error);
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * Get feedback for an AI pricing recommendation on a quote
 * GET /api/quotes/[quoteId]/feedback
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const { quoteId: quoteIdParam } = await params;
  const quoteId = parseInt(quoteIdParam);

  if (isNaN(quoteId)) {
    return NextResponse.json({ error: 'Invalid quote ID' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Get the AI pricing recommendation ID for this quote
    const aiPriceResult = await client.query(
      `SELECT id FROM ai_pricing_recommendations WHERE quote_id = $1`,
      [quoteId]
    );

    if (aiPriceResult.rows.length === 0) {
      return NextResponse.json([]);
    }

    const aiPriceId = aiPriceResult.rows[0].id;

    const result = await client.query(
      `SELECT * FROM quote_ai_price_feedback
      WHERE ai_price_id = $1
      ORDER BY created_at DESC`,
      [aiPriceId]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching feedback:', error);
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 });
  } finally {
    client.release();
  }
}
