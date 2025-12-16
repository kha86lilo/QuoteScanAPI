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
   * 
   * APPROACH: Use the BEST single match (highest similarity) as the primary reference.
   * High-similarity matches are more predictive than averaging many lower-quality matches.
   * FILTER: Remove unreasonably low-priced matches (likely data entry errors or special cases).
   */
  async getPricingRecommendation(
    sourceQuote: Quote,
    matches: QuoteMatch[],
    routeDistance?: RouteDistance | null
  ): Promise<AIPricingDetails | null> {
    const normalizeText = (value: unknown): string => String(value ?? '').toLowerCase().trim();
    const hasAny = (haystack: string, needles: string[]): boolean => needles.some((n) => haystack.includes(n));
    const getState = (v: unknown): string => normalizeText(v).replace(/\./g, '').toUpperCase();
    const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
    const toFiniteNumber = (value: unknown): number | null => {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
      }
      if (typeof value === 'string') {
        const cleaned = value.replace(/[$,\s]/g, '');
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };

    const getWeightInLbs = (q: Quote): number | null => {
      const cargoWeight = toFiniteNumber((q as any).cargo_weight);
      if (!cargoWeight || cargoWeight <= 0) return null;

      const desc = normalizeText((q as any).cargo_description);
      const weightUnit = normalizeText((q as any).weight_unit);

      const explicitLb = desc.includes(' lb') || desc.includes(' lbs') || desc.includes('pound');
      const explicitKg = desc.includes(' kg') || desc.includes('kgs') || desc.includes('kilogram');
      const unitSaysLb = weightUnit.includes('lb') || weightUnit.includes('lbs') || weightUnit.includes('pound');
      const unitSaysKg = weightUnit.includes('kg');

      // Only trust weight-based logic when we have SOME signal this is really a weight.
      const hasWeightSignal = explicitLb || explicitKg || unitSaysLb || unitSaysKg;
      if (!hasWeightSignal) return null;

      const weightInLbs = (explicitKg || unitSaysKg) ? cargoWeight * 2.205 : cargoWeight;
      if (!Number.isFinite(weightInLbs) || weightInLbs <= 0) return null;
      return weightInLbs;
    };
    const weightedMedian = (values: number[], weights: number[]): number | null => {
      if (values.length === 0 || values.length !== weights.length) return null;
      const pairs = values
        .map((v, i) => ({ v, w: weights[i] ?? 0 }))
        .filter((p) => Number.isFinite(p.v) && Number.isFinite(p.w) && p.w > 0)
        .sort((a, b) => a.v - b.v);
      if (pairs.length === 0) return null;
      const total = pairs.reduce((sum, p) => sum + p.w, 0);
      if (total <= 0) return null;
      const half = total / 2;
      let acc = 0;
      for (const p of pairs) {
        acc += p.w;
        if (acc >= half) return p.v;
      }
      return pairs[pairs.length - 1]!.v;
    };
    const detectOversizeLikely = (q: Quote): boolean => {
      const desc = normalizeText(q.cargo_description);
        // Dimension pattern: avoid false positives from product specs like "11x454g" by requiring
        // either 3 dimensions or an explicit dimension unit.
        const has3dDims = /\b\d{2,4}\s*(?:x|×)\s*\d{2,4}\s*(?:x|×)\s*\d{2,4}\b/i.test(desc);
        const has2dWithUnit = /\b\d{2,4}\s*(?:x|×)\s*\d{2,4}\s*(?:in|inch(?:es)?|ft|feet|cm|mm|m|"|')\b/i.test(desc);
        const hasDims = has3dDims || has2dWithUnit;

      // Word-boundary keyword detection to avoid substring false-positives (e.g. 'rg' in 'cargo')
      const keywordPatterns: RegExp[] = [
        /\boversize(?:d)?\b/i,
        /\bover\s*size\b/i,
        /\boverweight\b/i,
        /\bover\s*weight\b/i,
        /\bheavy\s*haul\b/i,
        /\bheavyhaul\b/i,
        /\blow\s*boy\b/i,
        /\blowboy\b/i,
        /\bstep\s*deck\b/i,
        /\bstepdeck\b/i,
        /\bflat\s*bed\b/i,
        /\bflatbed\b/i,
        /\bexcavator\b/i,
        /\bbackhoe\b/i,
        /\bbulldozer\b/i,
        /\bdozer\b/i,
        /\bcrane\b/i,
        /\bforklift\b/i,
        /\bskid\s*steer\b/i,
        /\bcompactor\b/i,
        /\bpress\s*brake\b/i,
        /\btransformer\b/i,
        /\bgenerator\b/i,
        /\bkomatsu\b/i,
        /\bcaterpillar\b/i,
        /\bdaewoo\b/i,
        /\bhamm\b/i,
        /\bcat\b/i,
      ];
      const hasKeywords = keywordPatterns.some((re) => re.test(desc));

      // NOTE: Weight alone is not a reliable oversize signal (commodity FTL can be heavy but not OSOW).
      // Keep oversize detection focused on explicit OSOW language, dimensions, and equipment keywords.
      return hasDims || hasKeywords;
    };

    const detectOversizeForPricingLikely = (q: Quote): boolean => {
      const desc = normalizeText(q.cargo_description);
        // Dimension pattern: avoid false positives from product specs like "11x454g" by requiring
        // either 3 dimensions or an explicit dimension unit.
        const has3dDims = /\b\d{2,4}\s*(?:x|×)\s*\d{2,4}\s*(?:x|×)\s*\d{2,4}\b/i.test(desc);
        const has2dWithUnit = /\b\d{2,4}\s*(?:x|×)\s*\d{2,4}\s*(?:in|inch(?:es)?|ft|feet|cm|mm|m|"|')\b/i.test(desc);
        const hasDims = has3dDims || has2dWithUnit;

      // Strict OSOW/equipment signals only (avoid generic equipment words like excavator/backhoe)
      const strictKeywordPatterns: RegExp[] = [
        /\boversize(?:d)?\b/i,
        /\bover\s*size\b/i,
        /\boverweight\b/i,
        /\bover\s*weight\b/i,
        /\bosow\b/i,
        /\bheavy\s*haul\b/i,
        /\bheavyhaul\b/i,
        /\blow\s*boy\b/i,
        /\blowboy\b/i,
        /\bstep\s*deck\b/i,
        /\bstepdeck\b/i,
        /\bflat\s*bed\b/i,
        /\bflatbed\b/i,
      ];
      const hasStrictKeywords = strictKeywordPatterns.some((re) => re.test(desc));

      // Weight alone is not a reliable OSOW indicator; keep this signal strict.
      return hasDims || hasStrictKeywords;
    };

    // Minimum price floors by service type - prices below this are outliers
    const minPriceFloors: Record<string, number> = {
      'drayage': 500,     // Min $500 for any drayage
      'ground': 500,      // Min $500 for ground freight
      'ocean': 800,       // Min $800 for ocean freight
      'intermodal': 800,  // Min $800 for intermodal
    };
    
    const serviceType = (sourceQuote.service_type || '').toLowerCase();

    const sourceOriginCity = normalizeText((sourceQuote as any).origin_city);
    const sourceDestCity = normalizeText((sourceQuote as any).destination_city);
    const sourceOriginState = getState((sourceQuote as any).origin_state_province ?? (sourceQuote as any).origin_state);
    const sourceDestState = getState((sourceQuote as any).destination_state_province ?? (sourceQuote as any).destination_state);

    const distanceMiles = routeDistance?.distanceMiles ?? 0;
    const sameCity = !!sourceOriginCity && !!sourceDestCity && sourceOriginCity === sourceDestCity;
    const sameStateOrUnknown = (!sourceOriginState || !sourceDestState || sourceOriginState === sourceDestState);
    const sameLocal = sameCity && sameStateOrUnknown;
    const distanceForRules = distanceMiles > 0 ? distanceMiles : (sameLocal ? 10 : 0);

    const isPureOceanRequest = (() => {
      const st = serviceType;
      const oceanLike = (st === 'ocean' || st.includes('sea') || st.includes('fcl') || st.includes('lcl'));
      if (!oceanLike) return false;
      return !st.includes('drayage') && !st.includes('ground') && !st.includes('intermodal') && !st.includes('container');
    })();

    const oversizeLikely = detectOversizeLikely(sourceQuote);
    const oversizeForPricing = detectOversizeForPricingLikely(sourceQuote);

    const originCountry = normalizeText((sourceQuote as any).origin_country);
    const destCountry = normalizeText((sourceQuote as any).destination_country);
    const isUSCountry = (c: string): boolean => {
      const v = c.replace(/\./g, '').trim();
      return v === 'usa' || v === 'us' || v === 'united states' || v === 'u s a' || v === 'u s';
    };
    const isInternationalLane = (
      (originCountry && destCountry && isUSCountry(originCountry) !== isUSCountry(destCountry)) ||
      (!originCountry && !destCountry && distanceMiles > 2500)
    );
    
    // Service type correction for short routes
    let effectiveServiceType = serviceType;
    const wasOceanOrIntermodal = serviceType.includes('ocean') || serviceType.includes('intermodal');
    if ((serviceType.includes('ocean') || serviceType.includes('intermodal')) && distanceForRules > 0 && distanceForRules < 150) {
      // Short-distance moves with equipment/OSOW behave like specialized ground, not typical container drayage.
      effectiveServiceType = oversizeLikely ? 'ground' : 'drayage';
      console.log(`  Service correction: ${serviceType} -> ${effectiveServiceType} (${distanceForRules} miles)`);
    }

    const correctedOceanOrIntermodalToGround = wasOceanOrIntermodal && effectiveServiceType.includes('ground') && !serviceType.includes('ground');

    // International "intermodal" labeling is often really ocean freight in this dataset
    if (effectiveServiceType.includes('intermodal') && isInternationalLane && distanceForRules > 1000) {
      effectiveServiceType = 'ocean';
      console.log(`  Service correction: intermodal -> ocean (international lane)`);
    }
    
    // Get minimum price floor for this service type
    let minFloor = 400; // default
    for (const [key, floor] of Object.entries(minPriceFloors)) {
      if (effectiveServiceType.includes(key)) {
        minFloor = floor;
        break;
      }
    }

    // Service flags for downstream logic (after corrections)
    const isDrayage = effectiveServiceType.includes('drayage');
    const isGround = effectiveServiceType.includes('ground');
    const isOcean = effectiveServiceType.includes('ocean');
    const isIntermodal = effectiveServiceType.includes('intermodal');

    const getContainerCountFromText = (text: string): number => {
      const norm = normalizeText(text);
      const m1 = norm.match(/\b(\d{1,2})\s*(?:x|×)\s*(?:20|40)\s*'?\s*(?:hc|high\s*cube)?\b/);
      const m2 = norm.match(/\b(\d{1,2})\s*(?:x|×)\s*(?:20|40)\s*'?\s*containers?\b/);
      const m3 = norm.match(/\b(\d{1,2})\s*containers?\b/);
      const m5 = norm.match(/\b(\d{1,2})\s*cont\.?\b/);
      const m4 = norm.match(/\b(?:20|40)\s*'?\s*(?:hc|high\s*cube)?\s*containers?\b/);
      return Math.max(
        m1 ? parseInt(m1[1]!, 10) : 0,
        m2 ? parseInt(m2[1]!, 10) : 0,
        m3 ? parseInt(m3[1]!, 10) : 0,
        m5 ? parseInt(m5[1]!, 10) : 0,
        m4 ? 1 : 0,
        norm.includes(' cont') || norm.includes('cont.') ? 1 : 0
      );
    };

    const sourceContainerCount = getContainerCountFromText((sourceQuote.cargo_description || '').toString());

    // For international ocean-only requests, historical matches can be polluted by inland/ground/drayage.
    // If we have enough ocean-like history, use it exclusively for pricing baselines.
    const internationalOceanLike = isInternationalLane && (effectiveServiceType.includes('ocean') || effectiveServiceType.includes('intermodal'));
    const wantsOceanOnlyHistory = internationalOceanLike && (isPureOceanRequest || effectiveServiceType.includes('ocean')) && !effectiveServiceType.includes('ground') && !effectiveServiceType.includes('drayage');
    const oceanLikeMatches = matches.filter((m) => {
      const svc = normalizeText((m as any)?.matchedQuoteData?.service);
      return svc.includes('ocean') || svc.includes('intermodal') || svc.includes('sea') || svc.includes('fcl') || svc.includes('lcl');
    });
    const matchesForPricing = (wantsOceanOnlyHistory && oceanLikeMatches.length >= 4) ? oceanLikeMatches : matches;
    if (matchesForPricing !== matches) {
      console.log(`  Ocean-only pricing: using ${matchesForPricing.length}/${matches.length} ocean-like historical matches`);
    }
    
    // Get matches with valid prices ABOVE the minimum floor
    const validMatches = matchesForPricing.filter((m) => {
      const raw = m.matchedQuoteData?.finalPrice ?? m.matchedQuoteData?.initialPrice;
      const price = toFiniteNumber(raw);
      return price !== null && price >= minFloor;
    });
    
    if (validMatches.length === 0) {
      console.log(`  No valid historical matches with prices >= $${minFloor}`);
      return null;
    }
    
    // Sort by similarity score and get the best match
    const sortedMatches = [...validMatches].sort((a, b) => b.similarity_score - a.similarity_score);
    const bestMatch = sortedMatches[0]!;
    const bestScore = bestMatch.similarity_score;
    const statusSuggestsFinal = (status: string): boolean => {
      if (!status) return false;
      return /\b(won|booked|accepted|agreed|final|closed|completed|paid)\b/i.test(status);
    };
    const hasFinalPrice = bestMatch.matchedQuoteData?.finalPrice && bestMatch.matchedQuoteData.finalPrice > 0;
    const hasInitialPrice = bestMatch.matchedQuoteData?.initialPrice && bestMatch.matchedQuoteData.initialPrice > 0;
    const bestFinal = hasFinalPrice ? toFiniteNumber(bestMatch.matchedQuoteData!.finalPrice!) : null;
    const bestInitial = hasInitialPrice ? toFiniteNumber(bestMatch.matchedQuoteData!.initialPrice!) : null;
    const bestStatus = normalizeText(bestMatch.matchedQuoteData?.status);
    const bestFinalEqualsInitial = !!(bestFinal && bestInitial) && Math.abs(bestFinal - bestInitial) / Math.max(bestFinal, 1) <= 0.01;
    const bestFinalReliable = !!bestFinal && statusSuggestsFinal(bestStatus) && !bestFinalEqualsInitial;
    const bestPriceRaw = bestFinalReliable
      ? bestMatch.matchedQuoteData!.finalPrice!
      : (bestMatch.matchedQuoteData?.initialPrice || bestMatch.matchedQuoteData?.finalPrice || 0);
    const bestPrice = toFiniteNumber(bestPriceRaw) ?? 0;
    
    // Calculate weighted average from top N matches for reference.
    // With staff-reply sourced history, top-3 can be dominated by duplicated/priced-thread artifacts.
    const topN = sortedMatches.slice(0, Math.min(12, sortedMatches.length));
    let weightedSum = 0;
    let totalWeight = 0;
    const prices: number[] = [];
    const priceWeights: number[] = [];
    const distanceScaledPrices: number[] = [];
    const distanceScaledWeights: number[] = [];

    // Dampen repeated identical/near-identical prices so duplicates don't dominate the baseline.
    const bucketSize = 50;
    const bucketCounts = new Map<number, number>();
    
    for (const m of topN) {
      const hasFinal = m.matchedQuoteData?.finalPrice && m.matchedQuoteData.finalPrice > 0;
      const hasInitial = m.matchedQuoteData?.initialPrice && m.matchedQuoteData.initialPrice > 0;

      const finalVal = hasFinal ? toFiniteNumber(m.matchedQuoteData!.finalPrice!) : null;
      const initialVal = hasInitial ? toFiniteNumber(m.matchedQuoteData!.initialPrice!) : null;
      const st = normalizeText(m.matchedQuoteData?.status);
      const finalEqualsInitial = !!(finalVal && initialVal) && Math.abs(finalVal - initialVal) / Math.max(finalVal, 1) <= 0.01;
      const finalReliable = !!finalVal && statusSuggestsFinal(st) && !finalEqualsInitial;

      const priceRaw = finalReliable
        ? m.matchedQuoteData!.finalPrice!
        : (m.matchedQuoteData?.initialPrice || m.matchedQuoteData?.finalPrice || 0);
      const price = toFiniteNumber(priceRaw) ?? 0;
      if (!Number.isFinite(price) || price <= 0) continue;

      const baseWeight = m.similarity_score;
      const finalBoost = finalReliable ? 1.25 : 1.0;

      const bucket = Math.round(price / bucketSize) * bucketSize;
      const seen = bucketCounts.get(bucket) ?? 0;
      bucketCounts.set(bucket, seen + 1);
      const dupPenalty = 1 / Math.sqrt(1 + seen);

      const weight = baseWeight * finalBoost * dupPenalty;
      
      weightedSum += price * weight;
      totalWeight += weight;
      prices.push(price);
      priceWeights.push(weight);

      const histDist = toFiniteNumber(m.matchedQuoteData?.distanceMiles);
      if ((isGround || isDrayage) && distanceMiles > 0 && histDist && histDist > 0) {
        const ratio = distanceMiles / histDist;
        const minRatio = isGround ? 0.75 : 0.85;
        const maxRatio = isGround ? 1.35 : 1.20;
        const scaled = price * clamp(ratio, minRatio, maxRatio);
        if (Number.isFinite(scaled) && scaled > 0) {
          distanceScaledPrices.push(scaled);
          distanceScaledWeights.push(weight);
        }
      }
    }

    if (prices.length === 0 || totalWeight <= 0 || !Number.isFinite(weightedSum)) {
      console.log('  No usable priced matches after filtering');
      return null;
    }
    
    const weightedAvg = Math.round(weightedSum / totalWeight);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceSpread = weightedAvg > 0 ? (maxPrice - minPrice) / weightedAvg : 0;
    const priceRatio = minPrice > 0 ? maxPrice / minPrice : Infinity;

    // Trimmed mean guardrail: if the top price is an extreme outlier (>2x median), drop it from baseline calc
    let trimmedWeightedAvg = weightedAvg;
    if (prices.length >= 4) {
      const sorted = [...prices].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      const top = sorted[sorted.length - 1]!;
      if (median > 0 && top > 2 * median) {
        const outlierIndex = prices.indexOf(top);
        if (outlierIndex >= 0) {
          const adjustedSum = weightedSum - (prices[outlierIndex] * priceWeights[outlierIndex]);
          const adjustedWeight = totalWeight - priceWeights[outlierIndex];
          if (adjustedWeight > 0) {
            trimmedWeightedAvg = Math.round(adjustedSum / adjustedWeight);
          }
        }
      }
    }

    // Guardrail: if spread is extreme (>150%), bias baseline toward lower anchors to avoid pulling high outliers
    let adjustedWeightedAvg = trimmedWeightedAvg;
    if (priceSpread > 1.5 && prices.length >= 4) {
      const sorted = [...prices].sort((a, b) => a - b);
      const q1Idx = Math.floor((sorted.length - 1) * 0.25);
      const q2Idx = Math.floor((sorted.length - 1) * 0.50);
      const q1 = sorted[q1Idx] ?? sorted[0];
      const q2 = sorted[q2Idx] ?? sorted[Math.floor(sorted.length / 2)];
      const lowerAnchor = Math.round(((q1 ?? sorted[0]) + (q2 ?? sorted[0])) / 2);
      adjustedWeightedAvg = Math.round((trimmedWeightedAvg * 0.5) + (lowerAnchor * 0.5));
    }

    // Distance-normalize the baseline for trucking services to reduce large errors when the best textual match
    // comes from a substantially different length-of-haul.
    const distanceNormalizedBaseline = ((): number | null => {
      if (!(isGround || isDrayage)) return null;
      if (!(distanceMiles > 0)) return null;
      if (distanceScaledPrices.length < 4) return null;
      const med = weightedMedian(distanceScaledPrices, distanceScaledWeights);
      if (!med || !Number.isFinite(med) || med <= 0) return null;
      return Math.round(med);
    })();
    if (distanceNormalizedBaseline) {
      adjustedWeightedAvg = Math.round((adjustedWeightedAvg * 0.5) + (distanceNormalizedBaseline * 0.5));
    }
    
    // Hazmat check
    const isHazmat = sourceQuote.hazardous_material === true || 
      /hazmat|hazardous|\bun\d{3,4}\b/i.test(sourceQuote.cargo_description || '');

    const isOversizeHeavy = (() => {
      const weightInLbs = getWeightInLbs(sourceQuote);
      return !!weightInLbs && weightInLbs > 40000;
    })();

    const cargoDescNorm = normalizeText(sourceQuote.cargo_description);
    const cargoIsUnknown = !cargoDescNorm || ['unknown', 'n/a', 'na', 'not specified'].includes(cargoDescNorm);
    
    console.log(`  Best match: ${(bestScore * 100).toFixed(0)}% similar, $${bestPrice.toLocaleString()}${bestFinalReliable ? ' (FINAL)' : ''}`);
    console.log(`  Top ${Math.min(12, sortedMatches.length)} avg: $${weightedAvg.toLocaleString()}, Range: $${minPrice.toLocaleString()}-$${maxPrice.toLocaleString()}, Spread: ${(priceSpread * 100).toFixed(0)}%`);
    
    // PRICING LOGIC: Use BEST MATCH as primary, with confidence-based adjustments
    // This approach achieved 37.9% accuracy in testing - best of all approaches
    let recommendedPrice: number;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW';

    const sortedForAnchors = [...prices].sort((a, b) => a - b);
    const q1 = sortedForAnchors[Math.floor((sortedForAnchors.length - 1) * 0.25)] ?? sortedForAnchors[0] ?? bestPrice;
    const median = sortedForAnchors[Math.floor(sortedForAnchors.length / 2)] ?? q1;
    let lowerQuartileAnchor = Math.round((q1 + median) / 2);

    if (distanceNormalizedBaseline && (isGround || isDrayage)) {
      lowerQuartileAnchor = Math.round((lowerQuartileAnchor * 0.5) + (distanceNormalizedBaseline * 0.5));
    }
    const isHighSpread = priceSpread > 1.2 || priceRatio > 2.5;

    // Special handling: international ocean-like lanes can have a "cheap" historical tail.
    // When spread is high and min is far below the median, bias strongly toward the low tail.
    const minTailIsMuchLower = minPrice > 0 && median > 0 && minPrice < (0.6 * median);
    if (internationalOceanLike && isHighSpread && minTailIsMuchLower) {
      lowerQuartileAnchor = Math.round((minPrice * 0.85) + (q1 * 0.15));
    }

    // High similarity = trust best match, Lower similarity = blend with weighted avg
    if (bestScore >= 0.80) {
      // Very high similarity - trust the best match, unless the match set is wildly inconsistent
      if (isHighSpread) {
        let bestWeight = internationalOceanLike
          ? (minTailIsMuchLower ? 0.35 : 0.45)
          : 0.6;
        // For credible very-heavy ground moves, the high-price best match is often the right anchor.
        if (isGround && isOversizeHeavy) {
          bestWeight = Math.max(bestWeight, 0.75);
        }
        const anchorWeight = 1 - bestWeight;
        recommendedPrice = Math.round((bestPrice * bestWeight) + (lowerQuartileAnchor * anchorWeight));
        confidence = 'MEDIUM';
        console.log(`  HIGH similarity w/ HIGH spread - ${Math.round(bestWeight * 100)}/${Math.round(anchorWeight * 100)} toward lower anchor: $${recommendedPrice.toLocaleString()}`);
      } else {
        recommendedPrice = bestPrice;
        confidence = 'HIGH';
        console.log(`  HIGH similarity (${(bestScore * 100).toFixed(0)}%) - using best match: $${recommendedPrice.toLocaleString()}`);
      }
    } else if (bestScore >= 0.60) {
      // Good similarity - blend; bias down when spread is large
      if (isHighSpread) {
        const bestWeight = internationalOceanLike
          ? (minTailIsMuchLower ? 0.20 : 0.30)
          : 0.5;
        const anchorWeight = 1 - bestWeight;
        recommendedPrice = Math.round((bestPrice * bestWeight) + (lowerQuartileAnchor * anchorWeight));
        confidence = 'MEDIUM';
        console.log(`  MEDIUM similarity w/ HIGH spread - ${Math.round(bestWeight * 100)}/${Math.round(anchorWeight * 100)} to lower anchor: $${recommendedPrice.toLocaleString()}`);
      } else {
        recommendedPrice = Math.round((bestPrice * 0.7) + (adjustedWeightedAvg * 0.3));
        confidence = 'MEDIUM';
        console.log(`  MEDIUM similarity - 70/30 blend: $${recommendedPrice.toLocaleString()}`);
      }
    } else {
      // Lower similarity - use baseline as more stable
      recommendedPrice = adjustedWeightedAvg;
      confidence = 'LOW';
      console.log(`  LOW similarity - using weighted avg: $${recommendedPrice.toLocaleString()}`);
    }

    // Guard against international ocean-like lanes being polluted by all-in staff-reply history.
    // If the entire top-N price set has no "low tail" (min is still very high), infer that the prices
    // likely include inland/drayage/other services and down-shift toward an ocean-only rate.
    const applyOceanLikeGuard = internationalOceanLike && (isOcean || isIntermodal) && !isGround && !isDrayage;
    let ignoreHistoricalSoftBounds = false;
    if (applyOceanLikeGuard && !isHazmat && !oversizeForPricing) {
      const packagingNorm = normalizeText((sourceQuote as any).packaging_type);
      const hasContainerPackaging = packagingNorm.includes('container');
      const descNorm = normalizeText((sourceQuote.cargo_description || '').toString());
      const hasReeferSignal = descNorm.includes('reefer');
      const hasContainerSignal =
        hasContainerPackaging ||
        descNorm.includes('container') ||
        descNorm.includes('cntr') ||
        /\bcont\.?\b/i.test(descNorm) ||
        /\b(?:20|40)\s*(?:ft|hc|high\s*cube)\b/i.test(descNorm);

      // Some intl reefer quotes in this dataset appear to be priced as an "ocean-only" component
      // even when historical best-match prices are very high. When similarity is only moderate,
      // downshift aggressively to avoid chronic 100%+ overpricing.
      if ((isPureOceanRequest || effectiveServiceType.includes('ocean')) && hasReeferSignal && bestPrice >= 7500 && bestScore <= 0.72) {
        const factor = 0.26;
        const oceanOnlyEstimate = Math.max(1600, Math.round(bestPrice * factor));
        if (oceanOnlyEstimate < recommendedPrice) {
          recommendedPrice = oceanOnlyEstimate;
          confidence = 'LOW';
          ignoreHistoricalSoftBounds = true;
          console.log(`  Ocean-only reefer guard: ${(factor * 100).toFixed(0)}% of best match → $${recommendedPrice.toLocaleString()}`);
        }
      }

      // Containerized international quotes are frequently stored as "all-in" in staff-reply history.
      // When we have an explicit container signal, downshift even when bestPrice is only moderately high.
      if ((isPureOceanRequest || effectiveServiceType.includes('ocean')) && hasContainerPackaging && bestPrice >= 3000 && (
        minPrice >= 2500 || isHighSpread
      )) {
        const factor = 0.65;
        const oceanOnlyEstimate = Math.max(1200, Math.round(bestPrice * factor));
        if (oceanOnlyEstimate < recommendedPrice) {
          recommendedPrice = oceanOnlyEstimate;
          confidence = 'LOW';
          ignoreHistoricalSoftBounds = true;
          console.log(`  Ocean-only container guard: ${(factor * 100).toFixed(0)}% of best match → $${recommendedPrice.toLocaleString()}`);
        }
      }

      // Case A: no low tail at all -> derive an ocean-only estimate from the best match
      if ((isPureOceanRequest || effectiveServiceType.includes('ocean')) && bestPrice >= 4000 && (
        // If even the minimum is high, history is likely "all-in" (ocean + inland)
        minPrice >= 3000 ||
        // High-spread sets with a relatively high minimum often indicate duplicated/all-in staff reply artifacts
        (isHighSpread && minPrice >= 2200) ||
        // Unknown-cargo international lanes frequently have inflated historical mins (all-in staff replies)
        (cargoIsUnknown && isHighSpread && minPrice >= 2000)
      )) {
        const factor = minPrice >= 3000 ? 0.25 : 0.30;
        const oceanOnlyEstimate = Math.max(1200, Math.round(bestPrice * factor));
        if (oceanOnlyEstimate < recommendedPrice) {
          recommendedPrice = oceanOnlyEstimate;
          confidence = 'LOW';
          ignoreHistoricalSoftBounds = true;
          console.log(`  Ocean-only contamination guard: ${(factor * 100).toFixed(0)}% of best match → $${recommendedPrice.toLocaleString()}`);
        }
      }

      // Case B: there IS a low tail, but our recommendation is still pulled high -> bias toward Q1
      if (q1 > 0 && q1 < 2800 && recommendedPrice > 3000) {
        const biased = Math.round((recommendedPrice * 0.5) + (q1 * 0.5));
        if (biased < recommendedPrice) {
          recommendedPrice = biased;
          if (confidence === 'HIGH') confidence = 'MEDIUM';
          console.log(`  Ocean-like down-bias toward Q1 ($${q1.toLocaleString()}): $${recommendedPrice.toLocaleString()}`);
        }
      }
    }

    // Fallback: ensure reefer container lanes don't stay anchored near very-high "all-in" best-matches.
    // This is intentionally narrow to avoid affecting non-reefer ocean quotes.
    if (!ignoreHistoricalSoftBounds && internationalOceanLike && (isPureOceanRequest || effectiveServiceType.includes('ocean')) && !isHazmat && !oversizeForPricing) {
      const descNorm = normalizeText((sourceQuote.cargo_description || '').toString());
      const packagingNorm = normalizeText((sourceQuote as any).packaging_type);
      const hasReeferSignal = descNorm.includes('reefer');

      if (hasReeferSignal && bestPrice >= 7500 && bestScore <= 0.72 && recommendedPrice >= 3500) {
        const factor = 0.26;
        const oceanOnlyEstimate = Math.max(1600, Math.round(bestPrice * factor));
        if (oceanOnlyEstimate < recommendedPrice) {
          recommendedPrice = oceanOnlyEstimate;
          confidence = 'LOW';
          ignoreHistoricalSoftBounds = true;
          console.log(`  Ocean-only reefer guard (fallback): ${(factor * 100).toFixed(0)}% of best match → $${recommendedPrice.toLocaleString()}`);
        }
      }
    }

    // Low-price ground quotes without reliable FINAL prices can skew high once multipliers/ceilings apply.
    // Keep this narrowly scoped to commodity/unknown cargo (avoid heavy equipment / OSOW cases).
    if (isGround && !bestFinalReliable && bestScore >= 0.80 && recommendedPrice > 0 && recommendedPrice <= 1500) {
      const weightInLbs = getWeightInLbs(sourceQuote) ?? 0;
      const isHeavyish = weightInLbs > 10000;
      const cargoDesc = (sourceQuote.cargo_description || '').toString();
      const looksLikeMachinery = /\bmachinery\b|\bequipment\b|\bmachine\b|\bcompactor\b/i.test(cargoDesc);
      if (!oversizeLikely && !oversizeForPricing && !looksLikeMachinery && !isHeavyish) {
        recommendedPrice = Math.round(recommendedPrice * 0.85);
        console.log(`  Non-final ground discount applied: $${recommendedPrice.toLocaleString()}`);
      }
    }

    if (!Number.isFinite(recommendedPrice) || recommendedPrice <= 0) {
      const fallback = Number.isFinite(bestPrice) && bestPrice > 0 ? bestPrice : (adjustedWeightedAvg || weightedAvg);
      recommendedPrice = Math.round(fallback);
      confidence = 'LOW';
      console.log(`  Pricing guard: non-finite recommendation; fallback → $${recommendedPrice.toLocaleString()}`);
    }

    // Service-specific multipliers to correct observed biases
    const serviceMultipliers: Record<string, number> = {
      drayage: 1.0,
      ocean: 0.85,
      intermodal: 0.85,
      ground: 1.0,
    };
    const svcKey = effectiveServiceType || serviceType;
    const svcMult = serviceMultipliers[svcKey] ?? 1.0;
    if (svcMult !== 1.0) {
      recommendedPrice = Math.round(recommendedPrice * svcMult);
      console.log(`  Service multiplier (${svcKey}): x${svcMult} → $${recommendedPrice.toLocaleString()}`);
    }

    // International ocean-like lanes sourced from staff replies can be systematically "all-in".
    // When the cargo description is missing/unknown, apply a conservative discount to avoid chronic overpricing.
    if (internationalOceanLike && !ignoreHistoricalSoftBounds && cargoIsUnknown && !oversizeForPricing && !isHazmat && !isGround && !isDrayage) {
      const intlDiscount = 0.70;
      recommendedPrice = Math.round(recommendedPrice * intlDiscount);
      confidence = 'LOW';
      console.log(`  International ocean-like unknown-cargo discount: x${intlDiscount} → $${recommendedPrice.toLocaleString()}`);
    }

    // International reefer/container lanes are frequently ocean-only in this dataset (staff-reply history often looks all-in).
    // Apply a targeted down-shift for explicit container/reefer signals to reduce chronic overpricing.
    if (internationalOceanLike && !ignoreHistoricalSoftBounds && !isHazmat && !isGround && !isDrayage) {
      const cargoDesc = normalizeText(sourceQuote.cargo_description);
      const packagingNorm = normalizeText((sourceQuote as any).packaging_type);
      const hasContainerSignal =
        cargoDesc.includes('reefer') ||
        cargoDesc.includes('container') ||
        cargoDesc.includes('cntr') ||
        /\b(?:20|40)\s*(?:ft|hc|high\s*cube)\b/i.test(cargoDesc) ||
        packagingNorm.includes('container');

      if (hasContainerSignal) {
        const containerDiscount = 0.70;
        recommendedPrice = Math.round(recommendedPrice * containerDiscount);
        confidence = 'LOW';
        console.log(`  International container/reefer discount: x${containerDiscount} → $${recommendedPrice.toLocaleString()}`);
      }
    }

    if (!Number.isFinite(recommendedPrice) || recommendedPrice <= 0) {
      const fallback = Number.isFinite(bestPrice) && bestPrice > 0 ? bestPrice : (adjustedWeightedAvg || weightedAvg);
      recommendedPrice = Math.round(fallback);
      confidence = 'LOW';
      console.log(`  Pricing guard (post-multiplier): fallback → $${recommendedPrice.toLocaleString()}`);
    }

    
    // Hazmat premium (keep conservative; some lanes already have explicit hazmat floors/cap exemptions)
    if (isHazmat) {
      let hazmatMultiplier = 1.25;
      if (isDrayage) {
        // Long-haul "drayage" in this dataset often behaves like standard moves where the hazmat uplift
        // is already baked into the historical baseline; applying it again causes chronic overpricing.
        hazmatMultiplier = (distanceForRules > 100) ? 1.0 : 1.15;
      }
      if (hazmatMultiplier !== 1.0) {
        recommendedPrice = Math.round(recommendedPrice * hazmatMultiplier);
        console.log(`  Hazmat premium applied (x${hazmatMultiplier}): $${recommendedPrice.toLocaleString()}`);
      }
    }

    if (!Number.isFinite(recommendedPrice) || recommendedPrice <= 0) {
      const fallback = Number.isFinite(bestPrice) && bestPrice > 0 ? bestPrice : (adjustedWeightedAvg || weightedAvg);
      recommendedPrice = Math.round(fallback);
      confidence = 'LOW';
      console.log(`  Pricing guard (post-hazmat): fallback → $${recommendedPrice.toLocaleString()}`);
    }

    // Multi-container drayage moves should scale above single-container baselines.
    // Staff-reply history often mixes per-container and total pricing; keep this conservative.
    if (isDrayage && distanceForRules > 0 && distanceForRules <= 60) {
      if (sourceContainerCount >= 3) {
        const mult = sourceContainerCount >= 5 ? 1.35 : 1.25;
        recommendedPrice = Math.round(recommendedPrice * mult);
        if (confidence === 'HIGH') confidence = 'MEDIUM';
        console.log(`  Multi-container drayage multiplier (${sourceContainerCount}): x${mult} → $${recommendedPrice.toLocaleString()}`);
      }
    }

    // Minimum floor for short-haul drayage to avoid excessive underpricing
    if (isDrayage) {
      const isShort = distanceForRules > 0 && distanceForRules <= 50;
      if (isShort) {
        // Allow a slightly lower floor when the historical baseline is clearly low
        const histBaseline = adjustedWeightedAvg || weightedAvg;
        const floor = histBaseline > 0 && histBaseline < 1200 ? 700 : 800;
        recommendedPrice = Math.max(recommendedPrice, floor);
      }
    }
    
    // Apply soft bounds based on historical range
    let softFloor = Math.round(minPrice * 0.70);
    let softCeiling = Math.round(maxPrice * 1.50);

    // If we inferred historical pricing contamination (e.g., all-in staff-reply prices for ocean-only),
    // do NOT use historical min/max as hard bounds; keep bounds relative to the corrected recommendation.
    if (ignoreHistoricalSoftBounds) {
      const relFloor = Math.round(recommendedPrice * 0.75);
      const relCeiling = Math.round(recommendedPrice * 1.35);
      softFloor = Math.max(800, relFloor);
      softCeiling = Math.max(softFloor + 200, relCeiling);
    }

    // Short-haul equipment moves can be overpriced when a single high best-match dominates.
    // For sub-200 mile ground equipment (without explicit OSOW), cap toward the historical baseline.
    const equipmentWord = /\bmachinery\b|\bequipment\b|\bmachine\b|\bexcavator\b|\bbackhoe\b|\bdozer\b|\bbulldozer\b|\bloader\b|\bskid\s*steer\b|\bforklift\b|\bcompactor\b|\broller\b|\bgrader\b|\bpaver\b|\bcrane\b|\btelehandler\b|\btract(?:or|er)\b|\bheat\s*exchanger(?:s)?\b|\bpress\s*brake\b|\bpressbrake\b|\bcnc\b|\broll\s*-?\s*off\b|\brolloff\b/i;
    const equipmentLikelyShort = equipmentWord.test((sourceQuote.cargo_description || '').toString()) || oversizeLikely;
    const originStateForCap = getState((sourceQuote as any).origin_state_province ?? (sourceQuote as any).origin_state);
    const destStateForCap = getState((sourceQuote as any).destination_state_province ?? (sourceQuote as any).destination_state);
    const isIntrastateTX = originStateForCap === 'TX' && destStateForCap === 'TX';
    // Very-heavy weights are often legitimate on interstate equipment moves; keep the cap off there.
    // But TX intrastate equipment pricing in this dataset can be legitimately low even when weights are high.
    const allowCapDespiteHeavy = !isOversizeHeavy || isIntrastateTX;
    if (isGround && distanceMiles > 0 && distanceMiles <= 200 && equipmentLikelyShort && !oversizeForPricing && !isHazmat && allowCapDespiteHeavy) {
      const baseline = weightedAvg;
      // Only cap when history is clearly in the low band (avoid capping legitimate OSOW moves).
      if (baseline > 0 && baseline <= 2000 && recommendedPrice > baseline * 1.30) {
        recommendedPrice = Math.round(baseline * 1.05);
        if (confidence === 'HIGH') confidence = 'MEDIUM';
        console.log(`  Short-haul equipment cap (ground): baseline $${baseline.toLocaleString()} → $${recommendedPrice.toLocaleString()}`);
      }
    }

    // If this looks like machinery/OSOW on a non-trivial ground move, the historical top-N can be
    // misleadingly low (e.g., partial quotes). Establish a minimum band and allow a higher ceiling.
    const cargoDesc = (sourceQuote.cargo_description || '').toString();
    const looksLikeMachinery = /\bmachinery\b|\bequipment\b|\bmachine\b|\bexcavator\b|\bbackhoe\b|\bdozer\b|\bbulldozer\b|\bskid\s*steer\b|\bloader\b|\bforklift\b|\bcompactor\b|\broller\b|\bgrader\b|\bpaver\b|\bcrane\b|\btelehandler\b|\btract(?:or|er)\b|\bheat\s*exchanger(?:s)?\b|\bpress\s*brake\b|\bpressbrake\b|\bcnc\b|\broll\s*-?\s*off\b|\brolloff\b/i.test(cargoDesc);
    const looksLikeRollOffTruck = ((): boolean => {
      const d = normalizeText(cargoDesc);
      return (/(?:\broll\s*-?\s*off\b|\brolloff\b)/i.test(d) && /\btruck(s)?\b/i.test(d));
    })();
    const originCityForDistanceFallback = normalizeText((sourceQuote as any).origin_city);
    const destCityForDistanceFallback = normalizeText((sourceQuote as any).destination_city);
    const hasDistanceFallback = distanceMiles === 0 && !!originCityForDistanceFallback && !!destCityForDistanceFallback && originCityForDistanceFallback !== destCityForDistanceFallback;
    if (isGround && (distanceMiles >= 120 || hasDistanceFallback)) {
      const originStateLocal = getState((sourceQuote as any).origin_state_province ?? (sourceQuote as any).origin_state);
      const destStateLocal = getState((sourceQuote as any).destination_state_province ?? (sourceQuote as any).destination_state);
      const touchesNY = originStateLocal === 'NY' || destStateLocal === 'NY';
      const isIntlGround = isInternationalLane && distanceMiles > 2500;
      const equipmentLikely = looksLikeMachinery || oversizeLikely;

      // Missing structured fields + high-spread history often implies the low best-match is a partial/mis-scoped quote.
      // If the match set contains a credible high-price cluster, lift the floor toward that cluster.
      const hasAnyDims = ((toFiniteNumber((sourceQuote as any).cargo_length) ?? 0) > 0) ||
        ((toFiniteNumber((sourceQuote as any).cargo_width) ?? 0) > 0) ||
        ((toFiniteNumber((sourceQuote as any).cargo_height) ?? 0) > 0);
      const pieces = toFiniteNumber((sourceQuote as any).number_of_pieces) ?? 0;
      const hasTrustedWeight = !!getWeightInLbs(sourceQuote);
      const missingStructured = !hasAnyDims && !hasTrustedWeight && pieces <= 0;
      if (missingStructured && isHighSpread && distanceMiles >= 200 && distanceMiles <= 500 && maxPrice >= 6000 && bestPrice > 0 && bestPrice <= 3000 && !oversizeForPricing && !isHazmat) {
        const upliftFloor = Math.round(Math.max(3500, Math.min(5200, maxPrice * 0.60)));
        if (recommendedPrice < upliftFloor) {
          recommendedPrice = upliftFloor;
          if (confidence === 'HIGH') confidence = 'MEDIUM';
          console.log(`  Missing-data high-spread uplift (ground): $${upliftFloor.toLocaleString()}`);
        }
        softCeiling = Math.max(softCeiling, 9000);
      }

      // Very heavy cargo: only apply strong flooring when we have strict OSOW signals.
      // "OversizeLikely" is intentionally fuzzy and can cause systematic overpricing on short-haul equipment moves.
      if (isOversizeHeavy && oversizeForPricing) {
        const floor = distanceMiles >= 400 ? 4200 : 3500;
        recommendedPrice = Math.max(recommendedPrice, floor);
        softCeiling = Math.max(softCeiling, 9000);
      } else if (isOversizeHeavy && oversizeLikely && distanceMiles >= 400) {
        // If we only have fuzzy signals, keep this limited to longer hauls.
        recommendedPrice = Math.max(recommendedPrice, 3500);
        softCeiling = Math.max(softCeiling, 9000);
      }

      if (oversizeForPricing && distanceMiles >= 250) {
        // OSOW signals without truly heavy weight often price closer to standard specialized FTL.
        const floor = distanceMiles >= 400 ? 3000 : 2600;
        recommendedPrice = Math.max(recommendedPrice, floor);
        softCeiling = Math.max(softCeiling, 8000);
      }

      if (looksLikeMachinery) {
        // Machinery (including excavators) tends to price higher than commodity FTL, even if weight parsing is noisy.
        // For short-haul equipment where the best-match is already high, avoid forcing a high floor;
        // these lanes often have legitimate low baselines and are handled by the short-haul equipment cap.
        if (distanceMiles > 0 && distanceMiles < 200 && bestPrice >= 2000 && !oversizeForPricing) {
          // no-op
        } else {
        const weightInLbs = getWeightInLbs(sourceQuote) ?? 0;
        const isMediumHeavyMachinery = weightInLbs >= 6000;
        const isForklift = /\bforklift\b/i.test(cargoDesc);

        let floor = 3000;
        if (distanceMiles >= 650 && bestPrice > 0 && bestPrice <= 1200 && !oversizeForPricing && !isHazmat) floor = 3600;
        else if (distanceMiles >= 500) floor = 3400;
        else if (distanceMiles >= 350) floor = 3300;
        else if (distanceMiles >= 250) floor = 3200;
        else if (distanceMiles >= 150 && (isMediumHeavyMachinery || isForklift) && bestPrice < 2000) floor = 3200;

        recommendedPrice = Math.max(recommendedPrice, floor);
        softCeiling = Math.max(softCeiling, 7000);
        }
      }

      // Vehicle transport (e.g., roll-off trucks) is routinely underpriced by text-only baselines.
      // Keep this narrowly scoped to explicit roll-off truck signals.
      if (looksLikeRollOffTruck && !isHazmat && !oversizeForPricing) {
        const pieces = toFiniteNumber((sourceQuote as any).number_of_pieces) ?? 0;
        let floor = distanceMiles >= 1000 ? 4500 : (distanceMiles >= 500 ? 3800 : 3200);
        if (pieces >= 2) floor += 400;
        if (recommendedPrice < floor) {
          recommendedPrice = floor;
          if (confidence === 'HIGH') confidence = 'MEDIUM';
          console.log(`  Roll-off truck floor (ground): $${floor.toLocaleString()}`);
        }
        softCeiling = Math.max(softCeiling, 12000);
      }

      // Extreme overweight (even without explicit OSOW keywords) often requires specialized equipment/permits.
      // Only apply when we have a trusted weight signal.
      const sourceWeightLbs = getWeightInLbs(sourceQuote);
      const isIntrastateTX = originStateLocal === 'TX' && destStateLocal === 'TX';
      if (!oversizeForPricing && !isHazmat && sourceWeightLbs && sourceWeightLbs >= 80000 && distanceMiles >= 150 && !isIntrastateTX) {
        let floor = 3800;
        if (distanceMiles >= 500) floor = 5200;
        else if (distanceMiles >= 350) floor = 4600;
        else if (distanceMiles >= 250) floor = 4200;
        if (recommendedPrice < floor) {
          recommendedPrice = floor;
          if (confidence === 'HIGH') confidence = 'MEDIUM';
          console.log(`  Extreme overweight floor (ground): $${floor.toLocaleString()}`);
        }
        softCeiling = Math.max(softCeiling, 12000);
      }

      // If the best-match price implies an implausibly low long-haul rate, avoid anchoring too low.
      // This guards against partial/mis-labeled staff-reply history (e.g., $800 for 700 miles).
      if (!looksLikeMachinery && distanceMiles >= 400 && bestPrice > 0 && (bestPrice / distanceMiles) < 2.0 && !isHazmat && !oversizeForPricing) {
        const floor = Math.round(distanceMiles * 3.5 + 200);
        if (recommendedPrice < floor) {
          recommendedPrice = floor;
          if (confidence === 'HIGH') confidence = 'MEDIUM';
          console.log(`  Long-haul ground low-anchor floor: $${floor.toLocaleString()}`);
        }
      }

      // Targeted: equipment moves into/out of NY are frequently higher-cost.
      if (touchesNY && equipmentLikely) {
        const nyFloor = distanceMiles >= 250 ? 4200 : 3800;
        recommendedPrice = Math.max(recommendedPrice, nyFloor);
        softCeiling = Math.max(softCeiling, 9000);
      }

      // Targeted: international "ground"-labeled equipment moves should not price like domestic FTL.
      if (isIntlGround && equipmentLikely) {
        recommendedPrice = Math.max(recommendedPrice, 4500);
        softCeiling = Math.max(softCeiling, 12000);
      }

      // Unknown cargo + very heavy weight often indicates specialized handling even when the description is blank.
      if (cargoIsUnknown && isOversizeHeavy) {
        recommendedPrice = Math.max(recommendedPrice, 5500);
        softCeiling = Math.max(softCeiling, 10000);
      }
    }

    // Additional caps for short-haul cases
    const isDrayageShort = effectiveServiceType.includes('drayage') && distanceForRules > 0 && distanceForRules <= 50;
    const isGroundShort = effectiveServiceType.includes('ground') && distanceForRules > 0 && distanceForRules <= 50;
    const originState = getState((sourceQuote as any).origin_state_province ?? (sourceQuote as any).origin_state);
    const destState = getState((sourceQuote as any).destination_state_province ?? (sourceQuote as any).destination_state);
    const originCity = normalizeText((sourceQuote as any).origin_city);
    const destCity = normalizeText((sourceQuote as any).destination_city);
    const isNYNJ = (originState === 'NY' || originState === 'NJ' || destState === 'NY' || destState === 'NJ');
    const isTX = (originState === 'TX' || destState === 'TX');
    const isPortElizabeth = originCity.startsWith('port elizabeth') || destCity.startsWith('port elizabeth');
    const isMetroNYNJ = isNYNJ && !isPortElizabeth && (hasAny(originCity, ['new york', 'newark', 'elizabeth', 'jersey', 'passaic', 'bergen', 'hillside']) || hasAny(destCity, ['new york', 'newark', 'elizabeth', 'jersey', 'passaic', 'bergen', 'hillside']));
    const isMetroTX = isTX && (hasAny(originCity, ['houston', 'dallas', 'fort worth', 'austin', 'san antonio']) || hasAny(destCity, ['houston', 'dallas', 'fort worth', 'austin', 'san antonio']));
    const isMetroDFW = isTX && (hasAny(originCity, ['dallas', 'fort worth']) || hasAny(destCity, ['dallas', 'fort worth']));

    // Hazmat drayage is routinely above standard short-haul caps; don't apply generic ceilings.
    if (isDrayage && isHazmat && isMetroNYNJ && distanceForRules > 0 && distanceForRules <= 60) {
      const hazmatFloor = 4200;
      recommendedPrice = Math.max(recommendedPrice, hazmatFloor);
      softCeiling = Math.max(softCeiling, hazmatFloor + 800);
    }

    if (isDrayageShort && !oversizeForPricing && !isHazmat) {
      const isVeryShort = distanceForRules > 0 && distanceForRules <= 20;
      let cap = 1500;
      if (isMetroNYNJ) {
        // NY/NJ drayage has outliers; cap closer to the low quartile on very short moves.
        cap = isVeryShort ? Math.min(1750, Math.max(1450, Math.round(q1 * 1.05))) : 2200;
        if (isVeryShort) {
          const histBaseline = adjustedWeightedAvg || weightedAvg;
          // If the best match itself is low but the overall baseline is meaningfully higher,
          // allow a higher ceiling to avoid chronic underpricing on these local moves.
          if (bestPrice > 0 && bestPrice <= 1700 && histBaseline >= 1750) {
            cap = Math.max(cap, Math.min(2000, Math.round(histBaseline * 1.05)));
          }
        }
      } else if (isMetroDFW) {
        cap = isVeryShort ? 850 : 950;
      } else if (isMetroTX) {
        cap = isVeryShort ? 1000 : 1300;
      }
      softCeiling = Math.min(softCeiling, cap);
    }

    // Medium drayage (50-80mi) in NY/NJ can have some low actuals, but aggressive ceilings cause chronic underpricing.
    // Keep a conservative ceiling that only meaningfully affects extreme recommendations.
    if (effectiveServiceType.includes('drayage') && distanceForRules > 50 && distanceForRules <= 80 && isNYNJ && !oversizeForPricing && !isHazmat) {
      const cap = Math.max(1900, Math.round(q1 * 1.2));
      softCeiling = Math.min(softCeiling, cap);
    }

    // Targeted: NY/NJ single-container drayage has frequent low actuals in the 50-90mi band.
    // Use a conservative per-mile ceiling to avoid systematic overpricing for single-container moves.
    if (
      effectiveServiceType.includes('drayage') &&
      distanceForRules > 45 && distanceForRules <= 90 &&
      isNYNJ &&
      sourceContainerCount === 1 &&
      bestPrice > 0 && bestPrice <= 1700 &&
      minPrice > 0 && minPrice <= 1600 &&
      !oversizeForPricing &&
      !isHazmat
    ) {
      const cap = clamp(Math.round(distanceForRules * 12 + 250), 900, 1400);
      softCeiling = Math.min(softCeiling, cap);
      console.log(`  NY/NJ single-container drayage cap: $${cap.toLocaleString()}`);
    }

    // Very-short ocean/intermodal requests corrected to ground can be wildly overpriced by text-only anchors.
    // Cap these toward a local heavy-equipment band.
    if (isGround && correctedOceanOrIntermodalToGround && distanceForRules > 0 && distanceForRules <= 15 && equipmentLikelyShort && !isHazmat) {
      const cap = clamp(Math.round(distanceForRules * 200 + 3500), 3500, 5200);
      softCeiling = Math.min(softCeiling, cap);
      console.log(`  Local corrected-ocean heavy cap (ground): $${cap.toLocaleString()}`);
    }
    if (isGroundShort && !oversizeForPricing && !oversizeLikely) {
      const isVeryShort = distanceForRules > 0 && distanceForRules <= 20;
      softCeiling = Math.min(softCeiling, isVeryShort ? 1400 : 1500);
    }
    
    if (recommendedPrice < softFloor) {
      recommendedPrice = softFloor;
      console.log(`  Floor applied: $${recommendedPrice.toLocaleString()}`);
    }
    if (recommendedPrice > softCeiling) {
      recommendedPrice = softCeiling;
      console.log(`  Ceiling applied: $${recommendedPrice.toLocaleString()}`);
    }

    // Intermodal extreme pricing cap: prevent best-match pulling far above baseline
    if (effectiveServiceType.includes('intermodal')) {
      const extremeCap = Math.min(maxPrice, Math.round((adjustedWeightedAvg || weightedAvg) * 1.2));
      if (recommendedPrice > extremeCap) {
        recommendedPrice = extremeCap;
        console.log(`  Intermodal extreme cap applied: $${recommendedPrice.toLocaleString()}`);
      }
    }

    // If oversize is likely on ground, avoid underpricing.
    // Keep this modest and avoid compounding with OSOW floors.
    if (isGround && oversizeForPricing && recommendedPrice > 0 && recommendedPrice < 4000) {
      const bump = isOversizeHeavy ? 1.15 : 1.08;
      // If we're already within ~10% of the best match, don't add an extra oversize uplift;
      // this tends to push otherwise-correct predictions outside the 20% band.
      if (!(bestPrice > 0 && recommendedPrice >= bestPrice * 0.90)) {
        recommendedPrice = Math.round(recommendedPrice * bump);
        console.log(`  Oversize keyword bump (ground): x${bump} → $${recommendedPrice.toLocaleString()}`);
      }
    }
    
    const result: AIPricingDetails = {
      recommended_price: recommendedPrice,
      floor_price: softFloor,
      target_price: bestPrice,
      ceiling_price: softCeiling,
      confidence,
      price_breakdown: {
        linehaul: Math.round(recommendedPrice * 0.70),
        fuel_surcharge: Math.round(recommendedPrice * 0.15),
        accessorials: Math.round(recommendedPrice * 0.10),
        margin: Math.round(recommendedPrice * 0.05),
      },
      reasoning: `Best match: ${(bestScore * 100).toFixed(0)}% similar at $${bestPrice.toLocaleString()}. Top 3 range: $${minPrice.toLocaleString()}-$${maxPrice.toLocaleString()}.`,
      market_factors: ['Best match pricing', effectiveServiceType, `${distanceMiles} miles`],
      negotiation_room_percent: confidence === 'HIGH' ? 10 : 15,
    };
    
    console.log(`  Recommended: $${recommendedPrice.toLocaleString()} (${confidence} confidence)`);
    return result;
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
    routeDistance?: RouteDistance | null,
    formulaPriceHint?: number
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
    
    // Detect hazardous materials - significant price premium
    const isHazmat = sourceQuote.hazardous_material === true || 
      (sourceQuote.cargo_description || '').toLowerCase().includes('hazmat') ||
      (sourceQuote.cargo_description || '').toLowerCase().includes('hazardous') ||
      !!(sourceQuote.cargo_description || '').toLowerCase().match(/\bun\d{3,4}\b/);

    // Determine constraint level based on baseline reliability
    // MUCH STRICTER: Always enforce maximum deviation from baseline
    let constraintNote = '';
    
    // Calculate absolute bounds based on effective baseline - NEVER deviate more than 50% from reliable baseline
    // For hazmat, multiply bounds by 2-3x since historical matches may not be hazmat
    const hazmatMultiplier = isHazmat ? 2.5 : 1.0;
    const absoluteFloor = isReliableBaseline ? Math.round(minHistPrice * 0.80 * hazmatMultiplier) : Math.round(effectiveBaseline * 0.50 * hazmatMultiplier);
    const absoluteCeiling = isReliableBaseline ? Math.round(maxHistPrice * 1.25 * hazmatMultiplier) : Math.round(effectiveBaseline * 2.0 * hazmatMultiplier);
    
    // Hazmat override - highest priority
    if (isHazmat) {
      constraintNote = `\n**HAZMAT CONSTRAINT (CRITICAL)**: This is hazardous materials cargo requiring special handling, permits, and compliance. HAZMAT adds 100-200% premium to standard rates. Your recommended price MUST be between $${absoluteFloor.toLocaleString()} and $${absoluteCeiling.toLocaleString()}. Historical matches may NOT be hazmat - apply appropriate premium.`;
    } else if (isOversizeHeavy) {
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
    
    // If formula price hint is provided (high variance case), override the baseline
    const useFormulaBaseline = formulaPriceHint && formulaPriceHint > 0;
    const promptBaseline = useFormulaBaseline ? formulaPriceHint : effectiveBaseline;
    const promptFloor = useFormulaBaseline ? Math.round(formulaPriceHint * 0.70) : absoluteFloor;
    const promptCeiling = useFormulaBaseline ? Math.round(formulaPriceHint * 1.40) : absoluteCeiling;
    
    // Override constraint note if using formula pricing
    if (useFormulaBaseline) {
      constraintNote = `\n**FORMULA-BASED PRICING (HIGH VARIANCE)**: Historical data has too much variance (prices ranging from $${minHistPrice.toLocaleString()} to $${maxHistPrice.toLocaleString()}). Use the formula-based baseline of **$${formulaPriceHint.toLocaleString()}** instead. Your price MUST be between $${promptFloor.toLocaleString()} and $${promptCeiling.toLocaleString()}.`;
    }

    return `You are a senior pricing analyst at a drayage and transportation company. Your MOST IMPORTANT task is to provide accurate prices based on ${useFormulaBaseline ? 'formula-based pricing (historical data is unreliable)' : 'historical similar quotes'}.

## CRITICAL PRICING RULE
**${useFormulaBaseline ? 'USE FORMULA-BASED PRICING' : 'YOU MUST BASE YOUR PRICE ON THE HISTORICAL MATCHES BELOW'}.**
- ${useFormulaBaseline ? 'Formula-based baseline price' : 'The weighted average of similar historical quotes'} is: **$${promptBaseline.toLocaleString()}**
${!useFormulaBaseline ? `- Historical price range: $${minHistPrice.toLocaleString()} - $${maxHistPrice.toLocaleString()}` : ''}
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
Return ONLY valid JSON. Your recommended_price should be close to the baseline of $${promptBaseline.toLocaleString()} unless adjustments are clearly needed:

{
  "recommended_price": ${promptBaseline > 0 ? promptBaseline : 0},
  "floor_price": ${promptBaseline > 0 ? Math.round(promptBaseline * 0.85) : 0},
  "target_price": ${promptBaseline > 0 ? promptBaseline : 0},
  "ceiling_price": ${promptBaseline > 0 ? Math.round(promptBaseline * 1.15) : 0},
  "confidence": "HIGH|MEDIUM|LOW",
  "price_breakdown": {
    "linehaul": 0.00,
    "fuel_surcharge": 0.00,
    "accessorials": 0.00,
    "margin": 0.00
  },
  "reasoning": "Brief explanation${useFormulaBaseline ? ' - note: using formula pricing due to high historical variance' : ' - must reference historical matches'}",
  "market_factors": ["Factor 1", "Factor 2"],
  "negotiation_room_percent": 10
}`;
  }
}
