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
      'SELECT COUNT(*) FROM shipping_quotes WHERE email_message_id = $1',
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
 * @returns {Promise<Object>} - Database insert result
 */
async function saveQuoteToDatabase(email, parsedData) {
  const client = await pool.connect();

  try {
    const query = `
      INSERT INTO shipping_quotes (
        email_message_id, email_subject, email_received_date,
        email_sender_name, email_sender_email, email_body_preview,
        email_has_attachments, raw_email_body,
        
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
        urgency_level, ai_confidence_score, processed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27, $28, $29,
        $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46,
        $47, $48, $49, $50, $51, $52, $53,
        $54, $55, $56,
        $57, $58, $59, $60, $61, $62
      ) RETURNING quote_id
    `;

    const values = [
      email.id,
      email.subject,
      email.receivedDateTime,
      email.from?.emailAddress?.name,
      email.from?.emailAddress?.address,
      email.bodyPreview,
      email.hasAttachments || false,
      email.body?.content,

      // Client info
      parsedData.client_company_name,
      parsedData.contact_person_name,
      parsedData.email_address,
      parsedData.phone_number,
      parsedData.company_address,
      parsedData.client_type,
      parsedData.industry_business_type,

      // Origin
      parsedData.origin_full_address,
      parsedData.origin_city,
      parsedData.origin_state_province,
      parsedData.origin_country,
      parsedData.origin_postal_code,
      parsedData.requested_pickup_date,
      parsedData.pickup_special_requirements,

      // Destination
      parsedData.destination_full_address,
      parsedData.destination_city,
      parsedData.destination_state_province,
      parsedData.destination_country,
      parsedData.destination_postal_code,
      parsedData.requested_delivery_date,
      parsedData.delivery_special_requirements,

      // Cargo
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

      // Service
      parsedData.service_type,
      parsedData.service_level,
      parsedData.incoterms,
      parsedData.insurance_required,
      parsedData.customs_clearance_needed,
      parsedData.transit_time_quoted,

      // Quote/Pricing
      parsedData.quote_date,
      parsedData.initial_quote_amount,
      parsedData.revised_quote_1,
      parsedData.revised_quote_2,
      parsedData.discount_given,
      parsedData.discount_reason,
      parsedData.final_agreed_price,

      // Status
      parsedData.quote_status,
      parsedData.job_won,
      parsedData.rejection_reason,

      // Additional
      parsedData.sales_representative,
      parsedData.lead_source,
      parsedData.special_requirements,
      parsedData.urgency_level,
      parsedData.ai_confidence_score,
      new Date(),
    ];

    const result = await client.query(query, values);
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get statistics about processed emails
 * @returns {Promise<Object>}
 */
async function getProcessingStats() {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_emails,
        COUNT(CASE WHEN quote_status = 'Approved' THEN 1 END) as approved_quotes,
        COUNT(CASE WHEN job_won = true THEN 1 END) as jobs_won,
        AVG(ai_confidence_score) as avg_confidence,
        MAX(processed_at) as last_processed
      FROM shipping_quotes
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

export {
  pool,
  checkEmailExists,
  saveQuoteToDatabase,
  getProcessingStats,
  getLatestLastReceivedDateTime,
};
