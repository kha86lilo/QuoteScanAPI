/**
 * Database Configuration and Connection Pool
 * PostgreSQL connection for Supabase
 */

import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
import type {
  Email,
  ParsedEmailData,
  Quote,
  QuoteWithEmail,
  Job,
  JobStatistics,
  ProcessingStats,
  ShippingEmail,
  QuoteMatch,
  MatchFeedback,
  FeedbackStatistics,
  FeedbackByReason,
  CriteriaPerformance,
  DatabaseSaveResult,
  Spammer,
  MatchCriteria,
  AIPricingDetails,
  StaffReply,
  StaffQuoteReply,
  PricingReplyResult,
  PricingData,
} from '../types/index.js';

dotenv.config();

// Create connection pool
const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  port: parseInt(process.env.SUPABASE_DB_PORT || '5432'),
  ssl: {
    rejectUnauthorized: false,
  },
  max: 20,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Test connection
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err: Error & { code?: string }) => {
  console.error('✗ Database pool error (will attempt reconnection):', err.message);
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    console.error('Fatal database configuration error, shutting down...');
    process.exit(-1);
  }
});

/**
 * Check if email has already been processed
 */
async function checkEmailExists(messageId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM shipping_emails WHERE email_message_id = $1',
      [messageId]
    );
    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking email existence:', error);
    throw error;
  }
}

/**
 * Save parsed quote data to database
 */
