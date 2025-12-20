import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import type { PoolClient } from 'pg';
import { getIgnoredEmails, getIgnoredServices } from '@/lib/configurationService';

const DEFAULT_PAGE_SIZE = 20;

// Helper to safely query a table (returns empty result if table doesn't exist)
async function safeQuery(
  client: PoolClient,
  query: string,
  params: unknown[] = []
) {
  try {
    return await client.query(query, params);
  } catch (error) {
    const pgError = error as { code?: string; message?: string };
    // Handle "relation does not exist" error
    if (pgError.code === '42P01') {
      console.warn('Table does not exist for query:', query.substring(0, 100));
      return { rows: [] };
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;
  const filterWithReplies = searchParams.get('withReplies') === 'true';

  const client = await pool.connect();
  try {
    // Get ignored emails and services from configuration
    const [ignoredEmails, ignoredServices] = await Promise.all([
      getIgnoredEmails(),
      getIgnoredServices(),
    ]);

    // Build filter clauses for ignored emails
    let ignoredEmailsClause = '';
    const ignoredEmailsParams: unknown[] = [];
    if (ignoredEmails.length > 0) {
      ignoredEmailsClause = 'AND LOWER(se.email_sender_email) != ALL($1::text[])';
      ignoredEmailsParams.push(ignoredEmails.map((e) => e.toLowerCase()));
    }

    // Build filter clauses for ignored services (used for quotes)
    let ignoredServicesClause = '';
    const ignoredServicesParams: unknown[] = [];
    if (ignoredServices.length > 0) {
      ignoredServicesClause = 'AND UPPER(service_type) != ALL($1::text[])';
      ignoredServicesParams.push(ignoredServices.map((s) => s.toUpperCase()));
    }

    // Get total count for pagination (with filters)
    const countParams: unknown[] = [];
    let countParamIndex = 1;
    let countEmailFilter = '';
    if (ignoredEmails.length > 0) {
      countEmailFilter = `WHERE LOWER(email_sender_email) != ALL($${countParamIndex}::text[])`;
      countParams.push(ignoredEmails.map((e) => e.toLowerCase()));
      countParamIndex++;
    }

    const countResult = await client.query(
      `SELECT COUNT(*) FROM shipping_emails ${countEmailFilter}`,
      countParams
    );
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    // Subquery for valid conversations (where first reply > first email)
    // Used when filterWithReplies is true
    const validConversationsSubquery = `
      SELECT first_emails.conversation_id, first_emails.email_id
      FROM (
        SELECT DISTINCT ON (conversation_id)
          conversation_id, email_id, email_received_date as first_email_date
        FROM shipping_emails
        WHERE conversation_id IS NOT NULL
        ORDER BY conversation_id, email_received_date ASC
      ) first_emails
      INNER JOIN (
        SELECT DISTINCT ON (conversation_id)
          conversation_id, received_date as first_reply_date
        FROM staff_replies
        WHERE conversation_id IS NOT NULL
        ORDER BY conversation_id, received_date ASC
      ) first_replies ON first_emails.conversation_id = first_replies.conversation_id
      WHERE first_replies.first_reply_date > first_emails.first_email_date
    `;

    // Statistics depend on filterWithReplies toggle:
    // - When filterWithReplies=true: count only valid conversations (reply after email)
    // - When filterWithReplies=false: count all emails/quotes grouped by conversation
    let emailStatsQuery;
    let quoteStatsQuery;

    if (filterWithReplies) {
      // Count valid conversations only (emails with valid replies)
      emailStatsQuery = ignoredEmails.length > 0
        ? client.query(
            `SELECT COUNT(*) as total_emails FROM (${validConversationsSubquery}) vc
             INNER JOIN shipping_emails se ON se.email_id = vc.email_id
             WHERE LOWER(se.email_sender_email) != ALL($1::text[])`,
            [ignoredEmails.map((e) => e.toLowerCase())]
          )
        : client.query(`SELECT COUNT(*) as total_emails FROM (${validConversationsSubquery}) vc`);

      // Count quotes from valid conversations only
      quoteStatsQuery = ignoredServices.length > 0
        ? client.query(`
            SELECT
              COUNT(*) as total_quotes,
              COUNT(*) FILTER (WHERE sq.quote_status = 'Pending') as pending_quotes,
              COUNT(*) FILTER (WHERE sq.quote_status = 'Approved') as approved_quotes,
              COUNT(*) FILTER (WHERE sq.quote_status = 'Rejected') as rejected_quotes,
              COUNT(*) FILTER (WHERE sq.job_won = true) as won_quotes
            FROM shipping_quotes sq
            INNER JOIN (${validConversationsSubquery}) vc ON sq.email_id = vc.email_id
            WHERE (sq.service_type IS NULL OR UPPER(sq.service_type) != ALL($1::text[]))
          `, [ignoredServices.map((s) => s.toUpperCase())])
        : client.query(`
            SELECT
              COUNT(*) as total_quotes,
              COUNT(*) FILTER (WHERE sq.quote_status = 'Pending') as pending_quotes,
              COUNT(*) FILTER (WHERE sq.quote_status = 'Approved') as approved_quotes,
              COUNT(*) FILTER (WHERE sq.quote_status = 'Rejected') as rejected_quotes,
              COUNT(*) FILTER (WHERE sq.job_won = true) as won_quotes
            FROM shipping_quotes sq
            INNER JOIN (${validConversationsSubquery}) vc ON sq.email_id = vc.email_id
          `);
    } else {
      // Count all unique conversations (first email per conversation)
      emailStatsQuery = ignoredEmails.length > 0
        ? client.query(
            `SELECT COUNT(DISTINCT COALESCE(conversation_id, email_id::text)) as total_emails
             FROM shipping_emails
             WHERE LOWER(email_sender_email) != ALL($1::text[])`,
            [ignoredEmails.map((e) => e.toLowerCase())]
          )
        : client.query(`SELECT COUNT(DISTINCT COALESCE(conversation_id, email_id::text)) as total_emails FROM shipping_emails`);

      // Count all quotes (with ignored services filter)
      quoteStatsQuery = ignoredServices.length > 0
        ? client.query(`
            SELECT
              COUNT(*) as total_quotes,
              COUNT(*) FILTER (WHERE quote_status = 'Pending') as pending_quotes,
              COUNT(*) FILTER (WHERE quote_status = 'Approved') as approved_quotes,
              COUNT(*) FILTER (WHERE quote_status = 'Rejected') as rejected_quotes,
              COUNT(*) FILTER (WHERE job_won = true) as won_quotes
            FROM shipping_quotes
            WHERE (service_type IS NULL OR UPPER(service_type) != ALL($1::text[]))
          `, [ignoredServices.map((s) => s.toUpperCase())])
        : client.query(`
            SELECT
              COUNT(*) as total_quotes,
              COUNT(*) FILTER (WHERE quote_status = 'Pending') as pending_quotes,
              COUNT(*) FILTER (WHERE quote_status = 'Approved') as approved_quotes,
              COUNT(*) FILTER (WHERE quote_status = 'Rejected') as rejected_quotes,
              COUNT(*) FILTER (WHERE job_won = true) as won_quotes
            FROM shipping_quotes
          `);
    }

    const [emailStatsResult, quoteStatsResult] = await Promise.all([
      emailStatsQuery,
      quoteStatsQuery,
    ]);

    // Try to get staff reply stats (tables may not exist)
    let totalStaffReplies = 0;
    let pricingReplies = 0;
    let emailsWithReplies = 0;

    try {
      // Filter staff replies by ignored emails
      const staffReplyQuery = ignoredEmails.length > 0
        ? `SELECT COUNT(*) as total_staff_replies FROM staff_replies WHERE LOWER(sender_email) != ALL($1::text[])`
        : 'SELECT COUNT(*) as total_staff_replies FROM staff_replies';
      const staffReplyParams = ignoredEmails.length > 0 ? [ignoredEmails.map((e) => e.toLowerCase())] : [];

      const staffReplyStatsResult = await safeQuery(client, staffReplyQuery, staffReplyParams);
      totalStaffReplies = parseInt(staffReplyStatsResult.rows[0]?.total_staff_replies) || 0;

      if (totalStaffReplies > 0) {
        // Count valid conversations with pricing replies (where first reply > first email)
        const pricingQuery = ignoredServices.length > 0
          ? `SELECT COUNT(DISTINCT valid_convs.conversation_id) as pricing_replies
             FROM (
               -- Get valid conversations (first reply after first email)
               SELECT first_emails.conversation_id
               FROM (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, email_received_date as first_email_date
                 FROM shipping_emails
                 WHERE conversation_id IS NOT NULL
                 ORDER BY conversation_id, email_received_date ASC
               ) first_emails
               INNER JOIN (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, received_date as first_reply_date
                 FROM staff_replies
                 WHERE conversation_id IS NOT NULL
                 ORDER BY conversation_id, received_date ASC
               ) first_replies ON first_emails.conversation_id = first_replies.conversation_id
               WHERE first_replies.first_reply_date > first_emails.first_email_date
             ) valid_convs
             INNER JOIN staff_replies sr ON sr.conversation_id = valid_convs.conversation_id
             INNER JOIN staff_quotes_replies sqr ON sqr.staff_reply_id = sr.reply_id
             WHERE sqr.is_pricing_email = true
               AND sqr.quoted_price IS NOT NULL
               AND UPPER(sqr.service_type) != ALL($1::text[])`
          : `SELECT COUNT(DISTINCT valid_convs.conversation_id) as pricing_replies
             FROM (
               -- Get valid conversations (first reply after first email)
               SELECT first_emails.conversation_id
               FROM (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, email_received_date as first_email_date
                 FROM shipping_emails
                 WHERE conversation_id IS NOT NULL
                 ORDER BY conversation_id, email_received_date ASC
               ) first_emails
               INNER JOIN (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, received_date as first_reply_date
                 FROM staff_replies
                 WHERE conversation_id IS NOT NULL
                 ORDER BY conversation_id, received_date ASC
               ) first_replies ON first_emails.conversation_id = first_replies.conversation_id
               WHERE first_replies.first_reply_date > first_emails.first_email_date
             ) valid_convs
             INNER JOIN staff_replies sr ON sr.conversation_id = valid_convs.conversation_id
             INNER JOIN staff_quotes_replies sqr ON sqr.staff_reply_id = sr.reply_id
             WHERE sqr.is_pricing_email = true
               AND sqr.quoted_price IS NOT NULL`;
        const pricingParams = ignoredServices.length > 0 ? [ignoredServices.map((s) => s.toUpperCase())] : [];

        const pricingResult = await safeQuery(client, pricingQuery, pricingParams);
        pricingReplies = parseInt(pricingResult.rows[0]?.pricing_replies) || 0;

        // Count valid conversations with replies (where first reply > first email)
        const emailsWithRepliesQuery = ignoredEmails.length > 0
          ? `SELECT COUNT(*) as count
             FROM (
               SELECT first_emails.conversation_id
               FROM (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, email_received_date as first_email_date
                 FROM shipping_emails
                 WHERE conversation_id IS NOT NULL
                   AND LOWER(email_sender_email) != ALL($1::text[])
                 ORDER BY conversation_id, email_received_date ASC
               ) first_emails
               INNER JOIN (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, received_date as first_reply_date
                 FROM staff_replies
                 WHERE conversation_id IS NOT NULL
                 ORDER BY conversation_id, received_date ASC
               ) first_replies ON first_emails.conversation_id = first_replies.conversation_id
               WHERE first_replies.first_reply_date > first_emails.first_email_date
             ) valid_conversations`
          : `SELECT COUNT(*) as count
             FROM (
               SELECT first_emails.conversation_id
               FROM (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, email_received_date as first_email_date
                 FROM shipping_emails
                 WHERE conversation_id IS NOT NULL
                 ORDER BY conversation_id, email_received_date ASC
               ) first_emails
               INNER JOIN (
                 SELECT DISTINCT ON (conversation_id)
                   conversation_id, received_date as first_reply_date
                 FROM staff_replies
                 WHERE conversation_id IS NOT NULL
                 ORDER BY conversation_id, received_date ASC
               ) first_replies ON first_emails.conversation_id = first_replies.conversation_id
               WHERE first_replies.first_reply_date > first_emails.first_email_date
             ) valid_conversations`;
        const emailsWithRepliesParams = ignoredEmails.length > 0 ? [ignoredEmails.map((e) => e.toLowerCase())] : [];

        const emailsWithRepliesResult = await safeQuery(client, emailsWithRepliesQuery, emailsWithRepliesParams);
        emailsWithReplies = parseInt(emailsWithRepliesResult.rows[0]?.count) || 0;
      }
    } catch (e) {
      console.warn('Staff reply stats query failed:', e);
    }

    // Service type distribution (filter ignored services)
    const serviceTypeQuery = ignoredServices.length > 0
      ? client.query(`
          SELECT service_type, COUNT(*)::int as count
          FROM shipping_quotes
          WHERE service_type IS NOT NULL
            AND UPPER(service_type) != ALL($1::text[])
          GROUP BY service_type
          ORDER BY count DESC
          LIMIT 10
        `, [ignoredServices.map((s) => s.toUpperCase())])
      : client.query(`
          SELECT service_type, COUNT(*)::int as count
          FROM shipping_quotes
          WHERE service_type IS NOT NULL
          GROUP BY service_type
          ORDER BY count DESC
          LIMIT 10
        `);
    const serviceTypeResult = await serviceTypeQuery;

    // Top senders (filter ignored emails)
    const topSendersQuery = ignoredEmails.length > 0
      ? client.query(`
          SELECT email_sender_email, email_sender_name, COUNT(*)::int as count
          FROM shipping_emails
          WHERE email_sender_email IS NOT NULL
            AND LOWER(email_sender_email) != ALL($1::text[])
          GROUP BY email_sender_email, email_sender_name
          ORDER BY count DESC
          LIMIT 10
        `, [ignoredEmails.map((e) => e.toLowerCase())])
      : client.query(`
          SELECT email_sender_email, email_sender_name, COUNT(*)::int as count
          FROM shipping_emails
          WHERE email_sender_email IS NOT NULL
          GROUP BY email_sender_email, email_sender_name
          ORDER BY count DESC
          LIMIT 10
        `);
    const topSendersResult = await topSendersQuery;

    // Emails by month (filter ignored emails)
    const emailsByMonthQuery = ignoredEmails.length > 0
      ? client.query(`
          SELECT
            TO_CHAR(email_received_date, 'YYYY-MM') as month,
            COUNT(*)::int as count
          FROM shipping_emails
          WHERE LOWER(email_sender_email) != ALL($1::text[])
          GROUP BY month
          ORDER BY month DESC
          LIMIT 12
        `, [ignoredEmails.map((e) => e.toLowerCase())])
      : client.query(`
          SELECT
            TO_CHAR(email_received_date, 'YYYY-MM') as month,
            COUNT(*)::int as count
          FROM shipping_emails
          GROUP BY month
          ORDER BY month DESC
          LIMIT 12
        `);
    const emailsByMonthResult = await emailsByMonthQuery;

    // Response time stats - only calculate for emails with valid replies
    // These stats are always based on valid conversations (reply after first email)
    let responseTimeDistribution: Array<{ range: string; count: number }> = [];
    let avgResponseMinutes = 0;

    if (totalStaffReplies > 0) {
      try {
        // Build ignored emails filter for response time queries
        const ignoredEmailsFilter = ignoredEmails.length > 0
          ? `AND LOWER(se.email_sender_email) != ALL($1::text[])`
          : '';
        const responseTimeParams = ignoredEmails.length > 0
          ? [ignoredEmails.map((e) => e.toLowerCase())]
          : [];

        // Response time calculation using conversation_id to link emails and replies
        // Join on conversation_id which both tables have
        const responseTimeQuery = `
          WITH first_emails AS (
            -- Get first email per conversation
            SELECT DISTINCT ON (se.conversation_id)
              se.conversation_id,
              se.email_received_date as first_email_date
            FROM shipping_emails se
            WHERE se.conversation_id IS NOT NULL
              ${ignoredEmailsFilter}
            ORDER BY se.conversation_id, se.email_received_date ASC
          ),
          first_replies AS (
            -- Get first staff reply per conversation
            SELECT DISTINCT ON (sr.conversation_id)
              sr.conversation_id,
              sr.received_date as first_reply_date
            FROM staff_replies sr
            WHERE sr.conversation_id IS NOT NULL
            ORDER BY sr.conversation_id, sr.received_date ASC
          ),
          response_times AS (
            SELECT
              fe.conversation_id,
              EXTRACT(EPOCH FROM (fr.first_reply_date - fe.first_email_date)) / 60 as response_minutes,
              EXTRACT(EPOCH FROM (fr.first_reply_date - fe.first_email_date)) / 3600 as response_hours
            FROM first_emails fe
            INNER JOIN first_replies fr ON fe.conversation_id = fr.conversation_id
            WHERE fr.first_reply_date > fe.first_email_date
          )
        `;

        // Response time distribution - use subquery to allow GROUP BY on alias
        const responseTimeResult = await safeQuery(
          client,
          `${responseTimeQuery}
          SELECT time_range, COUNT(*)::int as count
          FROM (
            SELECT
              CASE
                WHEN response_hours <= 1 THEN '< 1 hour'
                WHEN response_hours <= 4 THEN '1-4 hours'
                WHEN response_hours <= 24 THEN '4-24 hours'
                WHEN response_hours <= 48 THEN '1-2 days'
                ELSE '> 2 days'
              END as time_range
            FROM response_times
            WHERE response_hours > 0
          ) categorized
          GROUP BY time_range
          ORDER BY
            CASE time_range
              WHEN '< 1 hour' THEN 1
              WHEN '1-4 hours' THEN 2
              WHEN '4-24 hours' THEN 3
              WHEN '1-2 days' THEN 4
              ELSE 5
            END`,
          responseTimeParams
        );
        // Map time_range back to range for consistency with frontend
        responseTimeDistribution = responseTimeResult.rows.map((r: { time_range: string; count: number }) => ({
          range: r.time_range,
          count: r.count,
        }));

        // Calculate average response time - remove the upper bound filter to see if data exists
        const avgResult = await safeQuery(
          client,
          `${responseTimeQuery}
          SELECT
            COALESCE(ROUND(AVG(response_minutes)::numeric, 0)::int, 0) as avg,
            COUNT(*) as total_count
          FROM response_times
          WHERE response_minutes > 0`,
          responseTimeParams
        );

        console.log('Avg response query result:', avgResult.rows[0]);
        avgResponseMinutes = avgResult.rows[0]?.avg || 0;
      } catch (e) {
        console.error('Response time query failed:', e);
      }
    }

    const emailStats = emailStatsResult.rows[0];
    const quoteStats = quoteStatsResult.rows[0];

    // Build email query based on filter (with ignored emails/services filtering)
    let emailsQuery: string;
    let emailsParams: unknown[];
    let countQuery: string;
    let countQueryParams: unknown[];

    // Build ignored emails filter params
    const ignoredEmailFilterParams: unknown[] = ignoredEmails.length > 0
      ? [ignoredEmails.map((e) => e.toLowerCase())]
      : [];

    if (filterWithReplies && totalStaffReplies > 0) {
      // Filter to only show FIRST email per conversation where reply came AFTER the first email
      // This excludes "Reply before email" cases
      emailsQuery = `
        SELECT
          se.email_id,
          se.email_message_id,
          se.conversation_id,
          se.email_subject,
          se.email_received_date,
          se.email_sender_name,
          se.email_sender_email,
          se.email_body_preview,
          se.email_has_attachments
        FROM shipping_emails se
        INNER JOIN (
          -- Get first email per conversation where first reply is AFTER first email
          SELECT first_emails.email_id
          FROM (
            -- Get the first email for each conversation
            SELECT DISTINCT ON (COALESCE(se2.conversation_id, se2.email_id::text))
              se2.email_id,
              se2.conversation_id,
              se2.email_received_date as first_email_date
            FROM shipping_emails se2
            WHERE se2.conversation_id IS NOT NULL
              ${ignoredEmails.length > 0 ? `AND LOWER(se2.email_sender_email) != ALL($3::text[])` : ''}
            ORDER BY COALESCE(se2.conversation_id, se2.email_id::text), se2.email_received_date ASC
          ) first_emails
          INNER JOIN (
            -- Get the first staff reply for each conversation
            SELECT DISTINCT ON (conversation_id)
              conversation_id,
              received_date as first_reply_date
            FROM staff_replies
            WHERE conversation_id IS NOT NULL
            ORDER BY conversation_id, received_date ASC
          ) first_replies ON first_emails.conversation_id = first_replies.conversation_id
          WHERE first_replies.first_reply_date > first_emails.first_email_date
        ) valid_emails ON se.email_id = valid_emails.email_id
        ORDER BY se.email_received_date DESC
        LIMIT $1 OFFSET $2`;
      emailsParams = [limit, offset, ...ignoredEmailFilterParams];
      countQuery = `
        SELECT COUNT(*)
        FROM (
          -- Get first email per conversation where first reply is AFTER first email
          SELECT first_emails.email_id
          FROM (
            -- Get the first email for each conversation
            SELECT DISTINCT ON (COALESCE(se.conversation_id, se.email_id::text))
              se.email_id,
              se.conversation_id,
              se.email_received_date as first_email_date
            FROM shipping_emails se
            WHERE se.conversation_id IS NOT NULL
              ${ignoredEmails.length > 0 ? `AND LOWER(se.email_sender_email) != ALL($1::text[])` : ''}
            ORDER BY COALESCE(se.conversation_id, se.email_id::text), se.email_received_date ASC
          ) first_emails
          INNER JOIN (
            -- Get the first staff reply for each conversation
            SELECT DISTINCT ON (conversation_id)
              conversation_id,
              received_date as first_reply_date
            FROM staff_replies
            WHERE conversation_id IS NOT NULL
            ORDER BY conversation_id, received_date ASC
          ) first_replies ON first_emails.conversation_id = first_replies.conversation_id
          WHERE first_replies.first_reply_date > first_emails.first_email_date
        ) valid_conversations`;
      countQueryParams = ignoredEmails.length > 0 ? [ignoredEmails.map((e) => e.toLowerCase())] : [];
    } else {
      // Show FIRST email per conversation (group by conversation_id)
      emailsQuery = `
        SELECT
          se.email_id,
          se.email_message_id,
          se.conversation_id,
          se.email_subject,
          se.email_received_date,
          se.email_sender_name,
          se.email_sender_email,
          se.email_body_preview,
          se.email_has_attachments
        FROM shipping_emails se
        INNER JOIN (
          -- Get the first email_id for each conversation
          SELECT DISTINCT ON (COALESCE(conversation_id, email_id::text))
            email_id
          FROM shipping_emails
          WHERE 1=1
            ${ignoredEmails.length > 0 ? `AND LOWER(email_sender_email) != ALL($3::text[])` : ''}
          ORDER BY COALESCE(conversation_id, email_id::text), email_received_date ASC
        ) first_emails ON se.email_id = first_emails.email_id
        ORDER BY se.email_received_date DESC
        LIMIT $1 OFFSET $2`;
      emailsParams = [limit, offset, ...ignoredEmailFilterParams];
      countQuery = `SELECT COUNT(DISTINCT COALESCE(conversation_id, email_id::text)) FROM shipping_emails
        ${ignoredEmails.length > 0 ? 'WHERE LOWER(email_sender_email) != ALL($1::text[])' : ''}`;
      countQueryParams = ignoredEmails.length > 0 ? [ignoredEmails.map((e) => e.toLowerCase())] : [];
    }

    // Get filtered count for pagination
    const filteredCountResult = filterWithReplies && totalStaffReplies > 0
      ? await safeQuery(client, countQuery, countQueryParams)
      : await safeQuery(client, countQuery, countQueryParams);
    const filteredTotalCount = parseInt(filteredCountResult.rows[0]?.count) || totalCount;
    const filteredTotalPages = Math.ceil(filteredTotalCount / limit);

    // Get paginated shipping emails
    const emailsResult = filterWithReplies && totalStaffReplies > 0
      ? await safeQuery(client, emailsQuery, emailsParams)
      : await client.query(emailsQuery, emailsParams);

    // Get quotes for these emails
    const emailIds = emailsResult.rows.map((e) => e.email_id);

    // Get the first email date for each conversation (to calculate response time correctly)
    const conversationIds = emailsResult.rows
      .map((e) => e.conversation_id)
      .filter((id): id is string => id !== null);

    let firstEmailDateMap = new Map<string, Date>();
    if (conversationIds.length > 0) {
      const firstEmailDatesResult = await client.query(
        `SELECT
          conversation_id,
          MIN(email_received_date) as first_email_date
        FROM shipping_emails
        WHERE conversation_id = ANY($1::text[])
        GROUP BY conversation_id`,
        [conversationIds]
      );
      for (const row of firstEmailDatesResult.rows) {
        firstEmailDateMap.set(row.conversation_id, new Date(row.first_email_date));
      }
    }
    let quotesMap = new Map<number, Array<Record<string, unknown>>>();

    if (emailIds.length > 0) {
      // Filter out ignored services from quotes
      const quotesQuery = ignoredServices.length > 0
        ? `SELECT
            quote_id,
            email_id,
            client_company_name,
            origin_city,
            origin_country,
            destination_city,
            destination_country,
            cargo_description,
            cargo_weight,
            weight_unit,
            service_type,
            initial_quote_amount,
            final_agreed_price,
            quote_status,
            created_at as quote_created_at
          FROM shipping_quotes
          WHERE email_id = ANY($1::int[])
            AND (service_type IS NULL OR UPPER(service_type) != ALL($2::text[]))`
        : `SELECT
            quote_id,
            email_id,
            client_company_name,
            origin_city,
            origin_country,
            destination_city,
            destination_country,
            cargo_description,
            cargo_weight,
            weight_unit,
            service_type,
            initial_quote_amount,
            final_agreed_price,
            quote_status,
            created_at as quote_created_at
          FROM shipping_quotes
          WHERE email_id = ANY($1::int[])`;

      const quotesParams = ignoredServices.length > 0
        ? [emailIds, ignoredServices.map((s) => s.toUpperCase())]
        : [emailIds];

      const quotesResult = await client.query(quotesQuery, quotesParams);

      for (const quote of quotesResult.rows) {
        const emailQuotes = quotesMap.get(quote.email_id) || [];
        emailQuotes.push(quote);
        quotesMap.set(quote.email_id, emailQuotes);
      }
    }

    // Get staff replies for these emails (if table exists)
    // Only get the FIRST staff reply per conversation that has pricing
    let staffRepliesMap = new Map<number, Array<Record<string, unknown>>>();

    if (totalStaffReplies > 0 && emailIds.length > 0) {
      try {
        const conversationIds = emailsResult.rows
          .map((e) => e.conversation_id)
          .filter((id): id is string => id !== null);

        // Get only the first staff reply per conversation (ordered by received_date)
        const staffRepliesResult = await safeQuery(
          client,
          `SELECT DISTINCT ON (COALESCE(sr.conversation_id, sr.original_email_id::text))
            sr.reply_id,
            sr.email_message_id,
            sr.conversation_id,
            sr.original_email_id,
            sr.sender_name as staff_sender_name,
            sr.sender_email as staff_sender_email,
            sr.subject as staff_subject,
            sr.body_preview as staff_body_preview,
            sr.received_date as staff_received_date,
            sr.has_attachments as staff_has_attachments
          FROM staff_replies sr
          WHERE sr.conversation_id = ANY($1::text[])
             OR sr.original_email_id = ANY($2::int[])
          ORDER BY COALESCE(sr.conversation_id, sr.original_email_id::text), sr.received_date ASC`,
          [conversationIds, emailIds]
        );

        console.log('Staff replies found:', staffRepliesResult.rows.length);
        console.log('Conversation IDs searched:', conversationIds.length);
        console.log('Email IDs searched:', emailIds.length);
        console.log('Sample conversation IDs:', conversationIds.slice(0, 3));
        console.log('Sample email IDs:', emailIds.slice(0, 3));

        // Debug: check if there are any staff_replies for these conversations
        if (staffRepliesResult.rows.length === 0 && conversationIds.length > 0) {
          const debugResult = await safeQuery(
            client,
            `SELECT conversation_id, COUNT(*) as cnt FROM staff_replies WHERE conversation_id IS NOT NULL GROUP BY conversation_id LIMIT 5`
          );
          console.log('Sample staff_replies conversation_ids:', debugResult.rows);

          // Check if any of our conversation_ids exist in staff_replies at all
          const matchCheck = await safeQuery(
            client,
            `SELECT COUNT(*) as matching FROM staff_replies WHERE conversation_id = ANY($1::text[])`,
            [conversationIds]
          );
          console.log('Matching staff_replies for our conversations:', matchCheck.rows[0]);
        }

        // Get pricing replies for staff replies - only those with pricing info
        const replyIds = staffRepliesResult.rows.map((r) => r.reply_id);
        let pricingRepliesMap = new Map<number, Array<Record<string, unknown>>>();

        if (replyIds.length > 0) {
          // Filter out ignored services and only get pricing emails with actual prices
          const pricingQuery = ignoredServices.length > 0
            ? `SELECT
                id as staff_quote_reply_id,
                staff_reply_id,
                is_pricing_email,
                confidence_score,
                quoted_price,
                currency,
                price_type,
                CONCAT_WS(', ', origin_city, origin_state, origin_country) as origin,
                CONCAT_WS(', ', destination_city, destination_state, destination_country) as destination,
                service_type,
                cargo_description,
                cargo_weight,
                weight_unit,
                transit_time,
                notes
              FROM staff_quotes_replies
              WHERE staff_reply_id = ANY($1::int[])
                AND is_pricing_email = true
                AND quoted_price IS NOT NULL
                AND (service_type IS NULL OR UPPER(service_type) != ALL($2::text[]))`
            : `SELECT
                id as staff_quote_reply_id,
                staff_reply_id,
                is_pricing_email,
                confidence_score,
                quoted_price,
                currency,
                price_type,
                CONCAT_WS(', ', origin_city, origin_state, origin_country) as origin,
                CONCAT_WS(', ', destination_city, destination_state, destination_country) as destination,
                service_type,
                cargo_description,
                cargo_weight,
                weight_unit,
                transit_time,
                notes
              FROM staff_quotes_replies
              WHERE staff_reply_id = ANY($1::int[])
                AND is_pricing_email = true
                AND quoted_price IS NOT NULL`;

          const pricingParams = ignoredServices.length > 0
            ? [replyIds, ignoredServices.map((s) => s.toUpperCase())]
            : [replyIds];

          const pricingResult = await safeQuery(client, pricingQuery, pricingParams);

          for (const pr of pricingResult.rows) {
            const replyPricing = pricingRepliesMap.get(pr.staff_reply_id) || [];
            replyPricing.push(pr);
            pricingRepliesMap.set(pr.staff_reply_id, replyPricing);
          }
        }

        // Map staff replies to emails (only first reply per conversation)
        for (const reply of staffRepliesResult.rows) {
          const replyWithPricing = {
            ...reply,
            pricing_replies: pricingRepliesMap.get(reply.reply_id) || [],
          };

          // Find matching email by conversation_id or original_email_id
          for (const email of emailsResult.rows) {
            if (
              reply.conversation_id === email.conversation_id ||
              reply.original_email_id === email.email_id
            ) {
              const emailReplies = staffRepliesMap.get(email.email_id) || [];
              emailReplies.push(replyWithPricing);
              staffRepliesMap.set(email.email_id, emailReplies);
            }
          }
        }
      } catch (e) {
        console.warn('Staff replies query failed:', e);
      }
    }

    // Build final email objects with stats
    const emailsWithStats = emailsResult.rows.map((email) => {
      const staffReplies = staffRepliesMap.get(email.email_id) || [];

      // Use the first email date in the conversation, not the displayed email's date
      // This prevents "Reply before email" when a later email in conversation is displayed
      const firstEmailInConversation = email.conversation_id
        ? firstEmailDateMap.get(email.conversation_id)
        : null;
      // Use first email in conversation if available, otherwise use displayed email's date
      const baseEmailDate = firstEmailInConversation || new Date(email.email_received_date);

      let responseTimeMinutes: number | null = null;
      let firstReplyDateStr: string | null = null;

      if (staffReplies.length > 0) {
        // Filter replies that actually belong to this conversation
        // and have a valid received date AFTER the first email
        const validReplies = staffReplies
          .filter((r) => {
            if (!r.staff_received_date) return false;
            const replyDate = new Date(r.staff_received_date as string);
            // Only include replies that came AFTER the first email in conversation
            return replyDate.getTime() > baseEmailDate.getTime();
          })
          .map((r) => new Date(r.staff_received_date as string))
          .sort((a, b) => a.getTime() - b.getTime());

        const firstReply = validReplies[0];
        if (firstReply) {
          firstReplyDateStr = firstReply.toISOString();
          responseTimeMinutes = Math.round(
            (firstReply.getTime() - baseEmailDate.getTime()) / (1000 * 60)
          );
        }
      }

      return {
        ...email,
        quotes: quotesMap.get(email.email_id) || [],
        staff_replies: staffReplies,
        response_time_minutes: responseTimeMinutes,
        first_reply_date: firstReplyDateStr,
      };
    });

    // Calculate average response time from the displayed emails with valid response times
    const emailsWithValidResponseTime = emailsWithStats.filter(
      (e) => e.response_time_minutes !== null && e.response_time_minutes > 0
    );

    // Log for debugging
    console.log('Emails with valid response time on current page:', emailsWithValidResponseTime.length);
    console.log('Sample response times:', emailsWithValidResponseTime.slice(0, 3).map(e => e.response_time_minutes));

    // Calculate from current page emails as primary source (ensures consistency with displayed data)
    let calculatedAvgResponse = 0;
    if (emailsWithValidResponseTime.length > 0) {
      const totalResponseMinutes = emailsWithValidResponseTime.reduce(
        (sum, e) => sum + (e.response_time_minutes || 0),
        0
      );
      calculatedAvgResponse = Math.round(totalResponseMinutes / emailsWithValidResponseTime.length);
    }

    // Build response time distribution from displayed emails
    const responseTimeFromEmails: Record<string, number> = {
      '< 1 hour': 0,
      '1-4 hours': 0,
      '4-24 hours': 0,
      '1-2 days': 0,
      '> 2 days': 0,
    };
    emailsWithValidResponseTime.forEach((e) => {
      const hours = (e.response_time_minutes || 0) / 60;
      if (hours <= 1) responseTimeFromEmails['< 1 hour']++;
      else if (hours <= 4) responseTimeFromEmails['1-4 hours']++;
      else if (hours <= 24) responseTimeFromEmails['4-24 hours']++;
      else if (hours <= 48) responseTimeFromEmails['1-2 days']++;
      else responseTimeFromEmails['> 2 days']++;
    });
    const calculatedDistribution = Object.entries(responseTimeFromEmails)
      .filter(([, count]) => count > 0)
      .map(([range, count]) => ({ range, count }));

    // Prefer SQL query result for full dataset stats, fall back to page calculation
    // If SQL returned data, use it; otherwise use what we calculated from displayed emails
    const finalAvgResponse = avgResponseMinutes > 0 ? avgResponseMinutes : calculatedAvgResponse;
    const finalDistribution = responseTimeDistribution.length > 0 ? responseTimeDistribution : calculatedDistribution;

    console.log('Final avg response:', finalAvgResponse, '(SQL:', avgResponseMinutes, ', calculated:', calculatedAvgResponse, ')');

    return NextResponse.json({
      emails: emailsWithStats,
      totalCount: filteredTotalCount,
      totalPages: filteredTotalPages,
      currentPage: page,
      limit,
      filterWithReplies,
      statistics: {
        totalEmails: parseInt(emailStats.total_emails) || 0,
        emailsWithReplies: emailsWithReplies,
        totalQuotes: parseInt(quoteStats.total_quotes) || 0,
        pendingQuotes: parseInt(quoteStats.pending_quotes) || 0,
        approvedQuotes: parseInt(quoteStats.approved_quotes) || 0,
        rejectedQuotes: parseInt(quoteStats.rejected_quotes) || 0,
        wonQuotes: parseInt(quoteStats.won_quotes) || 0,
        totalStaffReplies: totalStaffReplies,
        pricingReplies: pricingReplies,
        avgResponseMinutes: finalAvgResponse,
        serviceTypeDistribution: serviceTypeResult.rows || [],
        responseTimeDistribution: finalDistribution,
        topSenders: topSendersResult.rows || [],
        emailsByMonth: emailsByMonthResult.rows || [],
      },
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch dashboard data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
