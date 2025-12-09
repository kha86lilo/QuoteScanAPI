/**
 * Base AI Service
 * Abstract base class for all AI parsing services
 */

import dotenv from 'dotenv';
import type { Email, ParsedEmailData, Quote, QuoteMatch, AIPricingDetails } from '../../types/index.js';
dotenv.config();

interface BatchParseResult {
  email: Email;
  parsedData: ParsedEmailData | null;
  success: boolean;
}

interface MarketData {
  fuelSurcharge?: number;
}

export default abstract class BaseAIService {
  serviceName: string;

  constructor(serviceName = 'BaseAI') {
    this.serviceName = serviceName;
  }

  /**
   * Abstract method - must be implemented by child classes
   */
  abstract parseEmail(email: Email, maxRetries?: number, attachmentText?: string): Promise<ParsedEmailData | null>;

  /**
   * Abstract method - must be implemented by child classes
   */
  abstract validateApiKey(): Promise<boolean>;

  /**
   * Abstract method - must be implemented by child classes
   */
  abstract generateResponse(prompt: string): Promise<string>;

  /**
   * Prepare email content for AI parsing
   */
  prepareEmailContent(email: Email, attachmentText = ''): string {
    const subject = email.subject || '';
    const senderName = email.from?.emailAddress?.name || '';
    const senderAddress = email.from?.emailAddress?.address || '';
    const receivedDate = email.receivedDateTime || '';

    let bodyContent = email.body?.content || email.bodyPreview || '';

    if (email.body?.contentType === 'html') {
      bodyContent = bodyContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    }

    const MAX_BODY_CHARS = parseInt(process.env.MAX_BODY_CHARS || '15000');
    if (bodyContent.length > MAX_BODY_CHARS) {
      console.log(`  Warning: Email body very long (${bodyContent.length} chars), truncating...`);
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

    if (attachmentText && attachmentText.trim()) {
      content += `\n\n========================================\nATTACHMENT CONTENT:\n========================================\n${attachmentText}`;
    }

    return content;
  }

  /**
   * Get the standard extraction prompt
   */
  getExtractionPrompt(emailContent: string): string {
    const today = new Date().toISOString().split('T')[0];
    return `You are an expert data extraction assistant for Seahorse Express, a specialized shipping and 3PL logistics company focused on OVERWEIGHT and OVERSIZED cargo transport.

CRITICAL CONTEXT - READ CAREFULLY:
You are analyzing an EMAIL THREAD which may contain multiple back-and-forth messages between the client and Seahorse Express. The thread shows the conversation history from oldest (bottom) to newest (top). You MUST:

1. READ THE ENTIRE THREAD to understand the complete context
2. Track information across multiple messages (initial request + follow-up clarifications)
3. Identify what the client originally requested vs. what was quoted vs. what was accepted/negotiated
4. Determine the CURRENT STATUS of each quote based on the latest communication
5. Handle MULTIPLE QUOTES in a single thread (different services, different items, or both)

Email to parse:
${emailContent}

Return a JSON object with this structure:

{
  "email_thread_summary": {
    "thread_type": "Initial Request/Follow-up/Quote Provided/Negotiation/Acceptance/Rejection",
    "number_of_exchanges": 0,
    "missing_information_requested": ["List items Seahorse asked to clarify"],
    "conversation_summary": "Brief summary of the back-and-forth conversation"
  },
  "client_info": {
    "client_company_name": "Company name",
    "contact_person_name": "Contact person",
    "contact_title": "Job title if mentioned",
    "email_address": "email@example.com",
    "phone_number": "Phone number",
    "company_address": "Full address",
    "client_type": "New/Existing/Unknown",
    "industry_business_type": "Industry type",
    "client_location_country": "Country where client is based"
  },
  "quotes": [
    {
      "quote_identifier": "Quote ID/reference number if mentioned",
      "quote_sequence_number": 1,
      "origin_full_address": "Complete pickup address",
      "origin_city": "City",
      "origin_state_province": "State/Province",
      "origin_country": "Country",
      "origin_postal_code": "Postal/ZIP code",
      "destination_full_address": "Complete delivery address",
      "destination_city": "City",
      "destination_state_province": "State/Province",
      "destination_country": "Country",
      "destination_postal_code": "Postal/ZIP code",
      "cargo_length": 0.0,
      "cargo_width": 0.0,
      "cargo_height": 0.0,
      "dimension_unit": "ft/feet/in/inches/m/meters/cm/mm",
      "cargo_weight": 0.0,
      "weight_unit": "lbs/pounds/kg/kilograms/tonnes/tons",
      "number_of_pieces": 0,
      "cargo_description": "Detailed description of cargo",
      "hazardous_material": false,
      "service_type": "Ground/Ocean/Air/Rail/Intermodal/Drayage",
      "service_level": "Standard/Expedited/Rush/Economy/White Glove",
      "quote_status": "Pending/Quoted/Negotiating/Accepted/Rejected/Expired/Booked",
      "initial_quote_amount": 0.0,
      "final_agreed_price": null,
      "urgency_level": "Rush/Hot/Standard/Flexible",
      "special_requirements": "All special notes and requirements"
    }
  ]
}

CRITICAL EXTRACTION RULES:

JSON FORMAT:
- Return ONLY valid JSON, no markdown code blocks, no explanatory text
- Do NOT wrap in \`\`\`json or \`\`\` tags - start with { and end with }
- All field names must be in double quotes
- Use null for missing fields (not "null" string, not empty string, but actual null)

Handle relative dates: "next Monday" → calculate actual date based on email date. Today's date is ${today}.

Return complete, accurate JSON following this structure exactly.`;
  }

  /**
   * Clean and parse AI response to extract JSON
   */
  cleanAndParseResponse(responseText: string): ParsedEmailData {
    let cleanedText = responseText.trim();

    if (cleanedText.startsWith('```')) {
      const lines = cleanedText.split('\n');
      lines.shift();
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop();
      }
      cleanedText = lines.join('\n');
    }

    return JSON.parse(cleanedText) as ParsedEmailData;
  }

