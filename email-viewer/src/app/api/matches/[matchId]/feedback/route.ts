import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId: matchIdParam } = await params;
  const matchId = parseInt(matchIdParam);

  if (isNaN(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
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

    const result = await client.query(
      `INSERT INTO quote_match_feedback (
        match_id, user_id, rating, feedback_reason, feedback_notes, actual_price_used
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (match_id, user_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        feedback_reason = EXCLUDED.feedback_reason,
        feedback_notes = EXCLUDED.feedback_notes,
        actual_price_used = EXCLUDED.actual_price_used,
        created_at = NOW()
      RETURNING *`,
      [matchId, userId, rating, feedbackReason, feedbackNotes, actualPriceUsed]
    );

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting feedback:', error);
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId: matchIdParam } = await params;
  const matchId = parseInt(matchIdParam);

  if (isNaN(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM quote_match_feedback
      WHERE match_id = $1
      ORDER BY created_at DESC`,
      [matchId]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching feedback:', error);
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: 500 });
  } finally {
    client.release();
  }
}
