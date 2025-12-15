/**
 * Base AI Service
 * Abstract base class for all AI parsing services
 */

import dotenv from 'dotenv';
import type { Email, ParsedEmailData, Quote, QuoteMatch, AIPricingDetails, PricingReplyResult } from '../../types/index.js';
import type { RouteDistance } from '../googleMapsService.js';
import { PRICING_REPLY_EXTRACTION_PROMPT } from '../../prompts/shippingQuotePrompts.js';
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
  async getPricingRecommendation(
    sourceQuote: Quote,
    matches: QuoteMatch[],
    routeDistance?: RouteDistance | null
  ): Promise<AIPricingDetails | null> {
    const prompt = this.getPricingPrompt(sourceQuote, matches, { fuelSurcharge: 0.3 }, routeDistance);

    // Calculate baseline for bounds enforcement
    const validMatches = matches.slice(0, 5).filter(m => {
      const price = m.matchedQuoteData?.finalPrice || m.matchedQuoteData?.initialPrice;
      return price && price > 0;
    });
    const prices = validMatches.map(m => m.matchedQuoteData?.finalPrice || m.matchedQuoteData?.initialPrice || 0);
    const filteredPrices = this.filterPriceOutliers(prices);
    const baselinePrice = filteredPrices.length > 0 
      ? filteredPrices.reduce((a, b) => a + b, 0) / filteredPrices.length 
      : 0;
    const minHistPrice = filteredPrices.length > 0 ? Math.min(...filteredPrices) : 0;
    const maxHistPrice = filteredPrices.length > 0 ? Math.max(...filteredPrices) : 0;
    
    // Calculate enforcement bounds (slightly wider than prompt constraints)
    const enforcementFloor = baselinePrice > 0 ? Math.round(minHistPrice * 0.70) : 100;
    const enforcementCeiling = baselinePrice > 0 ? Math.round(maxHistPrice * 1.50) : 50000;

    // Detect service type for absolute caps
    const serviceType = (sourceQuote.service_type || '').toLowerCase();
    const distanceMiles = routeDistance?.distanceMiles || 0;
    
    console.log(`  Distance for caps: ${distanceMiles} miles, service: ${serviceType}`);
    
    // CRITICAL: Apply distance-based service type correction
    // Ocean freight can't have 5-mile routes - that's drayage
    let effectiveServiceType = serviceType;
    if ((serviceType.includes('ocean') || serviceType.includes('intermodal')) && distanceMiles > 0 && distanceMiles < 150) {
      effectiveServiceType = 'drayage';
      console.log(`  Service correction: ${serviceType} -> drayage (${distanceMiles} miles too short for ocean)`);
    }
    
    // Absolute caps based on effective service type
    const absoluteCaps: Record<string, number> = {
      'drayage': 3000,      // Local drayage max
      'ground': 8000,       // Ground max for typical routes
      'ocean': 6000,        // Pure ocean freight max (per container)
      'intermodal': 10000,  // Multi-modal max
      'default': 8000       // Fallback
    };
    
    // Get cap based on effective service type
    let maxCap = absoluteCaps['default'];
    for (const [key, cap] of Object.entries(absoluteCaps)) {
      if (effectiveServiceType.includes(key)) {
        maxCap = cap;
        break;
      }
    }
    
    // For short distances, apply even stricter caps
    if (distanceMiles > 0 && distanceMiles < 50) {
      maxCap = Math.min(maxCap, 1500);  // Very short haul cap
      console.log(`  Very short haul: cap set to ${maxCap}`)
    } else if (distanceMiles > 0 && distanceMiles < 100) {
      maxCap = Math.min(maxCap, 2500);  // Short haul cap
      console.log(`  Short haul: cap set to ${maxCap}`)
    } else if (distanceMiles > 0 && distanceMiles < 200) {
      maxCap = Math.min(maxCap, 4000);  // Local cap
      console.log(`  Local: cap set to ${maxCap}`)
    }

    return await this.withRetry(async () => {
      const responseText = await this.generateResponse(prompt);
      const parsedData = this.cleanAndParseResponse(responseText) as unknown as AIPricingDetails;

      // ENFORCE BOUNDS: If AI returned price outside bounds, clamp it
      if (parsedData.recommended_price) {
        const originalPrice = parsedData.recommended_price;
        
        // Apply floor from historical baseline
        if (baselinePrice > 0 && parsedData.recommended_price < enforcementFloor) {
          parsedData.recommended_price = enforcementFloor;
          console.log(`  Clamped: $${originalPrice} -> $${enforcementFloor} (below floor)`);
        }
        
        // Apply ceiling from historical baseline
        if (baselinePrice > 0 && parsedData.recommended_price > enforcementCeiling) {
          parsedData.recommended_price = enforcementCeiling;
          console.log(`  Clamped: $${originalPrice} -> $${enforcementCeiling} (above ceiling)`);
        }
        
        // Apply absolute service-type + distance cap (always enforced)
        if (parsedData.recommended_price > maxCap) {
          console.log(`  Hard cap: $${parsedData.recommended_price} -> $${maxCap} (${effectiveServiceType}, ${distanceMiles} miles)`);
          parsedData.recommended_price = maxCap;
        }
      }

      console.log(`  Success: Generated pricing recommendation with ${this.serviceName}`);
      return parsedData;
    }, 2);
  }

