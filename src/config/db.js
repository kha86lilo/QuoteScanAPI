/**
 * Database Configuration and Connection Pool
 * PostgreSQL connection for Supabase
 */

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
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
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('✗ Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Check if email has already been processed
 * @param {string} messageId - Email message ID
 * @returns {Promise<boolean>}
 */
async function checkEmailExists(messageId) {
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
 * @param {Object} email - Raw email data from Microsoft Graph
 * @param {Object} parsedData - Parsed data from Claude AI
 * @param {string} jobId - Optional job ID to associate with the email
 * @returns {Promise<Object>} - Database insert result with email_id and quote_id
 */
async function saveQuoteToDatabase(email, parsedData, jobId = null) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Insert or get existing email record
    const emailQuery = `
      INSERT INTO shipping_emails (
        email_message_id, job_id, email_subject, email_received_date,
        email_sender_name, email_sender_email, email_body_preview,
        email_has_attachments, processed_at, ai_confidence_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (email_message_id) 
      DO UPDATE SET 
        processed_at = EXCLUDED.processed_at,
        ai_confidence_score = EXCLUDED.ai_confidence_score,
        job_id = COALESCE(EXCLUDED.job_id, shipping_emails.job_id)
      RETURNING email_id
    `;

    const emailValues = [
      email.id,
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

    // Step 2: Insert quote record linked to the email
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

    const quoteValues = [
      emailId,
      parsedData.client_company_name,
      parsedData.contact_person_name,
      parsedData.email_address,
      parsedData.phone_number,
      parsedData.company_address,
      parsedData.client_type,
      parsedData.industry_business_type,
      parsedData.origin_full_address,
      parsedData.origin_city,
      parsedData.origin_state_province,
      parsedData.origin_country,
      parsedData.origin_postal_code,
      parsedData.requested_pickup_date,
      parsedData.pickup_special_requirements,
      parsedData.destination_full_address,
      parsedData.destination_city,
      parsedData.destination_state_province,
      parsedData.destination_country,
      parsedData.destination_postal_code,
      parsedData.requested_delivery_date,
      parsedData.delivery_special_requirements,
      parsedData.cargo_length,
      parsedData.cargo_width,
      parsedData.cargo_height,
      parsedData.dimension_unit,
      parsedData.cargo_weight,
      parsedData.weight_unit,
      parsedData.number_of_pieces,
      parsedData.cargo_description,
      parsedData.hazardous_material,
      parsedData.declared_value,
      parsedData.packaging_type,
      parsedData.service_type,
      parsedData.service_level,
      parsedData.incoterms,
      parsedData.insurance_required,
      parsedData.customs_clearance_needed,
      parsedData.transit_time_quoted,
      parsedData.quote_date,
      parsedData.initial_quote_amount,
      parsedData.revised_quote_1,
      parsedData.revised_quote_2,
      parsedData.discount_given,
      parsedData.discount_reason,
      parsedData.final_agreed_price,
      parsedData.quote_status,
      parsedData.job_won,
      parsedData.rejection_reason,
      parsedData.sales_representative,
      parsedData.lead_source,
      parsedData.special_requirements,
      parsedData.urgency_level,
    ];

    const quoteResult = await client.query(quoteQuery, quoteValues);

    await client.query('COMMIT');

    return {
      email_id: emailId,
      quote_id: quoteResult.rows[0].quote_id,
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
 * @returns {Promise<Object>}
 */
async function getProcessingStats() {
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
 * @returns {Promise<string|null>} ISO string of last received datetime or null
 */
async function getLatestLastReceivedDateTime() {
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
 * @param {Object} job - Job object
 */
async function saveJobToDatabase(job) {
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
 * @param {string} jobId - Job ID
 * @returns {Object|null} - Job object or null
 */
async function getJobFromDatabase(jobId) {
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
 * @param {Object} job - Job object
 */
async function updateJobInDatabase(job) {
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

/**
 * Get job statistics from database
 * @param {Object} filters - Optional filters (e.g., date range, status)
 * @returns {Promise<Object>} - Aggregated statistics
 */
async function getJobStatistics(filters = {}) {
  const client = await pool.connect();
  try {
    let whereClause = '';
    const params = [];

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
 * @param {string} jobId - Job ID
 * @returns {Promise<Array>} - Array of email objects with quote counts
 */
async function getEmailsByJobId(jobId) {
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
 * @param {number} emailId - Email ID
 * @returns {Promise<Array>} - Array of quote objects
 */
async function getQuotesByEmailId(emailId) {
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
 * @param {string} messageId - Email message ID
 * @returns {Promise<Object|null>} - Email object or null
 */
async function getEmailByMessageId(messageId) {
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
};
