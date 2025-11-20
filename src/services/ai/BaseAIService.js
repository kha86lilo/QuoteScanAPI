/**
 * Base AI Service
 * Abstract base class for all AI parsing services
 * Provides common functionality like retry logic, batch processing, and confidence calculation
 */

import dotenv from 'dotenv';
dotenv.config();

export default class BaseAIService {
  constructor(serviceName = 'BaseAI') {
    this.serviceName = serviceName;
  }

  /**
   * Abstract method - must be implemented by child classes
   * Parse email with AI to extract shipping quote data
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {number} maxRetries - Number of retry attempts for rate limits
   * @param {string} attachmentText - Optional extracted text from attachments
   * @returns {Promise<Object|null>} Parsed quote data
   */
  async parseEmail(email, maxRetries = 3, attachmentText = '') {
    throw new Error('parseEmail() must be implemented by child class');
  }

  /**
   * Prepare email content for AI parsing
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {string} attachmentText - Optional extracted text from attachments
   * @returns {string} Formatted email content
   */
  prepareEmailContent(email, attachmentText = '') {
    const subject = email.subject || '';
    const senderName = email.from?.emailAddress?.name || '';
    const senderAddress = email.from?.emailAddress?.address || '';
    const receivedDate = email.receivedDateTime || '';
    let bodyContent = email.bodyPreview || '';

    const MAX_BODY_CHARS = process.env.MAX_BODY_CHARS || 15000;
    if (bodyContent.length > MAX_BODY_CHARS) {
      console.log(`  ⚠ Email body very long (${bodyContent.length} chars), truncating...`);
      bodyContent =
        bodyContent.substring(0, MAX_BODY_CHARS) + '\n\n[... Email truncated due to length ...]';
    }

    let content = `
Subject: ${subject}
From: ${senderName} <${senderAddress}>
Date: ${receivedDate}

Body:
${bodyContent}
`;

    // Add attachment text if available
    if (attachmentText && attachmentText.trim()) {
      content += `\n\n========================================\nATTACHMENT CONTENT:\n========================================\n${attachmentText}`;
    }

    return content;
  }

  /**
   * Get the standard extraction prompt
   * @param {string} emailContent - Formatted email content
   * @returns {string} AI prompt for data extraction
   */
  getExtractionPrompt(emailContent) {
    return `You are an expert data extraction assistant for Seahorse Express, a shipping and 3PL logistics company. 

Extract shipping quote information from this customer email and return it as a JSON object. This email may contain MULTIPLE shipping quotes/requests. Extract as much information as possible, but if a field is not mentioned in the email, set it to null.

Email to parse:
${emailContent}

Return a JSON object with this structure:

{
  "client_info": {
    "client_company_name": "Company name",
    "contact_person_name": "Contact person",
    "email_address": "email@example.com",
    "phone_number": "Phone",
    "company_address": "Full address",
    "client_type": "New or Existing",
    "industry_business_type": "Industry type"
  },
  "quotes": [
    {
      "origin_full_address": "Pickup address",
      "origin_city": "City",
      "origin_state_province": "State/Province",
      "origin_country": "Country",
      "origin_postal_code": "Postal code",
      "requested_pickup_date": "YYYY-MM-DD or null",
      "pickup_special_requirements": "Special requirements",
      
      "destination_full_address": "Delivery address",
      "destination_city": "City",
      "destination_state_province": "State/Province",
      "destination_country": "Country",
      "destination_postal_code": "Postal code",
      "requested_delivery_date": "YYYY-MM-DD or null",
      "delivery_special_requirements": "Special requirements",
      
      "cargo_length": 0.0,
      "cargo_width": 0.0,
      "cargo_height": 0.0,
      "dimension_unit": "Meters/Feet/Inches/CM",
      "cargo_weight": 0.0,
      "weight_unit": "KG/Tonnes/Pounds/LBS",
      "number_of_pieces": 0,
      "cargo_description": "Description",
      "hazardous_material": false,
      "declared_value": 0.0,
      "packaging_type": "Type",
      
      "service_type": "Air/Ocean/Ground/Rail/Intermodal",
      "service_level": "Express/Standard/Economy",
      "incoterms": "FOB/CIF/DDP/EXW/etc",
      "insurance_required": false,
      "customs_clearance_needed": false,
      "transit_time_quoted": 0,
      
      "quote_date": "YYYY-MM-DD or null",
      "initial_quote_amount": 0.0,
      "revised_quote_1": null,
      "revised_quote_2": null,
      "discount_given": 0.0,
      "discount_reason": null,
      "final_agreed_price": null,
      
      "quote_status": "Pending/Approved/Rejected/Expired",
      "job_won": null,
      "rejection_reason": null,
      
      "sales_representative": "Name",
      "lead_source": "Website/Referral/Email/Phone/etc",
      "special_requirements": "Any special notes",
      "urgency_level": "Rush/Standard/Flexible"
    }
  ]
}

IMPORTANT: 
- Return ONLY valid JSON, no markdown code blocks, no other text
- Do not wrap the JSON in \`\`\`json or \`\`\` tags
- Start directly with { and end with }
- If the email contains multiple shipments/quotes, create multiple objects in the "quotes" array
- Each quote in the array should have all the fields listed above
- The "client_info" should be extracted once and shared across all quotes
- Use null for any field not found in the email
- Convert all amounts to USD if currency is mentioned
- Standardize dates to YYYY-MM-DD format
- Extract numeric values only (no units in number fields)
- Be thorough and extract every detail mentioned for each quote`;
  }

