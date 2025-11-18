/**
 * Claude AI Service
 * Handles email parsing using Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  /**
   * Parse email with Claude AI to extract shipping quote data
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {number} maxRetries - Number of retry attempts for rate limits
   * @returns {Promise<Object|null>} Parsed quote data
   */
  async parseEmailWithClaude(email, maxRetries = 3) {
    // Prepare email content
    const subject = email.subject || '';
    const senderName = email.from?.emailAddress?.name || '';
    const senderAddress = email.from?.emailAddress?.address || '';
    const receivedDate = email.receivedDateTime || '';
    let bodyContent = email.body?.content || '';

    // Truncate very long emails (stay under 200k token limit)
    // Rough estimate: 1 token ≈ 4 characters
    // Safe limit: 150k tokens ≈ 600k characters
    const MAX_BODY_CHARS = process.env.MAX_BODY_CHARS || 800000;
    
    if (bodyContent.length > MAX_BODY_CHARS) {
      console.log(`  ⚠ Email body very long (${bodyContent.length} chars), truncating...`);
      bodyContent = bodyContent.substring(0, MAX_BODY_CHARS) + "\n\n[... Email truncated due to length ...]";
    }

    const emailContent = `
Subject: ${subject}
From: ${senderName} <${senderAddress}>
Date: ${receivedDate}

Body:
${bodyContent}
`;

    // Create prompt for Claude
    const prompt = `You are an expert data extraction assistant for Seahorse Express, a shipping and 3PL logistics company. 

Extract shipping quote information from this customer email and return it as a JSON object. Extract as much information as possible, but if a field is not mentioned in the email, set it to null.

Email to parse:
${emailContent}

Return a JSON object with these exact fields (use null for missing data):

{
  "client_company_name": "Company name",
  "contact_person_name": "Contact person",
  "email_address": "email@example.com",
  "phone_number": "Phone",
  "company_address": "Full address",
  "client_type": "New or Existing",
  "industry_business_type": "Industry type",
  
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

IMPORTANT: 
- Return ONLY valid JSON, no markdown code blocks, no other text
- Do not wrap the JSON in \`\`\`json or \`\`\` tags
- Start directly with { and end with }
- Use null for any field not found in the email
- Convert all amounts to USD if currency is mentioned
- Standardize dates to YYYY-MM-DD format
- Extract numeric values only (no units in number fields)
- Be thorough and extract every detail mentioned`;

    // Call Claude API with retry logic
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const message = await this.client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [
            { role: 'user', content: prompt }
          ]
        });

        // Extract JSON from response
        let responseText = message.content[0].text.trim();

        // Strip markdown code blocks if present
        if (responseText.startsWith('```')) {
          const lines = responseText.split('\n');
          lines.shift(); // Remove first line with ```
          if (lines[lines.length - 1].trim() === '```') {
            lines.pop(); // Remove last line with ```
          }
          responseText = lines.join('\n');
        }

        // Parse JSON
        const parsedData = JSON.parse(responseText);

        // Calculate confidence score
        const totalFields = Object.keys(parsedData).length;
        const filledFields = Object.values(parsedData).filter(
          v => v !== null && v !== "" && v !== 0
        ).length;
        const confidence = totalFields > 0 ? (filledFields / totalFields).toFixed(2) : 0.0;

        parsedData.ai_confidence_score = parseFloat(confidence);

        console.log(`  ✓ Parsed email with Claude (confidence: ${confidence})`);
        return parsedData;

      } catch (error) {
        // Handle rate limit errors with retry
        if (error.status === 429 && attempt < maxRetries - 1) {
          const waitTime = 60 * (attempt + 1); // Wait 60, 120, 180 seconds
          console.log(`  ⚠ Rate limit hit. Waiting ${waitTime} seconds before retry ${attempt + 2}/${maxRetries}...`);
          await this.sleep(waitTime * 1000);
          continue;
        }

        // Handle JSON parse errors
        if (error instanceof SyntaxError) {
          console.error(`  ✗ Failed to parse Claude response as JSON:`, error.message);
          return null;
        }

        // Handle other errors
        console.error(`  ✗ Claude API error:`, error.message);
        
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

      const parsedData = await this.parseEmailWithClaude(email);
      
      results.push({
        email,
        parsedData,
        success: parsedData !== null
      });

      // Delay to avoid rate limiting (8 seconds between requests)
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate Claude API key
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    try {
      await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [
          { role: 'user', content: 'Hello' }
        ]
      });
      return true;
    } catch (error) {
      console.error('✗ Invalid Anthropic API key:', error.message);
      return false;
    }
  }
}

const claudeService = new ClaudeService();
export default claudeService;
export const { parseEmailWithClaude, testConnection } = claudeService;
