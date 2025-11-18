/**
 * Gemini AI Service
 * Handles email parsing using Google's Gemini API
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

class GeminiService {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });
  }

  /**
   * Parse email with Gemini AI to extract shipping quote data
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {number} maxRetries - Number of retry attempts for rate limits
   * @returns {Promise<Object|null>} Parsed quote data
   */
  async parseEmailWithGemini(email, maxRetries = 3) {
    const subject = email.subject || '';
    const senderName = email.from?.emailAddress?.name || '';
    const senderAddress = email.from?.emailAddress?.address || '';
    const receivedDate = email.receivedDateTime || '';
    let bodyContent = email.body?.content || '';

    const MAX_BODY_CHARS = process.env.MAX_BODY_CHARS || 1200000;
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

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }]}]
        });

        let responseText = (await result.response.text()).trim();

        if (responseText.startsWith('```')) {
          const lines = responseText.split('\n');
          lines.shift();
          if (lines[lines.length - 1].trim() === '```') {
            lines.pop();
          }
          responseText = lines.join('\n');
        }

        const parsedData = JSON.parse(responseText);

        const totalFields = Object.keys(parsedData).length;
        const filledFields = Object.values(parsedData).filter(
          v => v !== null && v !== "" && v !== 0
        ).length;
        const confidence = totalFields > 0 ? (filledFields / totalFields).toFixed(2) : 0.0;

        parsedData.ai_confidence_score = parseFloat(confidence);

        console.log(`  ✓ Parsed email with Gemini (confidence: ${confidence})`);
        return parsedData;

      } catch (error) {
        const status = error?.status || error?.response?.status;
        if (status === 429 && attempt < maxRetries - 1) {
          const waitTime = 60 * (attempt + 1);
          console.log(`  ⚠ Rate limit hit. Waiting ${waitTime} seconds before retry ${attempt + 2}/${maxRetries}...`);
          await this.sleep(waitTime * 1000);
          continue;
        }

        if (error instanceof SyntaxError) {
          console.error(`  ✗ Failed to parse Gemini response as JSON:`, error.message);
          return null;
        }

        console.error(`  ✗ Gemini API error:`, error.message || error.toString());

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

      const parsedData = await this.parseEmailWithGemini(email);

      results.push({
        email,
        parsedData,
        success: parsedData !== null
      });

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
   * Validate Gemini API key
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    try {
      await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }]}]
      });
      return true;
    } catch (error) {
      console.error('✗ Invalid Gemini API key:', error.message || error.toString());
      return false;
    }
  }

  /**
   * List available Gemini models from the API
   * @param {boolean} filterGenerateContent - When true, only include models supporting generateContent
   * @returns {Promise<Array>} Simplified list of models
   */
  async listAvailableModels(filterGenerateContent = true) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('✗ GEMINI_API_KEY is not set');
      return [];
    }

    // Simple in-memory cache to avoid frequent calls
    const now = Date.now();
    if (this._modelsCache && this._modelsCache.timestamp && (now - this._modelsCache.timestamp < 5 * 60 * 1000)) {
      return filterGenerateContent
        ? this._modelsCache.data.filter(m => (m.supported || []).includes('generateContent'))
        : this._modelsCache.data;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`✗ Failed to list models: ${res.status} ${res.statusText}`);
        return [];
      }
      const json = await res.json();
      const models = (json.models || []).map(m => {
        const name = m.name?.startsWith('models/') ? m.name.replace('models/', '') : m.name;
        return {
          name,
            displayName: m.displayName || name,
            description: m.description || null,
            inputTokens: m.inputTokenLimit || null,
            outputTokens: m.outputTokenLimit || null,
            supported: m.supportedGenerationMethods || [],
            baseModel: m.baseModel || null
        };
      });

      this._modelsCache = { data: models, timestamp: now };

      return filterGenerateContent
        ? models.filter(m => (m.supported || []).includes('generateContent'))
        : models;
    } catch (error) {
      console.error('✗ Error fetching models:', error.message || error.toString());
      return [];
    }
  }
}

const geminiService = new GeminiService();
export default geminiService;
export const { parseEmailWithGemini, validateApiKey, listAvailableModels } = geminiService;
