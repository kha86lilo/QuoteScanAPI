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
    let whereClause = 'WHERE 1=1';
    const params: (number[] | number)[] = [];
    let paramIndex = 1;

    if (excludeQuoteIds.length > 0) {
      whereClause += ` AND quote_id != ALL($${paramIndex}::int[])`;
      params.push(excludeQuoteIds);
      paramIndex++;
    }

    if (onlyWithPrice) {
      whereClause += ` AND (final_agreed_price IS NOT NULL OR initial_quote_amount IS NOT NULL)`;
    }

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
      ${whereClause}
      ORDER BY created_at DESC
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
  // Spammers
  isSpammer,
  getAllSpammers,
  addSpammer,
  removeSpammer,
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
};