/**
   * Parse a staff reply email to determine if it contains pricing information
   */
  async parsePricingReply(
    emailBody: string,
    attachmentText = '',
    maxRetries = 3
  ): Promise<PricingReplyResult | null> {
    const emailContent = this.preparePricingReplyContent(emailBody, attachmentText);
    const prompt = this.getPricingReplyPrompt(emailContent);

    return await this.withRetry(async () => {
      const responseText = await this.generateResponse(prompt);
      const parsedData = this.cleanAndParseResponse(responseText) as unknown as PricingReplyResult;

      console.log(`  Success: Parsed pricing reply with ${this.serviceName} (is_pricing: ${parsedData.is_pricing_email}, confidence: ${parsedData.confidence_score})`);
      return parsedData;
    }, maxRetries);
  }

  /**
   * Prepare email content for pricing reply parsing
   */
  preparePricingReplyContent(emailBody: string, attachmentText = ''): string {
    let content = `Email Body:\n${emailBody}`;

    if (attachmentText && attachmentText.trim()) {
      content += `\n\n========================================\nATTACHMENT CONTENT:\n========================================\n${attachmentText}`;
    }

    return content;
  }

  /**
   * Get the pricing reply extraction prompt
   */
  getPricingReplyPrompt(emailContent: string): string {
    return `${PRICING_REPLY_EXTRACTION_PROMPT}

========================================
EMAIL TO ANALYZE:
========================================

${emailContent}

========================================

Analyze the above email and return ONLY valid JSON (no markdown, no explanation). Start with { and end with }.`;
  }

  /**
   * Filter outliers using IQR method - returns prices within reasonable range
   * ALWAYS applies absolute caps regardless of dataset size
   */
  filterPriceOutliers(prices: number[]): number[] {
    // Absolute bounds for typical shipping - filter these first regardless of dataset size
    const absoluteMin = 100;    // Minimum realistic shipping cost
    const absoluteMax = 50000;  // Maximum for typical domestic/drayage/ocean freight
    
    // First, apply absolute bounds to all prices
    let filtered = prices.filter(p => p >= absoluteMin && p <= absoluteMax);
    
    // If we still have 4+ prices after absolute filtering, apply IQR
    // Increased threshold from 3 to 4 to be less aggressive
    if (filtered.length >= 4) {
      const sorted = [...filtered].sort((a, b) => a - b);
      const q1Index = Math.floor(sorted.length * 0.25);
      const q3Index = Math.floor(sorted.length * 0.75);
      const q1 = sorted[q1Index] || sorted[0] || 0;
      const q3 = sorted[q3Index] || sorted[sorted.length - 1] || 0;
      const iqr = q3 - q1;
      
      // Use 2.5x IQR for less aggressive outlier detection (was 2x)
      const lowerBound = Math.max(absoluteMin, q1 - 2.5 * iqr);
      const upperBound = Math.min(absoluteMax, q3 + 2.5 * iqr);
      
      filtered = filtered.filter(p => p >= lowerBound && p <= upperBound);
    }
    
    // If filtering removed everything, return the absolute-filtered prices instead
    if (filtered.length === 0 && prices.length > 0) {
      return prices.filter(p => p >= absoluteMin && p <= absoluteMax);
    }
    
    return filtered;
  }

  /**
   * Get the pricing recommendation prompt
   */
  getPricingPrompt(
    sourceQuote: Quote,
    matches: QuoteMatch[],
    marketData: MarketData = { fuelSurcharge: 0.3 },
    routeDistance?: RouteDistance | null
  ): string {
    const topMatches = matches.slice(0, 5);

    // Calculate weighted average from historical matches as baseline
    const validMatches = topMatches.filter(m => {
      const price = m.matchedQuoteData?.finalPrice || m.matchedQuoteData?.initialPrice;
      return price && price > 0;
    });
    
    // Extract all prices first
    let allPrices: number[] = [];
    for (const m of validMatches) {
      const price = m.matchedQuoteData?.finalPrice || m.matchedQuoteData?.initialPrice || 0;
      allPrices.push(price);
    }
    
    // Filter out outliers before computing baseline
    const filteredPrices = this.filterPriceOutliers(allPrices);
    
    // Now compute weighted average only from non-outlier prices
    let weightedAvgPrice = 0;
    let totalWeight = 0;
    let pricesList: number[] = [];
    
    for (const m of validMatches) {
      const price = m.matchedQuoteData?.finalPrice || m.matchedQuoteData?.initialPrice || 0;
      // Only include if price wasn't filtered as outlier
      if (filteredPrices.includes(price)) {
        const weight = m.similarity_score;
        weightedAvgPrice += price * weight;
        totalWeight += weight;
        pricesList.push(price);
      }
    }
    
    const baselinePrice = totalWeight > 0 ? Math.round(weightedAvgPrice / totalWeight) : 0;
    const minHistPrice = pricesList.length > 0 ? Math.min(...pricesList) : 0;
    const maxHistPrice = pricesList.length > 0 ? Math.max(...pricesList) : 0;

    // Check if historical range is reliable (not too wide)
    const priceSpread = maxHistPrice > 0 ? (maxHistPrice - minHistPrice) / ((maxHistPrice + minHistPrice) / 2) : 0;
    const isReliableBaseline = baselinePrice > 100 && pricesList.length >= 2 && priceSpread < 1.0; // spread < 100% is reliable
    
    // Use weighted average directly - conservative adjustment was too aggressive
    const effectiveBaseline = baselinePrice;

    // Log the baseline calculation with outlier info
    const outlierCount = allPrices.length - filteredPrices.length;
    console.log(`    Historical prices: ${allPrices.length} total, ${outlierCount} outliers filtered, Baseline: $${effectiveBaseline.toLocaleString()}, Range: $${minHistPrice.toLocaleString()} - $${maxHistPrice.toLocaleString()}, Reliable: ${isReliableBaseline}`);

    // Build distance info section if available
    const distanceInfo = routeDistance
      ? `- **Route Distance**: ${routeDistance.distanceMiles} miles (${routeDistance.distanceKm} km)
- **Estimated Transit Time**: ${routeDistance.durationText}`
      : '';

    // Detect service type for pricing guidance
    const serviceType = (sourceQuote.service_type || '').toLowerCase();
    const isPureOcean = (serviceType === 'ocean' || serviceType === 'sea freight' || serviceType === 'fcl' || serviceType === 'lcl') 
                        && !serviceType.includes('drayage') && !serviceType.includes('ground') && !serviceType.includes('intermodal');
    const isOcean = serviceType.includes('ocean') || serviceType.includes('sea') || serviceType.includes('fcl') || serviceType.includes('lcl');
    const isDrayage = serviceType.includes('drayage') || serviceType.includes('container');
    const isIntermodal = serviceType.includes('intermodal') || serviceType.includes('multimodal');

    // Detect short-haul moves (under 100 miles)
    const distanceMiles = routeDistance?.distanceMiles || 0;
    const isShortHaul = distanceMiles > 0 && distanceMiles < 100;
    const isVeryShort = distanceMiles > 0 && distanceMiles < 50;

    // Detect heavy cargo (over 40,000 lbs) - only trigger for very heavy cargo with explicit weight data
    const cargoWeight = sourceQuote.cargo_weight || 0;
    const weightUnit = (sourceQuote.weight_unit || '').toLowerCase();
    const hasExplicitWeight = cargoWeight > 0 && weightUnit.length > 0;
    const weightInLbs = weightUnit.includes('kg') ? cargoWeight * 2.205 : cargoWeight;
    const isOversizeHeavy = hasExplicitWeight && weightInLbs > 40000;

    // Determine constraint level based on baseline reliability
    // MUCH STRICTER: Always enforce maximum deviation from baseline
    let constraintNote = '';
    
    // Calculate absolute bounds based on effective baseline - NEVER deviate more than 50% from reliable baseline
    const absoluteFloor = isReliableBaseline ? Math.round(minHistPrice * 0.80) : Math.round(effectiveBaseline * 0.50);
    const absoluteCeiling = isReliableBaseline ? Math.round(maxHistPrice * 1.25) : Math.round(effectiveBaseline * 2.0);
    
    // Heavy haul override - only for verified 40,000+ lbs cargo
    if (isOversizeHeavy) {
      constraintNote = `\n**HEAVY HAUL CONSTRAINT**: This cargo weighs ${weightInLbs.toLocaleString()} lbs (over 40,000 lbs). Heavy haul requires specialized equipment. Add 30-50% premium to baseline.`;
    } else if (isVeryShort && isDrayage) {
      // Very short drayage should be capped very low
      constraintNote = `\n**SHORT-HAUL DRAYAGE CONSTRAINT**: This is a very short drayage move (${distanceMiles} miles). Short-haul drayage typically costs $400-800. You MUST return a price between $${absoluteFloor.toLocaleString()} and $${Math.min(absoluteCeiling, 1500).toLocaleString()}.`;
    } else if (isShortHaul && isDrayage) {
      // Short drayage moves have specific pricing
      constraintNote = `\n**LOCAL DRAYAGE CONSTRAINT**: This is a short local drayage move (${distanceMiles} miles). Local drayage typically costs $500-1,500. You MUST return a price between $${absoluteFloor.toLocaleString()} and $${Math.min(absoluteCeiling, 2500).toLocaleString()}.`;
    } else if (isPureOcean) {
      // Pure ocean freight should be capped lower - typical rates are $1,000-3,500 per container
      constraintNote = `\n**OCEAN-ONLY CONSTRAINT**: This is PURE ocean freight (no drayage/delivery). You MUST return a price between $${absoluteFloor.toLocaleString()} and $${absoluteCeiling.toLocaleString()}.`;
    } else if (isReliableBaseline) {
      constraintNote = `\n**STRICT CONSTRAINT (ENFORCED)**: Historical data is reliable. You MUST return a price between $${absoluteFloor.toLocaleString()} and $${absoluteCeiling.toLocaleString()}. Do NOT exceed these bounds.`;
    } else if (effectiveBaseline > 0) {
      constraintNote = `\n**MODERATE CONSTRAINT**: Historical data has variance. You MUST return a price between $${absoluteFloor.toLocaleString()} and $${absoluteCeiling.toLocaleString()}. Stay close to baseline of $${effectiveBaseline.toLocaleString()}.`;
    } else {
      constraintNote = `\n**FALLBACK PRICING**: No reliable historical data. Use industry-standard pricing for the service type.`;
    }

    return `You are a senior pricing analyst at a drayage and transportation company. Your MOST IMPORTANT task is to provide accurate prices based on historical similar quotes.

## CRITICAL PRICING RULE
**YOU MUST BASE YOUR PRICE ON THE HISTORICAL MATCHES BELOW.**
- The weighted average of similar historical quotes is: **$${effectiveBaseline.toLocaleString()}**
- Historical price range: $${minHistPrice.toLocaleString()} - $${maxHistPrice.toLocaleString()}
- Number of historical references: ${pricesList.length}
${constraintNote}

## QUOTE REQUEST TO PRICE
- **Route**: ${sourceQuote.origin_city || 'Unknown'}, ${sourceQuote.origin_state_province || ''} ${sourceQuote.origin_country || ''} → ${sourceQuote.destination_city || 'Unknown'}, ${sourceQuote.destination_state_province || ''} ${sourceQuote.destination_country || ''}
${distanceInfo}
- **Service Type**: ${sourceQuote.service_type || 'Not specified'}
- **Cargo Description**: ${sourceQuote.cargo_description || 'Not specified'}
- **Weight**: ${sourceQuote.cargo_weight || 'Not specified'} ${sourceQuote.weight_unit || ''}
- **Pieces**: ${sourceQuote.number_of_pieces || 'Not specified'}
- **Dimensions**: ${sourceQuote.cargo_length ? `${sourceQuote.cargo_length} x ${sourceQuote.cargo_width} x ${sourceQuote.cargo_height} ${sourceQuote.dimension_unit || ''}` : 'Not specified'}
- **Hazmat**: ${sourceQuote.hazardous_material ? 'Yes' : 'No'}

## SIMILAR HISTORICAL QUOTES - USE THESE AS YOUR PRIMARY REFERENCE
${topMatches.map((m, i) => {
  const price = m.matchedQuoteData?.finalPrice || m.matchedQuoteData?.initialPrice;
  const priceLabel = m.matchedQuoteData?.finalPrice ? 'FINAL AGREED PRICE' : 'Initial Quote';
  return `
### Match ${i + 1} (${(m.similarity_score * 100).toFixed(0)}% similar)
- Route: ${m.matchedQuoteData?.origin || 'Unknown'} → ${m.matchedQuoteData?.destination || 'Unknown'}
- Service: ${m.matchedQuoteData?.service || 'Unknown'}
- Cargo: ${m.matchedQuoteData?.cargo || 'Not specified'}
- **${priceLabel}: $${price?.toLocaleString() || 'N/A'}** ${m.matchedQuoteData?.finalPrice ? '← Use this as primary reference' : ''}
- Date: ${m.matchedQuoteData?.quoteDate ? new Date(m.matchedQuoteData.quoteDate).toLocaleDateString() : 'Unknown'}
- Status: ${m.matchedQuoteData?.status || 'Unknown'}`;
}).join('\n')}

## ADJUSTMENT GUIDELINES (Only apply when CLEARLY justified)
${isOcean ? `### PURE OCEAN FREIGHT Pricing
**CRITICAL**: This is OCEAN-ONLY freight. Ocean freight rates are typically:
- Europe to US East Coast: $1,000 - $3,000 per container (FCL)
- Asia to US West Coast: $1,500 - $4,000 per container (FCL)
- LCL rates: $80-150 per CBM
- DO NOT add drayage or ground transport costs - this is ocean-only
- If historical matches show much higher prices, they may include additional services` : isIntermodal ? `### Intermodal (Multi-modal) Pricing
- This includes multiple services (ocean + drayage, rail + truck, etc.)
- Price includes port handling, customs coordination, and ground delivery
- Typically 50-100% higher than ocean-only rates` : isDrayage ? `### Drayage Pricing
- Short local moves (0-30 miles): $300-600
- Local (30-100 miles): $500-1,000
- Regional (100-250 miles): $800-1,500
- Extended (250+ miles): Consider FTL rates` : `### Ground Transportation
- Per-mile rates: $2.50-4.00 for standard FTL
- Equipment premiums: Flatbed +15-25%, Step-deck +10-20%
- Fuel surcharge: ~25-35% of linehaul`}

## ADJUSTMENT REASONS (Only adjust if applicable)
- OOG/Oversize cargo: +35-50%
- Hazmat: +25-40%
- Expedited/Rush: +25-50%
- More pieces/higher weight than historical: Adjust proportionally
- Very different route distance: Adjust proportionally

## OUTPUT FORMAT
Return ONLY valid JSON. Your recommended_price should be close to the weighted average of $${effectiveBaseline.toLocaleString()} unless adjustments are clearly needed:

{
  "recommended_price": ${effectiveBaseline > 0 ? effectiveBaseline : 0},
  "floor_price": ${effectiveBaseline > 0 ? Math.round(effectiveBaseline * 0.85) : 0},
  "target_price": ${effectiveBaseline > 0 ? effectiveBaseline : 0},
  "ceiling_price": ${effectiveBaseline > 0 ? Math.round(effectiveBaseline * 1.15) : 0},
  "confidence": "HIGH|MEDIUM|LOW",
  "price_breakdown": {
    "linehaul": 0.00,
    "fuel_surcharge": 0.00,
    "accessorials": 0.00,
    "margin": 0.00
  },
  "reasoning": "Brief explanation - must reference historical matches",
  "market_factors": ["Factor 1", "Factor 2"],
  "negotiation_room_percent": 10
}`;
  }
}