  /**
   * Clean and parse AI response to extract JSON
   * @param {string} responseText - Raw AI response
   * @returns {Object} Parsed JSON object
   */
  cleanAndParseResponse(responseText) {
    let cleanedText = responseText.trim();

    // Strip markdown code blocks if present
    if (cleanedText.startsWith('```')) {
      const lines = cleanedText.split('\n');
      lines.shift(); // Remove first line with ```
      if (lines[lines.length - 1].trim() === '```') {
        lines.pop(); // Remove last line with ```
      }
      cleanedText = lines.join('\n');
    }

    return JSON.parse(cleanedText);
  }

  /**
   * Calculate confidence score based on filled fields
   * @param {Object} parsedData - Parsed quote data with client_info and quotes array
   * @returns {number} Confidence score (0.0 to 1.0)
   */
  calculateConfidence(parsedData) {
    if (!parsedData || !parsedData.quotes || parsedData.quotes.length === 0) {
      return 0.0;
    }

    // Calculate average confidence across all quotes
    let totalConfidence = 0;
    
    // Count client_info fields
    const clientFields = Object.keys(parsedData.client_info || {}).length;
    const filledClientFields = Object.values(parsedData.client_info || {}).filter(
      (v) => v !== null && v !== '' && v !== 0
    ).length;

    for (const quote of parsedData.quotes) {
      const quoteFields = Object.keys(quote).length;
      const filledQuoteFields = Object.values(quote).filter(
        (v) => v !== null && v !== '' && v !== 0
      ).length;
      
      const totalFields = clientFields + quoteFields;
      const filledFields = filledClientFields + filledQuoteFields;
      
      totalConfidence += totalFields > 0 ? filledFields / totalFields : 0;
    }

    return parseFloat((totalConfidence / parsedData.quotes.length).toFixed(2));
  }

  /**
   * Handle retry logic for rate limiting
   * @param {Function} apiCallFn - Async function that makes the API call
   * @param {number} maxRetries - Maximum number of retries
   * @param {Array} rateLimitStatuses - HTTP status codes that indicate rate limiting
   * @returns {Promise<any>} API response
   */
  async withRetry(apiCallFn, maxRetries = 3, rateLimitStatuses = [429]) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await apiCallFn();
      } catch (error) {
        const status = error?.status || error?.response?.status;

        // Handle rate limiting with exponential backoff
        if (rateLimitStatuses.includes(status) && attempt < maxRetries - 1) {
          const waitTime = 60 * (attempt + 1);
          console.log(
            `  ⚠ Rate limit hit. Waiting ${waitTime} seconds before retry ${attempt + 2}/${maxRetries}...`
          );
          await this.sleep(waitTime * 1000);
          continue;
        }

        // Handle JSON parse errors
        if (error instanceof SyntaxError) {
          console.error(`  ✗ Failed to parse ${this.serviceName} response as JSON:`, error.message);
          return null;
        }

        // Log other errors
        console.error(`  ✗ ${this.serviceName} API error:`, error.message || error.toString());

        // Return null on last attempt
        if (attempt === maxRetries - 1) {
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Batch parse multiple emails
   * @param {Array} emails - Array of email objects
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Array>} Array of parsed results
   */
  async batchParseEmails(emails, progressCallback = null) {
    const results = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];

      if (progressCallback) {
        progressCallback(i + 1, emails.length, email.subject);
      }

      const parsedData = await this.parseEmail(email);

      results.push({
        email,
        parsedData,
        success: parsedData !== null,
      });

      // Delay between requests to avoid rate limiting
      if (i < emails.length - 1) {
        await this.sleep(8000);
      }
    }

    return results;
  }

  /**
   * Helper function to sleep/delay
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Abstract method - must be implemented by child classes
   * Validate API key/credentials
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    throw new Error('validateApiKey() must be implemented by child class');
  }
}
