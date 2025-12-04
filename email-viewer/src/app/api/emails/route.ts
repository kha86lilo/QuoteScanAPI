import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        e.*,
        COUNT(q.quote_id) as quote_count
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
      GROUP BY e.email_id
      ORDER BY e.email_received_date DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await client.query('SELECT COUNT(*) FROM shipping_emails');
    const totalCount = parseInt(countResult.rows[0].count);

    return NextResponse.json({
      emails: result.rows,
      totalCount,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  } finally {
    client.release();
  }
}
