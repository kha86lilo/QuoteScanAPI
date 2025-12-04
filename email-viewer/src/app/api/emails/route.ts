import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import config from '@/config';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || String(config.DEFAULT_PAGE_SIZE));
  const offset = parseInt(searchParams.get('offset') || '0');
  const page = parseInt(searchParams.get('page') || '1');

  // Calculate offset from page if page is provided
  const calculatedOffset = searchParams.has('page') ? (page - 1) * limit : offset;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        e.*,
        COUNT(q.quote_id) as quote_count
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
      WHERE e.email_received_date >= $3
      GROUP BY e.email_id
      ORDER BY e.email_received_date DESC
      LIMIT $1 OFFSET $2`,
      [limit, calculatedOffset, config.MIN_EMAIL_DATE]
    );

    const countResult = await client.query(
      'SELECT COUNT(*) FROM shipping_emails WHERE email_received_date >= $1',
      [config.MIN_EMAIL_DATE]
    );
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      emails: result.rows,
      totalCount,
      totalPages,
      currentPage: searchParams.has('page') ? page : Math.floor(calculatedOffset / limit) + 1,
      limit,
      offset: calculatedOffset,
      minDate: config.MIN_EMAIL_DATE,
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  } finally {
    client.release();
  }
}