  /**
   * Calculate confidence score based on filled fields
   */
  calculateConfidence(parsedData: ParsedEmailData): number {
    if (!parsedData || !parsedData.quotes || parsedData.quotes.length === 0) {
      return 0.0;
    }

    let totalConfidence = 0;

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
   */
  async withRetry<T>(
    apiCallFn: () => Promise<T>,
    maxRetries = 3,
    rateLimitStatuses = [429]
  ): Promise<T | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await apiCallFn();
      } catch (error) {
        const err = error as { status?: number; response?: { status?: number }; message?: string };
        const status = err.status || err.response?.status;

        if (status && rateLimitStatuses.includes(status) && attempt < maxRetries - 1) {
          const waitTime = 60 * (attempt + 1);
          console.log(
            `  Warning: Rate limit hit. Waiting ${waitTime} seconds before retry ${attempt + 2}/${maxRetries}...`
          );
          await this.sleep(waitTime * 1000);
          continue;
        }

        if (error instanceof SyntaxError) {
          console.error(`  Error: Failed to parse ${this.serviceName} response as JSON:`, error.message);
          return null;
        }

        console.error(`  Error: ${this.serviceName} API error:`, err.message || String(error));

        if (attempt === maxRetries - 1) {
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Batch parse multiple emails
   */
  async batchParseEmails(
    emails: Email[],
    progressCallback: ((current: number, total: number, subject: string) => void) | null = null
  ): Promise<BatchParseResult[]> {
    const results: BatchParseResult[] = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      if (!email) continue;

      if (progressCallback) {
        progressCallback(i + 1, emails.length, email.subject || '');
      }

      const parsedData = await this.parseEmail(email);

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
   */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get pricing recommendation from AI based on quote and historical matches
   */
  async getPricingRecommendation(sourceQuote: Quote, matches: QuoteMatch[]): Promise<AIPricingDetails | null> {
    const prompt = this.getPricingPrompt(sourceQuote, matches);

    return await this.withRetry(async () => {
      const responseText = await this.generateResponse(prompt);
      const parsedData = this.cleanAndParseResponse(responseText);

      console.log(`  Success: Generated pricing recommendation with ${this.serviceName}`);
      return parsedData as unknown as AIPricingDetails;
    }, 2);
  }

  /**
   * Get the pricing recommendation prompt
   */
  getPricingPrompt(sourceQuote: Quote, matches: QuoteMatch[], marketData: MarketData = { fuelSurcharge: 0.3 }): string {
    const topMatches = matches.slice(0, 5);

    return `You are a senior pricing analyst at a drayage and transportation company with 15+ years of experience. Your role is to provide accurate, competitive quotes that win business while maintaining profitability.

## QUOTE REQUEST TO PRICE
- **Route**: ${sourceQuote.origin_city || 'Unknown'}, ${sourceQuote.origin_state_province || ''} ${sourceQuote.origin_country || ''} → ${sourceQuote.destination_city || 'Unknown'}, ${sourceQuote.destination_state_province || ''} ${sourceQuote.destination_country || ''}
- **Service Type**: ${sourceQuote.service_type || 'Not specified'}
- **Cargo Description**: ${sourceQuote.cargo_description || 'Not specified'}
- **Weight**: ${sourceQuote.cargo_weight || 'Not specified'} ${sourceQuote.weight_unit || ''}
- **Pieces**: ${sourceQuote.number_of_pieces || 'Not specified'}
- **Dimensions**: ${sourceQuote.cargo_length ? `${sourceQuote.cargo_length} x ${sourceQuote.cargo_width} x ${sourceQuote.cargo_height} ${sourceQuote.dimension_unit || ''}` : 'Not specified'}
- **Hazmat**: ${sourceQuote.hazardous_material ? 'Yes' : 'No'}

## SIMILAR HISTORICAL QUOTES FOR REFERENCE
${topMatches.map((m, i) => `
### Match ${i + 1} (${(m.similarity_score * 100).toFixed(0)}% similar)
- Route: ${m.matchedQuoteData?.origin || 'Unknown'} → ${m.matchedQuoteData?.destination || 'Unknown'}
- Service: ${m.matchedQuoteData?.service || 'Unknown'}
- Cargo: ${m.matchedQuoteData?.cargo || 'Not specified'}
- Initial Quote: $${m.matchedQuoteData?.initialPrice?.toLocaleString() || 'N/A'}
- Final Agreed Price: $${m.matchedQuoteData?.finalPrice?.toLocaleString() || 'N/A'}
- Date: ${m.matchedQuoteData?.quoteDate ? new Date(m.matchedQuoteData.quoteDate).toLocaleDateString() : 'Unknown'}
- Status: ${m.matchedQuoteData?.status || 'Unknown'}
`).join('\n')}

## PRICING FACTORS TO CONSIDER
- Mileage-based rates ($2.50-4.50 per mile for FTL)
- Fuel surcharge (currently ~${((marketData.fuelSurcharge || 0.3) * 100).toFixed(0)}% of linehaul)
- Accessorials (liftgate, inside delivery, detention)
- Lane density (headhaul vs backhaul)
- Equipment type premiums (flatbed +15-25%)
- Port/terminal fees for drayage

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no explanation):

{
  "recommended_price": 0.00,
  "floor_price": 0.00,
  "target_price": 0.00,
  "ceiling_price": 0.00,
  "confidence": "HIGH|MEDIUM|LOW",
  "price_breakdown": {
    "linehaul": 0.00,
    "fuel_surcharge": 0.00,
    "accessorials": 0.00,
    "margin": 0.00
  },
  "reasoning": "Brief explanation of pricing logic",
  "market_factors": ["Factor 1", "Factor 2"],
  "negotiation_room_percent": 10
}`;
  }
}
