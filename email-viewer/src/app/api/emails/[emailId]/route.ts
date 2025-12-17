import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ emailId: string }> }
) {
  const { emailId: emailIdParam } = await params;
  const emailId = parseInt(emailIdParam);

  if (isNaN(emailId)) {
    return NextResponse.json({ error: 'Invalid email ID' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Get email details
    const emailResult = await client.query(
      `SELECT * FROM shipping_emails WHERE email_id = $1`,
      [emailId]
    );

    if (emailResult.rows.length === 0) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    const email = emailResult.rows[0];

    // Get quotes for this email with their matches and AI pricing recommendations
    const quotesResult = await client.query(
      `SELECT
        q.*,
        -- AI Pricing Recommendations
        apr.id as ai_price_id,
        apr.ai_recommended_price,
        apr.ai_reasoning,
        apr.confidence as ai_confidence,
        apr.floor_price,
        apr.ceiling_price,
        apr.target_price,
        (
          SELECT json_agg(
            json_build_object(
              'match_id', m.match_id,
              'matched_quote_id', m.matched_quote_id,
              'similarity_score', m.similarity_score,
              'match_criteria', m.match_criteria,
              'suggested_price', m.suggested_price,
              'price_confidence', m.price_confidence,
              'match_algorithm_version', m.match_algorithm_version,
              'created_at', m.created_at,
              'matched_quote', json_build_object(
                'quote_id', mq.quote_id,
                'client_company_name', mq.client_company_name,
                'origin_city', mq.origin_city,
                'origin_country', mq.origin_country,
                'destination_city', mq.destination_city,
                'destination_country', mq.destination_country,
                'cargo_description', mq.cargo_description,
                'cargo_weight', mq.cargo_weight,
                'weight_unit', mq.weight_unit,
                'service_type', mq.service_type,
                'final_agreed_price', mq.final_agreed_price,
                'initial_quote_amount', mq.initial_quote_amount,
                'quote_status', mq.quote_status
              )
            )
            ORDER BY m.similarity_score DESC
          )
          FROM quote_matches m
          INNER JOIN shipping_quotes mq ON m.matched_quote_id = mq.quote_id
          WHERE m.source_quote_id = q.quote_id
        ) as matches,
        (
          SELECT m.suggested_price
          FROM quote_matches m
          WHERE m.source_quote_id = q.quote_id
          ORDER BY m.similarity_score DESC
          LIMIT 1
        ) as top_suggested_price,
        (
          SELECT AVG(m.suggested_price)
          FROM quote_matches m
          WHERE m.source_quote_id = q.quote_id AND m.suggested_price IS NOT NULL
        ) as avg_suggested_price
      FROM shipping_quotes q
      INNER JOIN ai_pricing_recommendations apr ON apr.quote_id = q.quote_id
      WHERE q.email_id = $1
      ORDER BY q.created_at`,
      [emailId]
    );

    return NextResponse.json({
      ...email,
      quotes: quotesResult.rows.map(q => ({
        ...q,
        matches: q.matches || [],
      })),
    });
  } catch (error) {
    console.error('Error fetching email details:', error);
    return NextResponse.json({ error: 'Failed to fetch email details' }, { status: 500 });
  } finally {
    client.release();
  }
}
