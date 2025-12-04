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

    // Use full email body if available, otherwise fall back to bodyPreview
    let bodyContent = email.body?.content || email.bodyPreview || '';

    // Strip HTML tags if body is in HTML format
    if (email.body?.contentType === 'html') {
      bodyContent = bodyContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    }

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
    return `You are an expert data extraction assistant for Seahorse Express, a specialized shipping and 3PL logistics company focused on OVERWEIGHT and OVERSIZED cargo transport.

CRITICAL CONTEXT - READ CAREFULLY:
You are analyzing an EMAIL THREAD which may contain multiple back-and-forth messages between the client and Seahorse Express. The thread shows the conversation history from oldest (bottom) to newest (top). You MUST:

1. READ THE ENTIRE THREAD to understand the complete context
2. Track information across multiple messages (initial request + follow-up clarifications)
3. Identify what the client originally requested vs. what was quoted vs. what was accepted/negotiated
4. Determine the CURRENT STATUS of each quote based on the latest communication
5. Handle MULTIPLE QUOTES in a single thread (different services, different items, or both)

INDUSTRY EXPERTISE - OVERWEIGHT/OVERSIZED TRANSPORT:
This company specializes in overweight and oversized cargo. You must understand:

TRUCK TYPES & CAPACITY:
- Flatbed: 48-53ft, up to 48,000 lbs, for oversized/awkward cargo, no height restrictions
- Step Deck (Stepdeck): 48-53ft, lower deck for tall cargo (up to 11.5ft), 48,000 lbs capacity
- Double Drop (Lowboy): For extremely tall/heavy equipment, 40-53ft, clearance up to 11.6ft
- RGN (Removable Gooseneck): Heavy equipment 40-53ft, detachable front for drive-on loading
- Conestoga: Flatbed with retractable tarp system, weather protection, 45-53ft
- Dry Van: Enclosed 53ft, 45,000 lbs, standard freight
- Reefer (Refrigerated): 53ft, temperature-controlled, 42,000-44,000 lbs
- Power Only: Tractor unit only (client provides trailer)
- Hotshot: Smaller trucks for urgent/expedited delivery
- Specialized Heavy Haul: For extreme overweight (80,000+ lbs) requiring permits

COMMON CARGO TERMS:
- Overweight: Exceeds 80,000 lbs (36,287 kg) total vehicle weight
- Oversize: Width >8.5ft (2.59m), Height >13.5ft (4.11m), Length >53ft (16.15m)
- Overdimensional (OD): Same as oversize
- Out of Gauge (OOG): Cargo exceeding standard container dimensions
- Break Bulk: Large cargo that doesn't fit in containers
- Project Cargo: Specialized, complex shipments requiring planning
- LTL (Less Than Truckload): Partial loads, multiple customers
- FTL (Full Truckload): Dedicated truck for one customer
- FCL (Full Container Load): Ocean freight, full 20ft/40ft container
- LCL (Less than Container Load): Ocean freight, shared container
- Drayage: Short-distance transport (port to warehouse)
- Intermodal: Multiple transport modes (truck + rail + ocean)
- Transloading: Transfer between transport modes/containers
- Cross-docking: Transfer from inbound to outbound without storage

PERMITS & REGULATIONS:
- Wide Load Permit: Width >8.5ft
- Overweight Permit: Exceeds state weight limits
- Superload: Extremely large/heavy requiring special routing
- Pilot Car (Escort): Required for oversized loads
- Travel Restrictions: Night/weekend restrictions for oversized
- Tarping Requirements: Securing and weather protection

MEASUREMENT SYSTEMS - CRITICAL:
Clients may use METRIC or US IMPERIAL. You MUST:
- Identify which system is being used from context
- Store the ORIGINAL unit as specified by the client
- Common conversions:
  * Weight: 1 kg = 2.20462 lbs, 1 tonne (metric ton) = 2,204.62 lbs, 1 ton (US) = 2,000 lbs
  * Length: 1 meter = 3.28084 feet = 39.3701 inches, 1 cm = 0.3937 inches
  * Volume: 1 cubic meter = 35.3147 cubic feet
- NEVER convert unless client explicitly requests - store as given
- Watch for mixed units (e.g., "10ft x 3m x 150cm")

INCOTERMS (International Commercial Terms):
- EXW (Ex Works): Buyer arranges everything from seller's location
- FCA (Free Carrier): Seller delivers to carrier
- FOB (Free On Board): Seller loads onto vessel
- CIF (Cost, Insurance, Freight): Seller pays shipping + insurance to destination port
- DDP (Delivered Duty Paid): Seller handles everything including customs
- DAP (Delivered at Place): Seller delivers to destination, buyer handles customs

EMAIL THREAD ANALYSIS:
You will receive emails that may show:
1. INITIAL REQUEST: Client asks for quote with (possibly incomplete) information
2. CLARIFICATION: Seahorse asks for missing details (dimensions, weight, dates, etc.)
3. CLIENT RESPONSE: Provides additional information
4. QUOTE PROVIDED: Seahorse provides pricing
5. NEGOTIATION: Client requests better pricing or modifications
6. REVISED QUOTE: Updated pricing
7. ACCEPTANCE/REJECTION: Client's final decision

You MUST read from BOTTOM to TOP to understand chronological order and track:
- What information was initially provided vs. clarified later
- What was quoted and when
- Whether pricing was negotiated (initial vs revised)
- Current status of each quote

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
      "origin_facility_type": "Port/Warehouse/Manufacturing/Construction Site/etc",
      "requested_pickup_date": "YYYY-MM-DD or null",
      "pickup_time_window": "Time window if specified",
      "pickup_special_requirements": "Loading dock/forklift/crane/etc",

      "destination_full_address": "Complete delivery address",
      "destination_city": "City",
      "destination_state_province": "State/Province",
      "destination_country": "Country",
      "destination_postal_code": "Postal/ZIP code",
      "destination_facility_type": "Port/Warehouse/Construction Site/etc",
      "requested_delivery_date": "YYYY-MM-DD or null",
      "delivery_time_window": "Time window if specified",
      "delivery_special_requirements": "Unloading requirements",

      "total_distance_miles": 0.0,
      "estimated_transit_days": 0,

      "cargo_length": 0.0,
      "cargo_width": 0.0,
      "cargo_height": 0.0,
      "dimension_unit": "ft/feet/in/inches/m/meters/cm/mm",
      "cargo_weight": 0.0,
      "weight_unit": "lbs/pounds/kg/kilograms/tonnes/tons",
      "number_of_pieces": 0,
      "cargo_description": "Detailed description of cargo",
      "cargo_type": "Machinery/Equipment/Steel/Lumber/etc",
      "commodity_code": "HS code if mentioned",

      "is_overweight": false,
      "is_oversized": false,
      "requires_permits": false,
      "permit_type": "Wide Load/Overweight/Superload/null",
      "requires_pilot_car": false,
      "requires_tarping": false,
      "stackable": false,

      "hazardous_material": false,
      "hazmat_class": "UN classification if hazmat",
      "hazmat_un_number": "UN number if hazmat",
      "temperature_controlled": false,
      "temperature_range": "Temperature range if reefer",
      "declared_value": 0.0,
      "declared_value_currency": "USD/CAD/EUR/etc",
      "packaging_type": "Crate/Pallet/Skid/Flatbed/etc",

      "equipment_type_requested": "Flatbed/Step Deck/RGN/Lowboy/Dry Van/Reefer/Conestoga/Power Only/etc",
      "equipment_type_quoted": "What was actually quoted",
      "trailer_length_required": "48ft/53ft/etc",
      "load_type": "FTL/LTL/Partial/FCL/LCL",

      "service_type": "Ground/Ocean/Air/Rail/Intermodal/Drayage",
      "service_level": "Standard/Expedited/Rush/Economy/White Glove",
      "incoterms": "EXW/FCA/FOB/CIF/DDP/DAP/etc or null",
      "insurance_required": false,
      "insurance_amount": 0.0,
      "customs_clearance_needed": false,
      "customs_broker": "Broker name if mentioned",

      "quote_request_date": "YYYY-MM-DD when client requested",
      "quote_provided_date": "YYYY-MM-DD when Seahorse quoted",
      "quote_valid_until": "YYYY-MM-DD expiration",
      "initial_quote_amount": 0.0,
      "initial_quote_currency": "USD/CAD/EUR/etc",
      "revised_quote_1": null,
      "revised_quote_1_date": null,
      "revised_quote_2": null,
      "revised_quote_2_date": null,
      "final_agreed_price": null,
      "discount_given": 0.0,
      "discount_reason": "Volume/Repeat Customer/Competitive Match/etc",
      "additional_charges": "Fuel surcharge/Permits/Escorts/etc",
      "payment_terms": "Net 30/COD/Prepaid/etc",

      "quote_status": "Pending/Quoted/Negotiating/Accepted/Rejected/Expired/Booked",
      "job_won": null,
      "acceptance_date": "YYYY-MM-DD if accepted",
      "rejection_reason": "Price/Timeline/Service Level/Went with competitor/etc",
      "competitor_mentioned": "Competitor name if mentioned",
      "client_response_sentiment": "Positive/Neutral/Negative/Urgent/Price Sensitive",
      "follow_up_required": true,
      "follow_up_reason": "Waiting for client response/Need more info/etc",

      "sales_representative": "Seahorse rep name",
      "client_account_manager": "Client's contact at their company",
      "lead_source": "Website/Referral/Email/Phone/Existing Client/etc",
      "urgency_level": "Rush/Hot/Standard/Flexible",
      "special_requirements": "All special notes and requirements",
      "internal_notes": "Any internal Seahorse notes from thread"
    }
  ]
}

CRITICAL EXTRACTION RULES:

JSON FORMAT:
- Return ONLY valid JSON, no markdown code blocks, no explanatory text
- Do NOT wrap in \`\`\`json or \`\`\` tags - start with { and end with }
- All field names must be in double quotes
- Use null for missing fields (not "null" string, not empty string, but actual null)

THREAD PARSING:
- READ THE ENTIRE EMAIL THREAD from bottom to top (oldest to newest)
- Track what was asked, clarified, quoted, negotiated, and decided
- In "email_thread_summary": Summarize the conversation flow
- In "number_of_exchanges": Count back-and-forth messages
- In "missing_information_requested": List what info Seahorse asked for
- Combine information from multiple messages (e.g., dimensions from one email, weight from follow-up)

MULTIPLE QUOTES:
- Create SEPARATE quote objects for:
  * Different cargo items being shipped
  * Different service types (e.g., one FTL + one LTL)
  * Different routes (different origin/destination combinations)
  * Different equipment types requested
- Use "quote_sequence_number": 1, 2, 3, etc. to order them
- If client mentions "Quote #12345" or similar, capture in "quote_identifier"

OVERWEIGHT/OVERSIZED DETECTION:
- Set "is_overweight": true if weight >80,000 lbs (36,287 kg) OR explicitly mentioned
- Set "is_oversized": true if:
  * Width >8.5ft (2.59m) OR
  * Height >13.5ft (4.11m) OR
  * Length >53ft (16.15m) OR
  * Explicitly mentioned as "oversized", "oversize", "OD", "overdimensional"
- Set "requires_permits": true if overweight/oversized or explicitly mentioned
- Identify "permit_type" from context (wide load, overweight, superload)
- Set "requires_pilot_car": true if mentioned or if extremely oversized
- Infer "equipment_type_requested" from cargo dimensions:
  * >13.5ft tall → Step Deck, Double Drop, or RGN likely needed
  * >48,000 lbs → Heavy Haul
  * Very wide/long → Flatbed or specialized

MEASUREMENT UNITS:
- NEVER convert units - store exactly as client provided
- Store the ORIGINAL unit in dimension_unit and weight_unit fields
- Accept these formats:
  * Weight: "lbs", "pounds", "kg", "kilograms", "tonnes", "tons", "MT" (metric tons)
  * Dimension: "ft", "feet", "in", "inches", "m", "meters", "cm", "mm"
- If mixed units (e.g., "10ft x 3m"), store the most common unit and note in special_requirements
- Watch for international clients using metric (especially from Canada, Europe, Asia)

QUOTE STATUS INTELLIGENCE:
Determine "quote_status" by analyzing the thread:
- "Pending": Client asked for quote, Seahorse hasn't responded yet
- "Quoted": Seahorse provided pricing, awaiting client response
- "Negotiating": Client responded asking for better price/terms
- "Accepted": Client explicitly accepts (says "yes", "approved", "book it", "let's proceed", "we'll take it")
- "Rejected": Client declines (says "no thanks", "too expensive", "went with someone else", "not at this time")
- "Expired": Quote validity period passed with no response
- "Booked": Client confirmed and shipment is scheduled

Set "job_won":
- true if quote_status = "Accepted" or "Booked"
- false if quote_status = "Rejected"
- null otherwise

ACCEPTANCE/REJECTION DETECTION:
Look for acceptance phrases:
- "We'll go with this", "Approved", "Please proceed", "Book it", "Confirmed", "Yes, please schedule"
- "This works", "Sounds good", "Let's move forward", "I'll take it", "We accept"

Look for rejection phrases:
- "Too expensive", "Out of budget", "We found another carrier", "Went with [competitor]"
- "Not right now", "We'll pass", "No thank you", "Decline", "Cannot approve"

Look for negotiation phrases:
- "Can you do better?", "Is this your best price?", "Our budget is...", "Competitor quoted..."
- "Any room for negotiation?", "Can you match...", "We were hoping for..."

CLIENT SENTIMENT:
Set "client_response_sentiment":
- "Positive": Client seems happy, responds quickly, asks to move forward
- "Negative": Client unhappy with price/terms, threatening to go elsewhere
- "Urgent": Uses words like "ASAP", "rush", "emergency", "critical", "urgent"
- "Price Sensitive": Focuses heavily on cost, mentions budget, asks for discounts
- "Neutral": Standard professional communication

PRICING & NEGOTIATION:
- "initial_quote_amount": First price Seahorse provided
- "revised_quote_1": Second price if Seahorse reduced it
- "revised_quote_2": Third price if further negotiation
- "final_agreed_price": What client actually accepted (may = initial or revised)
- "discount_given": Calculate difference between initial and final
- Track "discount_reason" if mentioned (volume, repeat customer, matching competitor)
- Note "competitor_mentioned" if client says "XYZ Company quoted $..."
- Capture "additional_charges" mentioned (fuel surcharge, permits, pilot car, etc.)

DATES:
- Standardize ALL dates to YYYY-MM-DD format
- "quote_request_date": When client first asked
- "quote_provided_date": When Seahorse sent pricing
- "quote_valid_until": Expiration (often 7-30 days from quote date)
- "requested_pickup_date": Client's desired pickup
- "requested_delivery_date": Client's desired delivery
- "acceptance_date": When client said yes
- Handle relative dates: "next Monday" → calculate actual date based on email date
- Handle date ranges: "between June 5-10" → use earliest date

EQUIPMENT TYPE MATCHING:
If client describes cargo but doesn't specify equipment, infer from:
- "Tall cargo" (>8ft) → Step Deck, Double Drop
- "Heavy machinery" → RGN, Lowboy, Heavy Haul
- "Weatherproof needed" → Conestoga or Dry Van
- "Temperature sensitive" → Reefer
- "Standard pallets" → Dry Van or Flatbed
- "Construction equipment" → RGN, Lowboy
- "Multiple stops" → LTL or FTL with stops

INTERNATIONAL INDICATORS:
- Check "client_location_country" from email signature or domain
- If international: more likely to use metric, may need customs/incoterms
- Set "customs_clearance_needed": true for cross-border shipments
- Identify "incoterms" if mentioned (EXW, FOB, CIF, DDP, etc.)
- Note if client mentions customs broker

DATA QUALITY:
- Extract numeric values WITHOUT units in the number fields
- Example: "5,000 lbs" → cargo_weight: 5000, weight_unit: "lbs"
- Example: "10 ft 6 in" → cargo_length: 10.5, dimension_unit: "ft"
- Be thorough - extract EVERY detail mentioned across ALL messages in the thread
- If client provides info in one message and Seahorse quotes in another, combine them
- Don't miss attachments mention - they often contain detailed specs

FOLLOW-UP TRACKING:
- Set "follow_up_required": true if:
  * Seahorse is waiting for client response to quote
  * Seahorse asked questions that weren't answered
  * Client said "let me check and get back to you"
  * Quote status is "Quoted" or "Negotiating"
- Set "follow_up_reason" to explain why follow-up needed
- This helps sales team know who to chase

Return complete, accurate JSON following this structure exactly.`;
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

  /**
   * Abstract method - must be implemented by child classes
   * Generate a response from a prompt
   * @param {string} prompt - The prompt to send to the AI
   * @returns {Promise<string>} The AI response text
   */
  async generateResponse(prompt) {
    throw new Error('generateResponse() must be implemented by child class');
  }

  /**
   * Get pricing recommendation from AI based on quote and historical matches
   * @param {Object} sourceQuote - The quote to price
   * @param {Array} matches - Historical similar matches
   * @returns {Promise<Object|null>} Pricing recommendation
   */
  async getPricingRecommendation(sourceQuote, matches) {
    const prompt = this.getPricingPrompt(sourceQuote, matches);

    return await this.withRetry(async () => {
      const responseText = await this.generateResponse(prompt);
      const parsedData = this.cleanAndParseResponse(responseText);

      console.log(`  ✓ Generated pricing recommendation with ${this.serviceName}`);
      return parsedData;
    }, 2);
  }

  /**
   * Get the pricing recommendation prompt
   * @param {Object} sourceQuote - Quote to price
   * @param {Array} matches - Historical matches
   * @returns {string} AI prompt for pricing
   */
  getPricingPrompt(sourceQuote, matches) {
    const topMatches = matches.slice(0, 5);

    return `You are a senior pricing analyst at a drayage and transportation company with 15+ years of experience. Your role is to provide accurate, competitive quotes that win business while maintaining profitability.

## YOUR EXPERTISE
- Deep knowledge of US port operations and drayage rates
- Understanding of trucking lane rates and fuel surcharges
- Experience with project cargo and heavy haul pricing
- Familiarity with ocean freight market conditions
- Knowledge of transloading and warehouse handling costs

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
### Match ${i + 1} (${(m.similarityScore * 100).toFixed(0)}% similar)
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
- Fuel surcharge (currently ~25-35% of linehaul)
- Accessorials (liftgate, inside delivery, detention)
- Lane density (headhaul vs backhaul)
- Equipment type premiums (flatbed +15-25%)
- Port/terminal fees for drayage

## MARGIN GUIDELINES
- Standard business: 15-25% gross margin
- Competitive lanes: 10-15% margin acceptable
- Project cargo/heavy haul: 20-35% margin
- Expedited/rush: Add 25-50% premium

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
