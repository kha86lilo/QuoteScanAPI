import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import type { PoolClient } from 'pg';

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
    // Get total count for pagination
    const countResult = await client.query('SELECT COUNT(*) FROM shipping_emails');
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    // Get basic statistics with separate queries to avoid complex subquery issues
    // Run statistics queries in parallel
    const [emailStatsResult, quoteStatsResult] = await Promise.all([
      // Email count
      client.query('SELECT COUNT(*) as total_emails FROM shipping_emails'),
      // Quote stats
      client.query(`
        SELECT
          COUNT(*) as total_quotes,
          COUNT(*) FILTER (WHERE quote_status = 'Pending') as pending_quotes,
          COUNT(*) FILTER (WHERE quote_status = 'Approved') as approved_quotes,
          COUNT(*) FILTER (WHERE quote_status = 'Rejected') as rejected_quotes,
          COUNT(*) FILTER (WHERE job_won = true) as won_quotes
        FROM shipping_quotes
      `),
    ]);

    // Try to get staff reply stats (tables may not exist)
    let totalStaffReplies = 0;
    let pricingReplies = 0;
    let emailsWithReplies = 0;

    try {
      const staffReplyStatsResult = await safeQuery(
        client,
        'SELECT COUNT(*) as total_staff_replies FROM staff_replies'
      );
      totalStaffReplies = parseInt(staffReplyStatsResult.rows[0]?.total_staff_replies) || 0;

      if (totalStaffReplies > 0) {
        const pricingResult = await safeQuery(
          client,
          'SELECT COUNT(*) as pricing_replies FROM staff_quotes_replies WHERE is_pricing_email = true'
        );
        pricingReplies = parseInt(pricingResult.rows[0]?.pricing_replies) || 0;

        const emailsWithRepliesResult = await safeQuery(
          client,
          `SELECT COUNT(DISTINCT se.email_id) as count
           FROM shipping_emails se
           INNER JOIN staff_replies sr ON sr.conversation_id = se.conversation_id
              OR sr.original_email_id = se.email_id`
        );
        emailsWithReplies = parseInt(emailsWithRepliesResult.rows[0]?.count) || 0;
      }
    } catch (e) {
      console.warn('Staff reply stats query failed:', e);
    }

    // Service type distribution
    const serviceTypeResult = await client.query(`
      SELECT service_type, COUNT(*)::int as count
      FROM shipping_quotes
      WHERE service_type IS NOT NULL
      GROUP BY service_type
      ORDER BY count DESC
      LIMIT 10
    `);

    // Top senders
    const topSendersResult = await client.query(`
      SELECT email_sender_email, email_sender_name, COUNT(*)::int as count
      FROM shipping_emails
      WHERE email_sender_email IS NOT NULL
      GROUP BY email_sender_email, email_sender_name
      ORDER BY count DESC
      LIMIT 10
    `);

    // Emails by month
    const emailsByMonthResult = await client.query(`
      SELECT
        TO_CHAR(email_received_date, 'YYYY-MM') as month,
        COUNT(*)::int as count
      FROM shipping_emails
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `);

    // Response time stats (separate query due to complexity - skip if no staff_replies)
    let responseTimeDistribution: Array<{ range: string; count: number }> = [];
    let avgResponseMinutes = 0;

    if (totalStaffReplies > 0) {
      try {
        const responseTimeResult = await safeQuery(
          client,
          `SELECT
            CASE
              WHEN response_hours <= 1 THEN '< 1 hour'
              WHEN response_hours <= 4 THEN '1-4 hours'
              WHEN response_hours <= 24 THEN '4-24 hours'
              WHEN response_hours <= 48 THEN '1-2 days'
              ELSE '> 2 days'
            END as range,
            COUNT(*)::int as count
          FROM (
            SELECT
              EXTRACT(EPOCH FROM (sr.received_date - se.email_received_date)) / 3600 as response_hours
            FROM shipping_emails se
            INNER JOIN staff_replies sr ON (
              sr.conversation_id = se.conversation_id
              OR sr.original_email_id = se.email_id
            )
            WHERE sr.received_date > se.email_received_date
          ) response_times
          GROUP BY range
          ORDER BY
            CASE range
              WHEN '< 1 hour' THEN 1
              WHEN '1-4 hours' THEN 2
              WHEN '4-24 hours' THEN 3
              WHEN '1-2 days' THEN 4
              ELSE 5
            END`
        );
        responseTimeDistribution = responseTimeResult.rows;

        const avgResult = await safeQuery(
          client,
          `SELECT COALESCE(ROUND(AVG(response_minutes)::numeric, 0)::int, 0) as avg
          FROM (
            SELECT
              EXTRACT(EPOCH FROM (sr.received_date - se.email_received_date)) / 60 as response_minutes
            FROM shipping_emails se
            INNER JOIN staff_replies sr ON (
              sr.conversation_id = se.conversation_id
              OR sr.original_email_id = se.email_id
            )
            WHERE sr.received_date > se.email_received_date
              AND EXTRACT(EPOCH FROM (sr.received_date - se.email_received_date)) / 60 < 10080
          ) rt`
        );
        avgResponseMinutes = avgResult.rows[0]?.avg || 0;
      } catch (e) {
        console.warn('Response time query failed:', e);
      }
    }

    const emailStats = emailStatsResult.rows[0];
    const quoteStats = quoteStatsResult.rows[0];

    // Build email query based on filter
    let emailsQuery: string;
    let emailsParams: unknown[];
    let countQuery: string;

    if (filterWithReplies && totalStaffReplies > 0) {
      // Filter to only show emails with staff replies
      emailsQuery = `
        SELECT DISTINCT
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
        INNER JOIN staff_replies sr ON (
          sr.conversation_id = se.conversation_id
          OR sr.original_email_id = se.email_id
        )
        ORDER BY se.email_received_date DESC
        LIMIT $1 OFFSET $2`;
      emailsParams = [limit, offset];
      countQuery = `
        SELECT COUNT(DISTINCT se.email_id)
        FROM shipping_emails se
        INNER JOIN staff_replies sr ON (
          sr.conversation_id = se.conversation_id
          OR sr.original_email_id = se.email_id
        )`;
    } else {
      // Show all emails
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
        ORDER BY se.email_received_date DESC
        LIMIT $1 OFFSET $2`;
      emailsParams = [limit, offset];
      countQuery = 'SELECT COUNT(*) FROM shipping_emails';
    }

    // Get filtered count for pagination
    const filteredCountResult = filterWithReplies && totalStaffReplies > 0
      ? await safeQuery(client, countQuery)
      : { rows: [{ count: totalCount }] };
    const filteredTotalCount = parseInt(filteredCountResult.rows[0]?.count) || totalCount;
    const filteredTotalPages = Math.ceil(filteredTotalCount / limit);

    // Get paginated shipping emails
    const emailsResult = filterWithReplies && totalStaffReplies > 0
      ? await safeQuery(client, emailsQuery, emailsParams)
      : await client.query(emailsQuery, emailsParams);

    // Get quotes for these emails
    const emailIds = emailsResult.rows.map((e) => e.email_id);
    let quotesMap = new Map<number, Array<Record<string, unknown>>>();

    if (emailIds.length > 0) {
      const quotesResult = await client.query(
        `SELECT
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
        WHERE email_id = ANY($1::int[])`,
        [emailIds]
      );

      for (const quote of quotesResult.rows) {
        const emailQuotes = quotesMap.get(quote.email_id) || [];
        emailQuotes.push(quote);
        quotesMap.set(quote.email_id, emailQuotes);
      }
    }

    // Get staff replies for these emails (if table exists)
    let staffRepliesMap = new Map<number, Array<Record<string, unknown>>>();

    if (totalStaffReplies > 0 && emailIds.length > 0) {
      try {
        const conversationIds = emailsResult.rows
          .map((e) => e.conversation_id)
          .filter((id): id is string => id !== null);

        const staffRepliesResult = await safeQuery(
          client,
          `SELECT
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
             OR sr.original_email_id = ANY($2::int[])`,
          [conversationIds, emailIds]
        );

        // Get pricing replies for staff replies
        const replyIds = staffRepliesResult.rows.map((r) => r.reply_id);
        let pricingRepliesMap = new Map<number, Array<Record<string, unknown>>>();

        if (replyIds.length > 0) {
          const pricingResult = await safeQuery(
            client,
            `SELECT
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
            WHERE staff_reply_id = ANY($1::int[])`,
            [replyIds]
          );

          for (const pr of pricingResult.rows) {
            const replyPricing = pricingRepliesMap.get(pr.staff_reply_id) || [];
            replyPricing.push(pr);
            pricingRepliesMap.set(pr.staff_reply_id, replyPricing);
          }
        }

        // Map staff replies to emails
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
      const emailReceivedDate = new Date(email.email_received_date);

      let responseTimeMinutes: number | null = null;
      let firstReplyDateStr: string | null = null;

      if (staffReplies.length > 0) {
        const validReplies = staffReplies
          .filter((r) => r.staff_received_date)
          .map((r) => new Date(r.staff_received_date as string))
          .sort((a, b) => a.getTime() - b.getTime());

        const firstReply = validReplies[0];
        if (firstReply) {
          firstReplyDateStr = firstReply.toISOString();
          responseTimeMinutes = Math.round(
            (firstReply.getTime() - emailReceivedDate.getTime()) / (1000 * 60)
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
        avgResponseMinutes: avgResponseMinutes,
        serviceTypeDistribution: serviceTypeResult.rows || [],
        responseTimeDistribution: responseTimeDistribution || [],
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