async function saveQuoteToDatabase(
  email: Email,
  parsedData: ParsedEmailData,
  jobId: string | null = null
): Promise<DatabaseSaveResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!parsedData || !parsedData.quotes || parsedData.quotes.length === 0) {
      throw new Error('No quotes found in parsed data');
    }

    const emailQuery = `
      INSERT INTO shipping_emails (
        email_message_id, conversation_id, job_id, email_subject, email_received_date,
        email_sender_name, email_sender_email, email_body_preview,
        email_has_attachments, processed_at, ai_confidence_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (email_message_id)
      DO UPDATE SET
        processed_at = EXCLUDED.processed_at,
        ai_confidence_score = EXCLUDED.ai_confidence_score,
        job_id = COALESCE(EXCLUDED.job_id, shipping_emails.job_id),
        conversation_id = EXCLUDED.conversation_id
      RETURNING email_id
    `;

    const emailValues = [
      email.id,
      email.conversationId,
      jobId,
      email.subject,
      email.receivedDateTime,
      email.from?.emailAddress?.name,
      email.from?.emailAddress?.address,
      email.bodyPreview,
      email.hasAttachments || false,
      new Date(),
      parsedData.ai_confidence_score,
    ];

    const emailResult = await client.query(emailQuery, emailValues);
    const emailId = emailResult.rows[0].email_id;

    const quoteQuery = `
      INSERT INTO shipping_quotes (
        email_id,
        client_company_name, contact_person_name, email_address,
        phone_number, company_address, client_type, industry_business_type,
        origin_full_address, origin_city, origin_state_province,
        origin_country, origin_postal_code, requested_pickup_date,
        pickup_special_requirements,
        destination_full_address, destination_city, destination_state_province,
        destination_country, destination_postal_code, requested_delivery_date,
        delivery_special_requirements,
        cargo_length, cargo_width, cargo_height, dimension_unit,
        cargo_weight, weight_unit, number_of_pieces, cargo_description,
        hazardous_material, declared_value, packaging_type,
        service_type, service_level, incoterms, insurance_required,
        customs_clearance_needed, transit_time_quoted,
        quote_date, initial_quote_amount, revised_quote_1, revised_quote_2,
        discount_given, discount_reason, final_agreed_price,
        quote_status, job_won, rejection_reason,
        sales_representative, lead_source, special_requirements,
        urgency_level
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33,
        $34, $35, $36, $37, $38, $39,
        $40, $41, $42, $43, $44, $45, $46,
        $47, $48, $49,
        $50, $51, $52, $53
      ) RETURNING quote_id
    `;

    const quoteIds: number[] = [];
    const clientInfo = parsedData.client_info || {};

    for (let i = 0; i < parsedData.quotes.length; i++) {
      const quote = parsedData.quotes[i];
      if (!quote) continue;

      const quoteValues = [
        emailId,
        clientInfo.client_company_name,
        clientInfo.contact_person_name,
        clientInfo.email_address,
        clientInfo.phone_number,
        clientInfo.company_address,
        clientInfo.client_type,
        clientInfo.industry_business_type,
        quote.origin_full_address,
        quote.origin_city,
        quote.origin_state_province,
        quote.origin_country,
        quote.origin_postal_code,
        quote.requested_pickup_date,
        quote.pickup_special_requirements,
        quote.destination_full_address,
        quote.destination_city,
        quote.destination_state_province,
        quote.destination_country,
        quote.destination_postal_code,
        quote.requested_delivery_date,
        quote.delivery_special_requirements,
        quote.cargo_length,
        quote.cargo_width,
        quote.cargo_height,
        quote.dimension_unit,
        quote.cargo_weight,
        quote.weight_unit,
        quote.number_of_pieces,
        quote.cargo_description,
        quote.hazardous_material,
        quote.declared_value,
        quote.packaging_type,
        quote.service_type,
        quote.service_level,
        quote.incoterms,
        quote.insurance_required,
        quote.customs_clearance_needed,
        quote.transit_time_quoted,
        quote.quote_date,
        quote.initial_quote_amount,
        quote.revised_quote_1,
        quote.revised_quote_2,
        quote.discount_given,
        quote.discount_reason,
        quote.final_agreed_price,
        quote.quote_status,
        quote.job_won,
        quote.rejection_reason,
        quote.sales_representative,
        quote.lead_source,
        quote.special_requirements,
        quote.urgency_level,
      ];

      const quoteResult = await client.query(quoteQuery, quoteValues);
      quoteIds.push(quoteResult.rows[0].quote_id);
    }

    await client.query('COMMIT');

    return {
      email_id: emailId,
      quote_ids: quoteIds,
      quotes_count: quoteIds.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get statistics about processed emails and quotes
 */
async function getProcessingStats(): Promise<ProcessingStats> {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT e.email_id) as total_emails,
        COUNT(q.quote_id) as total_quotes,
        COUNT(CASE WHEN q.quote_status = 'Approved' THEN 1 END) as approved_quotes,
        COUNT(CASE WHEN q.job_won = true THEN 1 END) as jobs_won,
        AVG(e.ai_confidence_score) as avg_confidence,
        MAX(e.processed_at) as last_processed
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
    `);
    return result.rows[0];
  } catch (error) {
    console.error('Error getting stats:', error);
    throw error;
  }
}

/**
 * Get the latest lastReceivedDateTime from completed processing jobs
 */
async function getLatestLastReceivedDateTime(): Promise<string | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT last_received_datetime
      FROM processing_jobs
      WHERE status = 'completed'
        AND last_received_datetime IS NOT NULL
      ORDER BY last_received_datetime DESC
      LIMIT 1
    `);

    if (result.rows.length > 0 && result.rows[0].last_received_datetime) {
      return result.rows[0].last_received_datetime.toISOString();
    }
    return null;
  } catch (error) {
    console.error('Error getting latest lastReceivedDateTime:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Save job to database
 */
async function saveJobToDatabase(job: Job): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `
      INSERT INTO processing_jobs (
        job_id, status, created_at, updated_at, started_at,
        completed_at, job_data, result, error, progress, last_received_datetime
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
      [
        job.id,
        job.status,
        job.createdAt,
        job.updatedAt,
        job.startedAt,
        job.completedAt,
        JSON.stringify(job.data),
        JSON.stringify(job.result),
        JSON.stringify(job.error),
        JSON.stringify(job.progress),
        job.lastReceivedDateTime,
      ]
    );
  } finally {
    client.release();
  }
}

/**
 * Get job from database
 */
async function getJobFromDatabase(jobId: string): Promise<Job | null> {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM processing_jobs WHERE job_id = $1', [jobId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.job_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      data: row.job_data,
      result: row.result,
      error: row.error,
      progress: row.progress,
      lastReceivedDateTime: row.last_received_datetime,
    };
  } finally {
    client.release();
  }
}

/**
 * Update job in database
 */
async function updateJobInDatabase(job: Job): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `
      UPDATE processing_jobs
      SET status = $2, updated_at = $3, started_at = $4,
          completed_at = $5, result = $6, error = $7, progress = $8, last_received_datetime = $9
      WHERE job_id = $1
    `,
      [
        job.id,
        job.status,
        job.updatedAt,
        job.startedAt,
        job.completedAt,
        JSON.stringify(job.result),
        JSON.stringify(job.error),
        JSON.stringify(job.progress),
        job.lastReceivedDateTime,
      ]
    );
  } finally {
    client.release();
  }
}

interface JobStatisticsFilters {
  startDate?: string;
  endDate?: string;
}

/**
 * Get job statistics from database
 */
async function getJobStatistics(filters: JobStatisticsFilters = {}): Promise<JobStatistics> {
  const client = await pool.connect();
  try {
    let whereClause = '';
    const params: string[] = [];

    if (filters.startDate) {
      params.push(filters.startDate);
      whereClause = `WHERE created_at >= $${params.length}`;
    }

    if (filters.endDate) {
      params.push(filters.endDate);
      whereClause += whereClause
        ? ` AND created_at <= $${params.length}`
        : `WHERE created_at <= $${params.length}`;
    }

    const result = await client.query(
      `
      SELECT
        COUNT(*) as total_jobs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
        SUM((result->>'fetched')::int) as total_emails_fetched,
        SUM((result->'processed'->>'successful')::int) as total_emails_processed,
        SUM((result->>'actualCost')::numeric) as total_cost,
        SUM((result->>'estimatedSavings')::numeric) as total_savings
      FROM processing_jobs
      ${whereClause}
    `,
      params
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get emails associated with a processing job
 */
async function getEmailsByJobId(jobId: string): Promise<ShippingEmail[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      SELECT
        e.*,
        COUNT(q.quote_id) as quote_count
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
      WHERE e.job_id = $1
      GROUP BY e.email_id
      ORDER BY e.email_received_date DESC
    `,
      [jobId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get all quotes for a specific email
 */
async function getQuotesByEmailId(emailId: number): Promise<Quote[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      SELECT * FROM shipping_quotes
      WHERE email_id = $1
      ORDER BY created_at DESC
    `,
      [emailId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get email by message ID
 */
async function getEmailByMessageId(messageId: string): Promise<ShippingEmail | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `
      SELECT
        e.*,
        COUNT(q.quote_id) as quote_count
      FROM shipping_emails e
      LEFT JOIN shipping_quotes q ON e.email_id = q.email_id
      WHERE e.email_message_id = $1
      GROUP BY e.email_id
    `,
      [messageId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

interface GetAllQuotesResult {
  quotes: QuoteWithEmail[];
  totalCount: number;
}

/**
 * Get all quotes with pagination
 */
async function getAllQuotes(limit = 50, offset = 0): Promise<GetAllQuotesResult> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         q.*,
         e.email_message_id,
         e.email_subject,
         e.email_received_date,
         e.email_sender_name,
         e.email_sender_email,
         e.email_body_preview,
         e.email_has_attachments,
         e.raw_email_body,
         e.processed_at,
         e.ai_confidence_score,
         e.conversation_id,
         e.job_id
       FROM shipping_quotes q
       INNER JOIN shipping_emails e ON q.email_id = e.email_id
       ORDER BY q.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await client.query('SELECT COUNT(*) FROM shipping_quotes');
    const totalCount = parseInt(countResult.rows[0].count);

    return {
      quotes: result.rows,
      totalCount,
    };
  } finally {
    client.release();
  }
}

/**
 * Get a single quote by ID
 */
async function getQuoteById(quoteId: number | string): Promise<QuoteWithEmail | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         q.*,
         e.email_message_id,
         e.email_subject,
         e.email_received_date,
         e.email_sender_name,
         e.email_sender_email,
         e.email_body_preview,
         e.email_has_attachments,
         e.raw_email_body,
         e.processed_at,
         e.ai_confidence_score,
         e.conversation_id,
         e.job_id
       FROM shipping_quotes q
       INNER JOIN shipping_emails e ON q.email_id = e.email_id
       WHERE q.quote_id = $1`,
      [quoteId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

interface SearchCriteria {
  clientCompanyName?: string;
  quoteStatus?: string;
  startDate?: string;
  endDate?: string;
  senderEmail?: string;
}

/**
 * Search quotes by criteria
 */
async function searchQuotes(criteria: SearchCriteria): Promise<QuoteWithEmail[]> {
  const { clientCompanyName, quoteStatus, startDate, endDate, senderEmail } = criteria;

  let query = `
    SELECT
      q.*,
      e.email_message_id,
      e.email_subject,
      e.email_received_date,
      e.email_sender_name,
      e.email_sender_email,
      e.email_body_preview,
      e.email_has_attachments,
      e.raw_email_body,
      e.processed_at,
      e.ai_confidence_score,
      e.conversation_id,
      e.job_id
    FROM shipping_quotes q
    INNER JOIN shipping_emails e ON q.email_id = e.email_id
    WHERE 1=1
  `;
  const params: string[] = [];
  let paramIndex = 1;

  if (clientCompanyName) {
    query += ` AND q.client_company_name ILIKE $${paramIndex}`;
    params.push(`%${clientCompanyName}%`);
    paramIndex++;
  }

  if (quoteStatus) {
    query += ` AND q.quote_status = $${paramIndex}`;
    params.push(quoteStatus);
    paramIndex++;
  }

  if (senderEmail) {
    query += ` AND e.email_sender_email ILIKE $${paramIndex}`;
    params.push(`%${senderEmail}%`);
    paramIndex++;
  }

  if (startDate) {
    query += ` AND q.created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }

  if (endDate) {
    query += ` AND q.created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }

  query += ' ORDER BY q.created_at DESC LIMIT 100';

  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Delete a quote by ID
 */
async function deleteQuote(quoteId: number | string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM shipping_quotes WHERE quote_id = $1 RETURNING quote_id',
      [quoteId]
    );

    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Test database connection
 */
async function testConnection(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } finally {
    client.release();
  }
}

/**
 * Get current database time
 */
async function getCurrentTime(): Promise<Date> {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() as current_time');
    return result.rows[0].current_time;
  } finally {
    client.release();
  }
}

// =====================================================
// Quote Matches Functions
// =====================================================

interface CreateMatchData {
  sourceQuoteId: number;
  matchedQuoteId: number;
  similarityScore: number;
  matchCriteria?: MatchCriteria;
  suggestedPrice?: number | null;
  priceConfidence?: number;
  algorithmVersion?: string;
  aiPricingDetails?: AIPricingDetails | null;
}

/**
 * Create a new quote match
 */
async function createQuoteMatch(matchData: CreateMatchData): Promise<QuoteMatch> {
  const client = await pool.connect();
  try {
    const {
      sourceQuoteId,
      matchedQuoteId,
      similarityScore,
      matchCriteria,
      suggestedPrice,
      priceConfidence,
      algorithmVersion = 'v1',
      aiPricingDetails = null,
    } = matchData;

    const result = await client.query(
      `INSERT INTO quote_matches (
        source_quote_id, matched_quote_id, similarity_score,
        match_criteria, suggested_price, price_confidence, match_algorithm_version, ai_pricing_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (source_quote_id, matched_quote_id)
      DO UPDATE SET
        similarity_score = EXCLUDED.similarity_score,
        match_criteria = EXCLUDED.match_criteria,
        suggested_price = EXCLUDED.suggested_price,
        price_confidence = EXCLUDED.price_confidence,
        match_algorithm_version = EXCLUDED.match_algorithm_version,
        ai_pricing_details = EXCLUDED.ai_pricing_details,
        created_at = NOW()
      RETURNING *`,
      [
        sourceQuoteId,
        matchedQuoteId,
        similarityScore,
        JSON.stringify(matchCriteria),
        suggestedPrice,
        priceConfidence,
        algorithmVersion,
        aiPricingDetails ? JSON.stringify(aiPricingDetails) : null,
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Create multiple quote matches in bulk
 */
async function createQuoteMatchesBulk(matches: CreateMatchData[]): Promise<QuoteMatch[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results: QuoteMatch[] = [];
    for (const match of matches) {
      const result = await client.query(
        `INSERT INTO quote_matches (
          source_quote_id, matched_quote_id, similarity_score,
          match_criteria, suggested_price, price_confidence, match_algorithm_version, ai_pricing_details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (source_quote_id, matched_quote_id)
        DO UPDATE SET
          similarity_score = EXCLUDED.similarity_score,
          match_criteria = EXCLUDED.match_criteria,
          suggested_price = EXCLUDED.suggested_price,
          price_confidence = EXCLUDED.price_confidence,
          match_algorithm_version = EXCLUDED.match_algorithm_version,
          ai_pricing_details = EXCLUDED.ai_pricing_details,
          created_at = NOW()
        RETURNING *`,
        [
          match.sourceQuoteId,
          match.matchedQuoteId,
          match.similarityScore,
          JSON.stringify(match.matchCriteria),
          match.suggestedPrice,
          match.priceConfidence,
          match.algorithmVersion || 'v1',
          match.aiPricingDetails ? JSON.stringify(match.aiPricingDetails) : null,
        ]
      );
      results.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface GetMatchesOptions {
  limit?: number;
  minScore?: number;
}

/**
 * Get matches for a quote
 */
async function getMatchesForQuote(
  quoteId: string | number,
  options: GetMatchesOptions = {}
): Promise<QuoteMatch[]> {
  const { limit = 10, minScore = 0 } = options;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        m.*,
        q.client_company_name,
        q.origin_city,
        q.origin_country,
        q.destination_city,
        q.destination_country,
        q.cargo_description,
        q.cargo_weight,
        q.weight_unit,
        q.service_type,
        q.final_agreed_price,
        q.initial_quote_amount,
        q.quote_status,
        q.quote_date,
        COALESCE(fb.feedback_count, 0) as feedback_count,
        fb.avg_rating
      FROM quote_matches m
      INNER JOIN shipping_quotes q ON m.matched_quote_id = q.quote_id
      LEFT JOIN (
        SELECT match_id, COUNT(*) as feedback_count, AVG(rating) as avg_rating
        FROM quote_match_feedback
        GROUP BY match_id
      ) fb ON m.match_id = fb.match_id
      WHERE m.source_quote_id = $1 AND m.similarity_score >= $2
      ORDER BY m.similarity_score DESC
      LIMIT $3`,
      [quoteId, minScore, limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get a single match by ID
 */
async function getMatchById(matchId: string | number): Promise<QuoteMatch | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        m.*,
        sq.client_company_name as source_client,
        sq.origin_city as source_origin_city,
        sq.destination_city as source_destination_city,
        mq.client_company_name as matched_client,
        mq.origin_city as matched_origin_city,
        mq.destination_city as matched_destination_city,
        mq.final_agreed_price as matched_final_price,
        mq.initial_quote_amount as matched_initial_price
      FROM quote_matches m
      INNER JOIN shipping_quotes sq ON m.source_quote_id = sq.quote_id
      INNER JOIN shipping_quotes mq ON m.matched_quote_id = mq.quote_id
      WHERE m.match_id = $1`,
      [matchId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

/**
 * Delete a match
 */
async function deleteMatch(matchId: string | number): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM quote_matches WHERE match_id = $1 RETURNING match_id',
      [matchId]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

// =====================================================
// Quote Match Feedback Functions
// =====================================================

interface SubmitFeedbackData {
  matchId: number;
  userId?: string | null;
  rating: 1 | -1;
  feedbackReason?: string | null;
  feedbackNotes?: string | null;
  actualPriceUsed?: number | null;
}

/**
 * Submit feedback for a match
 */
async function submitMatchFeedback(feedbackData: SubmitFeedbackData): Promise<MatchFeedback> {
  const client = await pool.connect();
  try {
    const {
      matchId,
      userId = null,
      rating,
      feedbackReason = null,
      feedbackNotes = null,
      actualPriceUsed = null,
    } = feedbackData;

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

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get feedback for a match
 */
async function getFeedbackForMatch(matchId: string | number): Promise<MatchFeedback[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM quote_match_feedback
      WHERE match_id = $1
      ORDER BY created_at DESC`,
      [matchId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

interface FeedbackFilters {
  algorithmVersion?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Get feedback statistics for algorithm improvement
 */
async function getFeedbackStatistics(filters: FeedbackFilters = {}): Promise<FeedbackStatistics> {
  const client = await pool.connect();
  try {
    const { algorithmVersion, startDate, endDate } = filters;

    let whereClause = 'WHERE 1=1';
    const params: string[] = [];
    let paramIndex = 1;

    if (algorithmVersion) {
      whereClause += ` AND m.match_algorithm_version = $${paramIndex}`;
      params.push(algorithmVersion);
      paramIndex++;
    }

    if (startDate) {
      whereClause += ` AND f.created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND f.created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    const result = await client.query(
      `SELECT
        COUNT(*) as total_feedback,
        COUNT(CASE WHEN f.rating = 1 THEN 1 END) as thumbs_up,
        COUNT(CASE WHEN f.rating = -1 THEN 1 END) as thumbs_down,
        ROUND(AVG(f.rating)::numeric, 4) as avg_rating,
        ROUND(AVG(m.similarity_score)::numeric, 4) as avg_similarity_score,
        COUNT(CASE WHEN f.rating = 1 THEN 1 END)::float / NULLIF(COUNT(*), 0) as approval_rate,
        ROUND(AVG(CASE WHEN f.actual_price_used IS NOT NULL
          THEN ABS(m.suggested_price - f.actual_price_used) END)::numeric, 2) as avg_price_error,
        COUNT(f.actual_price_used) as price_feedback_count
      FROM quote_match_feedback f
      INNER JOIN quote_matches m ON f.match_id = m.match_id
      ${whereClause}`,
      params
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get feedback breakdown by reason
 */
async function getFeedbackByReason(): Promise<FeedbackByReason[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        feedback_reason,
        rating,
        COUNT(*) as count
      FROM quote_match_feedback
      WHERE feedback_reason IS NOT NULL
      GROUP BY feedback_reason, rating
      ORDER BY count DESC`
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get match criteria performance
 */
async function getMatchCriteriaPerformance(): Promise<CriteriaPerformance[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        f.rating,
        AVG((m.match_criteria->>'origin')::numeric) as avg_origin_score,
        AVG((m.match_criteria->>'destination')::numeric) as avg_destination_score,
        AVG((m.match_criteria->>'cargo_type')::numeric) as avg_cargo_type_score,
        AVG((m.match_criteria->>'weight')::numeric) as avg_weight_score,
        AVG((m.match_criteria->>'service_type')::numeric) as avg_service_type_score,
        AVG(m.similarity_score) as avg_overall_score,
        COUNT(*) as sample_count
      FROM quote_match_feedback f
      INNER JOIN quote_matches m ON f.match_id = m.match_id
      GROUP BY f.rating`
    );

    return result.rows;
  } finally {
    client.release();
  }
}

interface HistoricalQuotesOptions {
  limit?: number;
  onlyWithPrice?: boolean;
}

/**
 * Get historical quotes for fuzzy matching
 */
async function getHistoricalQuotesForMatching(
  excludeQuoteIds: number[] = [],
  options: HistoricalQuotesOptions = {}
): Promise<Quote[]> {
  const { limit = 500, onlyWithPrice = true } = options;
  const client = await pool.connect();
  try {
    const params: (number[] | number)[] = [];
    let paramIndex = 1;

    let excludeClause = '';
    if (excludeQuoteIds.length > 0) {
      excludeClause = `AND q.quote_id != ALL($${paramIndex}::int[])`;
      params.push(excludeQuoteIds);
      paramIndex++;
    }

    // Use staff_quotes_replies as primary source - these are actual quoted prices from staff
    const result = await client.query(
      `SELECT
        sqr.related_quote_id as quote_id,
        NULL as client_company_name,
        sqr.origin_city,
        sqr.origin_state as origin_state_province,
        sqr.origin_country,
        sqr.destination_city,
        sqr.destination_state as destination_state_province,
        sqr.destination_country,
        sqr.cargo_description,
        sqr.cargo_weight,
        sqr.weight_unit,
        NULL as cargo_length,
        NULL as cargo_width,
        NULL as cargo_height,
        NULL as dimension_unit,
        sqr.number_of_pieces,
        sqr.service_type,
        NULL as service_level,
        NULL as packaging_type,
        NULL as hazardous_material,
        sqr.quoted_price as initial_quote_amount,
        sqr.quoted_price as final_agreed_price,
        NULL as job_won,
        NULL as quote_status,
        sqr.processed_at as quote_date,
        sqr.processed_at as created_at
      FROM staff_quotes_replies sqr
      WHERE sqr.is_pricing_email = true
        AND sqr.origin_city IS NOT NULL
        AND sqr.destination_city IS NOT NULL
        ${onlyWithPrice ? `AND sqr.quoted_price >= 100 AND sqr.quoted_price <= 50000` : ''}
        ${excludeClause.replace('q.quote_id', 'sqr.related_quote_id')}
      ORDER BY sqr.processed_at DESC
      LIMIT $${paramIndex}`,
      [...params, limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

// =====================================================
// Spammers Functions
// =====================================================

/**
 * Check if an email address is in the spammers list
 */
async function isSpammer(emailAddress: string): Promise<boolean> {
  if (!emailAddress) return false;
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT COUNT(*) FROM spammers WHERE LOWER(email_address) = LOWER($1)',
      [emailAddress]
    );
    return parseInt(result.rows[0].count) > 0;
  } finally {
    client.release();
  }
}

/**
 * Get all spammers
 */
async function getAllSpammers(): Promise<Spammer[]> {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM spammers ORDER BY created_at DESC');
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Add a spammer to the list
 */
async function addSpammer(
  emailAddress: string,
  reason: string | null = null,
  addedBy: string | null = null
): Promise<Spammer> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO spammers (email_address, reason, added_by)
       VALUES (LOWER($1), $2, $3)
       ON CONFLICT (email_address) DO UPDATE SET
         reason = COALESCE(EXCLUDED.reason, spammers.reason),
         added_by = COALESCE(EXCLUDED.added_by, spammers.added_by)
       RETURNING *`,
      [emailAddress, reason, addedBy]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Remove a spammer from the list
 */
async function removeSpammer(emailAddress: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM spammers WHERE LOWER(email_address) = LOWER($1) RETURNING spammer_id',
      [emailAddress]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Feedback data associated with a historical quote
 */
interface QuoteFeedbackData {
  quote_id: number;
  total_feedback_count: number;
  positive_feedback_count: number;
  negative_feedback_count: number;
  avg_rating: number | null;
  feedback_reasons: string[];
  feedback_notes: string[];
  actual_prices_used: number[];
}

/**
 * Get feedback data for historical quotes used in matching
 * This queries the quote_matches_with_feedback view and quote_match_feedback table
 */
async function getFeedbackForHistoricalQuotes(quoteIds: number[]): Promise<Map<number, QuoteFeedbackData>> {
  if (quoteIds.length === 0) return new Map();

  const client = await pool.connect();
  try {
    // Get aggregated feedback for quotes that have been matched against
    const result = await client.query(
      `SELECT
        m.matched_quote_id as quote_id,
        COUNT(f.feedback_id) as total_feedback_count,
        COUNT(CASE WHEN f.rating = 1 THEN 1 END) as positive_feedback_count,
        COUNT(CASE WHEN f.rating = -1 THEN 1 END) as negative_feedback_count,
        AVG(f.rating) as avg_rating,
        ARRAY_AGG(DISTINCT f.feedback_reason) FILTER (WHERE f.feedback_reason IS NOT NULL) as feedback_reasons,
        ARRAY_AGG(f.feedback_notes) FILTER (WHERE f.feedback_notes IS NOT NULL) as feedback_notes,
        ARRAY_AGG(f.actual_price_used) FILTER (WHERE f.actual_price_used IS NOT NULL) as actual_prices_used
      FROM quote_matches m
      INNER JOIN quote_match_feedback f ON m.match_id = f.match_id
      WHERE m.matched_quote_id = ANY($1::int[])
      GROUP BY m.matched_quote_id`,
      [quoteIds]
    );

    const feedbackMap = new Map<number, QuoteFeedbackData>();
    for (const row of result.rows) {
      feedbackMap.set(row.quote_id, {
        quote_id: row.quote_id,
        total_feedback_count: parseInt(row.total_feedback_count) || 0,
        positive_feedback_count: parseInt(row.positive_feedback_count) || 0,
        negative_feedback_count: parseInt(row.negative_feedback_count) || 0,
        avg_rating: row.avg_rating ? parseFloat(row.avg_rating) : null,
        feedback_reasons: row.feedback_reasons || [],
        feedback_notes: row.feedback_notes || [],
        actual_prices_used: row.actual_prices_used || [],
      });
    }

    return feedbackMap;
  } finally {
    client.release();
  }
}

/**
 * Get quote IDs where email was received after a specific date
 */
async function getQuoteIdsByStartDate(startDate: string, limit = 1000): Promise<number[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT q.quote_id
       FROM shipping_quotes q
       INNER JOIN shipping_emails e ON q.email_id = e.email_id
       WHERE e.email_received_date >= $1
       ORDER BY e.email_received_date ASC
       LIMIT $2`,
      [startDate, limit]
    );

    return result.rows.map((row) => row.quote_id);
  } finally {
    client.release();
  }
}

/**
 * Get a quote by ID with fields needed for matching
 */
async function getQuoteForMatching(quoteId: number): Promise<Quote | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
        quote_id,
        client_company_name,
        origin_city,
        origin_state_province,
        origin_country,
        destination_city,
        destination_state_province,
        destination_country,
        cargo_description,
        cargo_weight,
        weight_unit,
        cargo_length,
        cargo_width,
        cargo_height,
        dimension_unit,
        number_of_pieces,
        service_type,
        service_level,
        packaging_type,
        hazardous_material,
        initial_quote_amount,
        final_agreed_price,
        quote_status,
        quote_date,
        created_at
      FROM shipping_quotes
      WHERE quote_id = $1`,
      [quoteId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

// =====================================================
// Staff Replies Functions
// =====================================================

/**
 * Get all conversation IDs from shipping_emails
 */
async function getConversationIds(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT DISTINCT conversation_id
       FROM shipping_emails
       WHERE conversation_id IS NOT NULL`
    );

    return result.rows.map(row => row.conversation_id);
  } finally {
    client.release();
  }
}

/**
 * Save a staff reply to the database
 */
async function saveStaffReply(reply: StaffReply): Promise<StaffReply> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO staff_replies (
        email_message_id, conversation_id, original_email_id,
        sender_name, sender_email, subject, body_preview,
        received_date, has_attachments
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (email_message_id)
      DO UPDATE SET
        conversation_id = EXCLUDED.conversation_id,
        sender_name = EXCLUDED.sender_name,
        sender_email = EXCLUDED.sender_email,
        subject = EXCLUDED.subject,
        body_preview = EXCLUDED.body_preview,
        received_date = EXCLUDED.received_date,
        has_attachments = EXCLUDED.has_attachments
      RETURNING *`,
      [
        reply.email_message_id,
        reply.conversation_id,
        reply.original_email_id,
        reply.sender_name,
        reply.sender_email,
        reply.subject,
        reply.body_preview,
        reply.received_date,
        reply.has_attachments,
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Save multiple staff replies in bulk
 */
async function saveStaffRepliesBulk(replies: StaffReply[]): Promise<StaffReply[]> {
  if (replies.length === 0) return [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const results: StaffReply[] = [];
    for (const reply of replies) {
      const result = await client.query(
        `INSERT INTO staff_replies (
          email_message_id, conversation_id, original_email_id,
          sender_name, sender_email, subject, body_preview,
          received_date, has_attachments
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (email_message_id)
        DO UPDATE SET
          conversation_id = EXCLUDED.conversation_id,
          sender_name = EXCLUDED.sender_name,
          sender_email = EXCLUDED.sender_email,
          subject = EXCLUDED.subject,
          body_preview = EXCLUDED.body_preview,
          received_date = EXCLUDED.received_date,
          has_attachments = EXCLUDED.has_attachments
        RETURNING *`,
        [
          reply.email_message_id,
          reply.conversation_id,
          reply.original_email_id,
          reply.sender_name,
          reply.sender_email,
          reply.subject,
          reply.body_preview,
          reply.received_date,
          reply.has_attachments,
        ]
      );
      results.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get all staff replies
 */
async function getAllStaffReplies(limit = 100, offset = 0): Promise<{ replies: StaffReply[]; totalCount: number }> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM staff_replies
       ORDER BY received_date DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await client.query('SELECT COUNT(*) FROM staff_replies');
    const totalCount = parseInt(countResult.rows[0].count);

    return {
      replies: result.rows,
      totalCount,
    };
  } finally {
    client.release();
  }
}

/**
 * Get staff replies by conversation ID
 */
async function getStaffRepliesByConversationId(conversationId: string): Promise<StaffReply[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM staff_replies
       WHERE conversation_id = $1
       ORDER BY received_date DESC`,
      [conversationId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get the original email ID for a conversation
 */
async function getOriginalEmailIdByConversation(conversationId: string): Promise<number | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT email_id FROM shipping_emails
       WHERE conversation_id = $1
       ORDER BY email_received_date ASC
       LIMIT 1`,
      [conversationId]
    );

    return result.rows.length > 0 ? result.rows[0].email_id : null;
  } finally {
    client.release();
  }
}

// =====================================================
// Staff Quote Replies Functions
// =====================================================

interface SaveStaffQuoteReplyOptions {
  staffReplyId: number;
  originalEmailId?: number | null;
  relatedQuoteId?: number | null;
  quoteSequence?: number;
  isPricingEmail: boolean;
  confidenceScore: number;
  pricingData?: PricingData | null;
  rawEmailBody?: string | null;
  attachmentText?: string | null;
}

/**
 * Save a single staff quote reply entry to the database
 */
async function saveStaffQuoteReplyEntry(
  options: SaveStaffQuoteReplyOptions
): Promise<StaffQuoteReply> {
  const client = await pool.connect();
  try {
    const {
      staffReplyId,
      originalEmailId,
      relatedQuoteId,
      quoteSequence = 1,
      isPricingEmail,
      confidenceScore,
      pricingData,
      rawEmailBody,
      attachmentText,
    } = options;

    const queryResult = await client.query(
      `INSERT INTO staff_quotes_replies (
        staff_reply_id, original_email_id, related_quote_id, quote_sequence,
        is_pricing_email, confidence_score,
        quoted_price, currency, price_type, price_breakdown,
        origin_city, origin_state, origin_country,
        destination_city, destination_state, destination_country,
        service_type, equipment_type, cargo_description,
        cargo_weight, weight_unit, container_size, number_of_pieces,
        quote_valid_until, payment_terms, transit_time, notes,
        raw_email_body, attachment_text, processed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, NOW()
      )
      ON CONFLICT (staff_reply_id, quote_sequence)
      DO UPDATE SET
        original_email_id = EXCLUDED.original_email_id,
        related_quote_id = EXCLUDED.related_quote_id,
        is_pricing_email = EXCLUDED.is_pricing_email,
        confidence_score = EXCLUDED.confidence_score,
        quoted_price = EXCLUDED.quoted_price,
        currency = EXCLUDED.currency,
        price_type = EXCLUDED.price_type,
        price_breakdown = EXCLUDED.price_breakdown,
        origin_city = EXCLUDED.origin_city,
        origin_state = EXCLUDED.origin_state,
        origin_country = EXCLUDED.origin_country,
        destination_city = EXCLUDED.destination_city,
        destination_state = EXCLUDED.destination_state,
        destination_country = EXCLUDED.destination_country,
        service_type = EXCLUDED.service_type,
        equipment_type = EXCLUDED.equipment_type,
        cargo_description = EXCLUDED.cargo_description,
        cargo_weight = EXCLUDED.cargo_weight,
        weight_unit = EXCLUDED.weight_unit,
        container_size = EXCLUDED.container_size,
        number_of_pieces = EXCLUDED.number_of_pieces,
        quote_valid_until = EXCLUDED.quote_valid_until,
        payment_terms = EXCLUDED.payment_terms,
        transit_time = EXCLUDED.transit_time,
        notes = EXCLUDED.notes,
        raw_email_body = EXCLUDED.raw_email_body,
        attachment_text = EXCLUDED.attachment_text,
        processed_at = NOW()
      RETURNING *`,
      [
        staffReplyId,
        originalEmailId ?? null,
        relatedQuoteId ?? null,
        quoteSequence,
        isPricingEmail,
        confidenceScore,
        pricingData?.quoted_price ?? null,
        pricingData?.currency ?? null,
        pricingData?.price_type ?? null,
        pricingData?.price_breakdown ? JSON.stringify(pricingData.price_breakdown) : null,
        pricingData?.origin_city ?? null,
        pricingData?.origin_state ?? null,
        pricingData?.origin_country ?? null,
        pricingData?.destination_city ?? null,
        pricingData?.destination_state ?? null,
        pricingData?.destination_country ?? null,
        pricingData?.service_type ?? null,
        pricingData?.equipment_type ?? null,
        pricingData?.cargo_description ?? null,
        pricingData?.cargo_weight ?? null,
        pricingData?.weight_unit ?? null,
        pricingData?.container_size ?? null,
        pricingData?.number_of_pieces ?? null,
        pricingData?.quote_valid_until ?? null,
        pricingData?.payment_terms ?? null,
        pricingData?.transit_time ?? null,
        pricingData?.notes ?? null,
        rawEmailBody ?? null,
        attachmentText ?? null,
      ]
    );

    return queryResult.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Save staff quote reply with multiple quotes support
 * Creates separate entries for each quote in the quotes array
 */
async function saveStaffQuoteReply(
  staffReplyId: number,
  result: PricingReplyResult,
  originalEmailId?: number | null,
  relatedQuoteIds?: number[] | null,
  rawEmailBody?: string | null,
  attachmentText?: string | null
): Promise<StaffQuoteReply[]> {
  // Get all quotes from either quotes array or pricing_data (backward compat)
  const quotes = result.quotes && result.quotes.length > 0
    ? result.quotes
    : result.pricing_data
      ? [result.pricing_data]
      : [];

  // If not a pricing email or no quotes, save a single entry with null pricing
  if (!result.is_pricing_email || quotes.length === 0) {
    const entry = await saveStaffQuoteReplyEntry({
      staffReplyId,
      originalEmailId,
      relatedQuoteId: relatedQuoteIds?.[0] ?? null,
      quoteSequence: 1,
      isPricingEmail: result.is_pricing_email,
      confidenceScore: result.confidence_score,
      pricingData: null,
      rawEmailBody,
      attachmentText,
    });
    return [entry];
  }

  // Save each quote as a separate entry
  const savedEntries: StaffQuoteReply[] = [];

  for (let i = 0; i < quotes.length; i++) {
    const quote = quotes[i];
    const entry = await saveStaffQuoteReplyEntry({
      staffReplyId,
      originalEmailId,
      relatedQuoteId: relatedQuoteIds?.[i] ?? relatedQuoteIds?.[0] ?? null,
      quoteSequence: i + 1,
      isPricingEmail: result.is_pricing_email,
      confidenceScore: result.confidence_score,
      pricingData: quote,
      // Only store raw content on first entry to save space
      rawEmailBody: i === 0 ? rawEmailBody : null,
      attachmentText: i === 0 ? attachmentText : null,
    });
    savedEntries.push(entry);
  }

  return savedEntries;
}

/**
 * Get quote IDs associated with an original email
 */
async function getQuoteIdsByEmailId(emailId: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT quote_id FROM shipping_quotes WHERE email_id = $1 ORDER BY quote_id`,
      [emailId]
    );
    return result.rows.map((row) => row.quote_id);
  } finally {
    client.release();
  }
}

/**
 * Get all staff quote replies with pagination
 */
async function getAllStaffQuoteReplies(
  limit = 100,
  offset = 0,
  onlyPricing = false
): Promise<{ replies: StaffQuoteReply[]; totalCount: number }> {
  const client = await pool.connect();
  try {
    const whereClause = onlyPricing ? 'WHERE sqr.is_pricing_email = true' : '';

    const result = await client.query(
      `SELECT sqr.*, sr.email_message_id, sr.conversation_id, sr.sender_name,
              sr.sender_email, sr.subject, sr.received_date, sr.original_email_id
       FROM staff_quotes_replies sqr
       INNER JOIN staff_replies sr ON sqr.staff_reply_id = sr.reply_id
       ${whereClause}
       ORDER BY sqr.processed_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countQuery = onlyPricing
      ? 'SELECT COUNT(*) FROM staff_quotes_replies WHERE is_pricing_email = true'
      : 'SELECT COUNT(*) FROM staff_quotes_replies';
    const countResult = await client.query(countQuery);
    const totalCount = parseInt(countResult.rows[0].count);

    return {
      replies: result.rows,
      totalCount,
    };
  } finally {
    client.release();
  }
}

/**
 * Get staff quote reply by staff reply ID
 */
async function getStaffQuoteReplyByStaffReplyId(staffReplyId: number): Promise<StaffQuoteReply | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT sqr.*, sr.email_message_id, sr.conversation_id, sr.sender_name,
              sr.sender_email, sr.subject, sr.received_date, sr.original_email_id
       FROM staff_quotes_replies sqr
       INNER JOIN staff_replies sr ON sqr.staff_reply_id = sr.reply_id
       WHERE sqr.staff_reply_id = $1`,
      [staffReplyId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } finally {
    client.release();
  }
}

/**
 * Check if staff reply has already been processed for pricing
 */
async function checkStaffQuoteReplyExists(staffReplyId: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT COUNT(*) FROM staff_quotes_replies WHERE staff_reply_id = $1',
      [staffReplyId]
    );
    return parseInt(result.rows[0].count) > 0;
  } finally {
    client.release();
  }
}

/**
 * Get unprocessed staff replies (those without entries in staff_quotes_replies)
 */
async function getUnprocessedStaffReplies(limit = 100): Promise<StaffReply[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT sr.*
       FROM staff_replies sr
       LEFT JOIN staff_quotes_replies sqr ON sr.reply_id = sqr.staff_reply_id
       WHERE sqr.id IS NULL
       ORDER BY sr.received_date DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get staff quote replies by original email ID
 */
async function getStaffQuoteRepliesByOriginalEmailId(
  originalEmailId: number
): Promise<StaffQuoteReply[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT sqr.*, sr.email_message_id, sr.conversation_id, sr.sender_name,
              sr.sender_email, sr.subject, sr.received_date
       FROM staff_quotes_replies sqr
       INNER JOIN staff_replies sr ON sqr.staff_reply_id = sr.reply_id
       WHERE sr.original_email_id = $1
       ORDER BY sr.received_date DESC`,
      [originalEmailId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

export {
  pool,
  checkEmailExists,
  saveQuoteToDatabase,
  getProcessingStats,
  getLatestLastReceivedDateTime,
  saveJobToDatabase,
  getJobFromDatabase,
  updateJobInDatabase,
  getJobStatistics,
  getEmailsByJobId,
  getQuotesByEmailId,
  getEmailByMessageId,
  getAllQuotes,
  getQuoteById,
  searchQuotes,
  deleteQuote,
  testConnection,
  getCurrentTime,
  // Quote matches
  createQuoteMatch,
  createQuoteMatchesBulk,
  getMatchesForQuote,
  getMatchById,
  deleteMatch,
  // Match feedback
  submitMatchFeedback,
  getFeedbackForMatch,
  getFeedbackStatistics,
  getFeedbackByReason,
  getMatchCriteriaPerformance,
  // Historical quotes for matching
  getHistoricalQuotesForMatching,
  getQuoteForMatching,
  getQuoteIdsByStartDate,
  getFeedbackForHistoricalQuotes,
  // Spammers
  isSpammer,
  getAllSpammers,
  addSpammer,
  removeSpammer,
  // Staff Replies
  getConversationIds,
  saveStaffReply,
  saveStaffRepliesBulk,
  getAllStaffReplies,
  getStaffRepliesByConversationId,
  getOriginalEmailIdByConversation,
  // Staff Quote Replies
  saveStaffQuoteReply,
  getAllStaffQuoteReplies,
  getStaffQuoteReplyByStaffReplyId,
  checkStaffQuoteReplyExists,
  getUnprocessedStaffReplies,
  getStaffQuoteRepliesByOriginalEmailId,
  getQuoteIdsByEmailId,
};

export type {
  JobStatisticsFilters,
  GetAllQuotesResult,
  SearchCriteria,
  CreateMatchData,
  GetMatchesOptions,
  SubmitFeedbackData,
  FeedbackFilters,
  HistoricalQuotesOptions,
  QuoteFeedbackData,
};
