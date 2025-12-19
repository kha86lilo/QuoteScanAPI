import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import config from '@/config';
import { getIgnoredEmails, getIgnoredServices } from '@/lib/configurationService';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || String(config.DEFAULT_PAGE_SIZE));
  const offset = parseInt(searchParams.get('offset') || '0');
  const page = parseInt(searchParams.get('page') || '1');

  // Calculate offset from page if page is provided
  const calculatedOffset = searchParams.has('page') ? (page - 1) * limit : offset;

  const client = await pool.connect();
  try {
    // Get ignored emails and services from configuration
    const [ignoredEmails, ignoredServices] = await Promise.all([
      getIgnoredEmails(),
      getIgnoredServices(),
    ]);

    // Build dynamic query parts
    const params: unknown[] = [limit, calculatedOffset, config.MIN_EMAIL_DATE];
    let paramIndex = 4;

    let ignoredEmailsClause = '';
    if (ignoredEmails.length > 0) {
      ignoredEmailsClause = `AND LOWER(e.email_sender_email) != ALL($${paramIndex}::text[])`;
      params.push(ignoredEmails.map((e) => e.toLowerCase()));
      paramIndex++;
    }

    let ignoredServicesClause = '';
    if (ignoredServices.length > 0) {
      ignoredServicesClause = `AND NOT EXISTS (
        SELECT 1 FROM shipping_quotes sq
        WHERE sq.email_id = e.email_id
        AND UPPER(sq.service_type) = ANY($${paramIndex}::text[])
      )`;
      params.push(ignoredServices.map((s) => s.toUpperCase()));
      paramIndex++;
    }

    const result = await client.query(
      `SELECT
        e.*,
        COUNT(q.quote_id) as quote_count
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
      WHERE e.email_received_date >= $3
        ${ignoredEmailsClause}
        ${ignoredServicesClause}
      GROUP BY e.email_id
      ORDER BY e.email_received_date DESC
      LIMIT $1 OFFSET $2`,
      params
    );

    // Count query with same filters
    const countParams: unknown[] = [config.MIN_EMAIL_DATE];
    let countParamIndex = 2;

    let countIgnoredEmailsClause = '';
    if (ignoredEmails.length > 0) {
      countIgnoredEmailsClause = `AND LOWER(email_sender_email) != ALL($${countParamIndex}::text[])`;
      countParams.push(ignoredEmails.map((e) => e.toLowerCase()));
      countParamIndex++;
    }

    let countIgnoredServicesClause = '';
    if (ignoredServices.length > 0) {
      countIgnoredServicesClause = `AND NOT EXISTS (
        SELECT 1 FROM shipping_quotes sq
        WHERE sq.email_id = shipping_emails.email_id
        AND UPPER(sq.service_type) = ANY($${countParamIndex}::text[])
      )`;
      countParams.push(ignoredServices.map((s) => s.toUpperCase()));
      countParamIndex++;
    }

    const countResult = await client.query(
      `SELECT COUNT(*) FROM shipping_emails
       WHERE email_received_date >= $1
         ${countIgnoredEmailsClause}
         ${countIgnoredServicesClause}`,
      countParams
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
