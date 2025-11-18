/**
 * ChatGPT (OpenAI) Service
 * Handles email parsing using OpenAI's Chat Completions API
 */

import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

class ChatGPTService {
  constructor() {
    const apiKey = process.env.GPT_API_KEY;
    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  /**
   * Parse email with ChatGPT to extract shipping quote data
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {number} maxRetries - Number of retry attempts for rate limits
   * @returns {Promise<Object|null>} Parsed quote data
   */
  async parseEmailWithChatGPT(email, maxRetries = 3) {
    const subject = email.subject || "";
    const senderName = email.from?.emailAddress?.name || "";
    const senderAddress = email.from?.emailAddress?.address || "";
    const receivedDate = email.receivedDateTime || "";
    let bodyContent = email.body?.content || "";

    const MAX_BODY_CHARS = process.env.MAX_BODY_CHARS || 1200000;
    if (bodyContent.length > MAX_BODY_CHARS) {
      console.log(
        `  ⚠ Email body very long (${bodyContent.length} chars), truncating...`
      );
      bodyContent =
        bodyContent.substring(0, MAX_BODY_CHARS) +
        "\n\n[... Email truncated due to length ...]";
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
        const completion = await this.client.chat.completions.create({
          model: this.model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You extract structured JSON from emails for shipping quotes. Respond with only valid JSON.",
            },
            { role: "user", content: prompt },
          ],
        });

        let responseText = (
          completion.choices?.[0]?.message?.content || ""
        ).trim();

        if (responseText.startsWith("```")) {
          const lines = responseText.split("\n");
          lines.shift();
          if (lines[lines.length - 1].trim() === "```") {
            lines.pop();
          }
          responseText = lines.join("\n");
        }

        const parsedData = JSON.parse(responseText);

        const totalFields = Object.keys(parsedData).length;
        const filledFields = Object.values(parsedData).filter(
          (v) => v !== null && v !== "" && v !== 0
        ).length;
        const confidence =
          totalFields > 0 ? (filledFields / totalFields).toFixed(2) : 0.0;

        parsedData.ai_confidence_score = parseFloat(confidence);

        console.log(
          `  ✓ Parsed email with ChatGPT (confidence: ${confidence})`
        );
        return parsedData;
      } catch (error) {
        const status = error?.status || error?.response?.status;
        if (status === 429 && attempt < maxRetries - 1) {
          const waitTime = 60 * (attempt + 1);
          console.log(
            `  ⚠ Rate limit hit. Waiting ${waitTime} seconds before retry ${
              attempt + 2
            }/${maxRetries}...`
          );
          await this.sleep(waitTime * 1000);
          continue;
        }

        if (error instanceof SyntaxError) {
          console.error(
            "  ✗ Failed to parse ChatGPT response as JSON:",
            error.message
          );
          return null;
        }

        console.error(
          "  ✗ ChatGPT API error:",
          error.message || error.toString()
        );
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

      const parsedData = await this.parseEmailWithChatGPT(email);

      results.push({
        email,
        parsedData,
        success: parsedData !== null,
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
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Validate OpenAI API key
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    try {
      await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "user", content: "Hello" }],
      });
      return true;
    } catch (error) {
      console.error(
        "✗ Invalid OpenAI API key:",
        error.message || error.toString()
      );
      return false;
    }
  }

  /**
   * List available OpenAI models
   * @returns {Promise<Array>} Simplified list of models
   */
  async listAvailableModels() {
    try {
      const res = await this.client.models.list();
      const models = (res.data || []).map((m) => ({
        name: m.id,
        ownedBy: m.owned_by || null,
        created: m.created || null,
      }));
      return models;
    } catch (error) {
      console.error(
        "✗ Error listing OpenAI models:",
        error.message || error.toString()
      );
      return [];
    }
  }
}

const chatgptService = new ChatGPTService();
export default chatgptService;
export const { parseEmailWithChatGPT, validateApiKey, listAvailableModels } =
  chatgptService;
