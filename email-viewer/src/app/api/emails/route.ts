import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import config from '@/config';
import { getIgnoredEmails, getIgnoredServices } from '@/lib/configurationService';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || String(config.DEFAULT_PAGE_SIZE));
  const offset = parseInt(searchParams.get('offset') || '0');
  const page = parseInt(searchParams.get('page') || '1');

  // Service type filter - comma-separated list of service types to include
  const serviceFilter = searchParams.get('services');
  const serviceTypes = serviceFilter ? serviceFilter.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];

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

    // Service type filter - only include emails with quotes matching these service types
    let serviceFilterClause = '';
    if (serviceTypes.length > 0) {
      serviceFilterClause = `AND EXISTS (
        SELECT 1 FROM shipping_quotes sq
        WHERE sq.email_id = e.email_id
        AND UPPER(sq.service_type) = ANY($${paramIndex}::text[])
      )`;
      params.push(serviceTypes);
      paramIndex++;
    }

    // Exclude emails that have feedback on their quotes
    const noFeedbackClause = `AND NOT EXISTS (
      SELECT 1 FROM shipping_quotes sq
      INNER JOIN ai_pricing_recommendations apr ON apr.quote_id = sq.quote_id
      INNER JOIN quote_ai_price_feedback f ON f.ai_price_id = apr.id
      WHERE sq.email_id = e.email_id
    )`;

    // Exclude emails that have priced staff quote replies
    const noPricedStaffQuoteClause = `AND NOT EXISTS (
      SELECT 1 FROM staff_replies sr
      INNER JOIN staff_quotes_replies sqr ON sqr.staff_reply_id = sr.reply_id
      WHERE sr.original_email_id = e.email_id
      AND sqr.is_pricing_email = true
      AND sqr.quoted_price IS NOT NULL
    )`;

    const result = await client.query(
      `SELECT
        e.*,
        COUNT(q.quote_id) as quote_count
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
      WHERE e.email_received_date >= $3
        ${ignoredEmailsClause}
        ${ignoredServicesClause}
        ${serviceFilterClause}
        ${noFeedbackClause}
        ${noPricedStaffQuoteClause}
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

    let countServiceFilterClause = '';
    if (serviceTypes.length > 0) {
      countServiceFilterClause = `AND EXISTS (
        SELECT 1 FROM shipping_quotes sq
        WHERE sq.email_id = shipping_emails.email_id
        AND UPPER(sq.service_type) = ANY($${countParamIndex}::text[])
      )`;
      countParams.push(serviceTypes);
      countParamIndex++;
    }

    // Exclude emails that have feedback on their quotes (for count)
    const countNoFeedbackClause = `AND NOT EXISTS (
      SELECT 1 FROM shipping_quotes sq
      INNER JOIN ai_pricing_recommendations apr ON apr.quote_id = sq.quote_id
      INNER JOIN quote_ai_price_feedback f ON f.ai_price_id = apr.id
      WHERE sq.email_id = shipping_emails.email_id
    )`;

    // Exclude emails that have priced staff quote replies (for count)
    const countNoPricedStaffQuoteClause = `AND NOT EXISTS (
      SELECT 1 FROM staff_replies sr
      INNER JOIN staff_quotes_replies sqr ON sqr.staff_reply_id = sr.reply_id
      WHERE sr.original_email_id = shipping_emails.email_id
      AND sqr.is_pricing_email = true
      AND sqr.quoted_price IS NOT NULL
    )`;

    const countResult = await client.query(
      `SELECT COUNT(*) FROM shipping_emails
       WHERE email_received_date >= $1
         ${countIgnoredEmailsClause}
         ${countIgnoredServicesClause}
         ${countServiceFilterClause}
         ${countNoFeedbackClause}
         ${countNoPricedStaffQuoteClause}`,
      countParams
    );
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    // Fetch available service types for the filter dropdown (excluding ignored services)
    const serviceTypesParams: string[] = [];
    let serviceTypesQuery = `SELECT DISTINCT UPPER(service_type) as service_type, COUNT(*) as count
       FROM shipping_quotes
       WHERE service_type IS NOT NULL AND service_type != ''`;

    if (ignoredServices.length > 0) {
      serviceTypesQuery += ` AND UPPER(service_type) != ALL($1::text[])`;
      serviceTypesParams.push(...ignoredServices.map(s => s.toUpperCase()));
    }

    serviceTypesQuery += ` GROUP BY UPPER(service_type) ORDER BY count DESC`;

    const serviceTypesResult = await client.query(
      serviceTypesQuery,
      ignoredServices.length > 0 ? [serviceTypesParams] : []
    );

    return NextResponse.json({
      emails: result.rows,
      totalCount,
      totalPages,
      currentPage: searchParams.has('page') ? page : Math.floor(calculatedOffset / limit) + 1,
      limit,
      offset: calculatedOffset,
      minDate: config.MIN_EMAIL_DATE,
      availableServiceTypes: serviceTypesResult.rows.map(r => r.service_type),
      activeServiceFilter: serviceTypes,
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 });
  } finally {
    client.release();
  }
}
