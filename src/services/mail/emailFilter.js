/**
 * Email Filter Service
 * Pre-filters emails to identify likely quote requests before expensive API processing
 */

class EmailFilter {
  // Keywords that strongly indicate a quote email
  static STRONG_QUOTE_KEYWORDS = [
    'quote',
    'quotation',
    'rfq',
    'request for quote',
    'price',
    'pricing',
    'rate',
    'rates',
    'cost',
    'costs',
    'shipment',
    'shipping',
    'freight',
    'cargo',
    'estimate',
    'proposal',
    'bid',
    'tariff',
    // Load types
    'ltl',
    'ftl',
    'fcl',
    'lcl',
    'partial load',
    'full truckload',
    // Services
    'drayage',
    'transload',
    'cross dock',
    'intermodal',
    // Overweight/Oversized specific
    'overweight',
    'oversized',
    'oversize',
    'over dimensional',
    'overdimensional',
    'heavy haul',
    'permit load',
    'wide load',
    'superload',
    // Equipment types
    'flatbed',
    'step deck',
    'stepdeck',
    'rgn',
    'lowboy',
    'double drop',
    'conestoga',
    'hotshot',
    'power only',
  ];

  // Keywords that moderately indicate a quote
  static MODERATE_KEYWORDS = [
    'delivery',
    'pickup',
    'transport',
    'logistics',
    'pallet',
    'pallets',
    'skid',
    'skids',
    'crate',
    'container',
    'containers',
    'origin',
    'destination',
    'weight',
    'dimensions',
    'length',
    'width',
    'height',
    'lbs',
    'pounds',
    'kg',
    'kilograms',
    'tonnes',
    'tons',
    'feet',
    'meters',
    // Urgency
    'urgent',
    'asap',
    'rush',
    'expedite',
    'expedited',
    'time sensitive',
    'critical',
    // Special requirements
    'hazmat',
    'hazardous',
    'temperature controlled',
    'refrigerated',
    'reefer',
    'customs',
    'import',
    'export',
    'clearance',
    'warehousing',
    'storage',
    'distribution',
    // Equipment and loading
    'machinery',
    'equipment',
    'construction',
    'industrial',
    'crane',
    'forklift',
    'loading dock',
    'liftgate',
    'tarping',
    'tarp',
    'securement',
    'straps',
    'chains',
    // Permits and escorts
    'permit',
    'permits',
    'pilot car',
    'escort',
    'route survey',
    // Cargo types
    'steel',
    'lumber',
    'pipe',
    'coil',
    'rebar',
    'beam',
    'truss',
    'generator',
    'transformer',
    'excavator',
    'bulldozer',
    'crane',
    'boat',
    'yacht',
    // Terms
    'incoterms',
    'fob',
    'cif',
    'ddp',
    'exw',
    'bol',
    'bill of lading',
  ];

  // Keywords that indicate it's NOT a quote (internal/spam)
  static EXCLUDE_KEYWORDS = [
    'unsubscribe',
    'newsletter',
    'notification',
    'password reset',
    'verify your email',
    'confirm your',
    'update your',
    'invoice',
    'receipt',
    'payment received',
    're: re:',
    'fwd: fwd:',
    'out of office',
    'automatic reply',
    'delivery confirmation',
    'shipment delivered',
    'pod', // Proof of delivery
    'tracking update',
    'in transit',
    'departed facility', // Tracking notifications
  ];

  /**
   * Calculate a score (0-100) indicating likelihood this is a quote email
   * @param {Object} email - Email object from Microsoft Graph
   * @returns {Object} { score, reason }
   */
  static calculateQuoteScore(email) {
    let score = 0;
    const reasons = [];

    const subject = (email.subject || '').toLowerCase();
    const bodyPreview = (email.bodyPreview || '').toLowerCase();
    const senderEmail = (email.from?.emailAddress?.address || '').toLowerCase();
    const senderName = (email.from?.emailAddress?.name || '').toLowerCase();

    // Extract sender domain
    const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1] : '';

    // Combine subject and preview for analysis
    const content = `${subject} ${bodyPreview}`;

    // 0. CRITICAL: Exclude internal Seahorse emails (outgoing quotes, not incoming requests)
    if (senderDomain === 'seahorseexpress.com' || senderEmail.includes('seahorseexpress.com')) {
      return { score: 0, reason: 'Internal Seahorse email - outgoing quote (excluded)' };
    }

    // Exclude known Seahorse staff by name (in case emails come from personal addresses)
    const seahorseStaff = [
      'danny nasser',
      'tina merkab',
      'seahorse express',
      // Add other staff names here
    ];
    if (seahorseStaff.some((name) => senderName.includes(name))) {
      return { score: 0, reason: `Known Seahorse staff: ${senderName} (excluded)` };
    }

    // 1. Check for exclusion keywords (immediate reject)
    for (const keyword of EmailFilter.EXCLUDE_KEYWORDS) {
      if (content.includes(keyword)) {
        return { score: 0, reason: `Excluded: Contains '${keyword}'` };
      }
    }

    // 2. Check for strong quote keywords in subject (high value)
    const strongInSubject = EmailFilter.STRONG_QUOTE_KEYWORDS.filter((kw) =>
      subject.includes(kw)
    ).length;
    if (strongInSubject > 0) {
      score += 40;
      reasons.push(`${strongInSubject} strong keyword(s) in subject`);
    }

    // 3. Check for strong keywords in body
    const strongInBody = EmailFilter.STRONG_QUOTE_KEYWORDS.filter((kw) =>
      bodyPreview.includes(kw)
    ).length;
    if (strongInBody > 0) {
      score += 20;
      reasons.push(`${strongInBody} strong keyword(s) in body`);
    }

    // 4. Check for moderate keywords
    const moderateCount = EmailFilter.MODERATE_KEYWORDS.filter((kw) => content.includes(kw)).length;
    if (moderateCount > 0) {
      score += Math.min(moderateCount * 5, 20); // Max 20 points
      reasons.push(`${moderateCount} moderate keyword(s)`);
    }

    // 5. Check for numbers (prices, weights, dimensions)
    const hasDollar = content.includes('$') || content.includes('usd');
    const hasWeight = /\d+\s*(kg|lb|lbs|ton|tonnes)/i.test(content);
    const hasDimensions = /\d+\s*x\s*\d+\s*x\s*\d+/i.test(content);

    if (hasDollar) {
      score += 10;
      reasons.push('Contains price ($)');
    }
    if (hasWeight) {
      score += 10;
      reasons.push('Contains weight');
    }
    if (hasDimensions) {
      score += 10;
      reasons.push('Contains dimensions');
    }

    // 6. Check for automated senders (already excluded internal Seahorse above)
    if (
      senderEmail.startsWith('noreply@') ||
      senderEmail.startsWith('no-reply@') ||
      senderEmail.startsWith('donotreply@')
    ) {
      score -= 20;
      reasons.push('Automated sender');
    }

    // 7. Check for question marks (requests typically have questions)
    const questionCount = (content.match(/\?/g) || []).length;
    if (questionCount > 0) {
      score += Math.min(questionCount * 3, 10);
      reasons.push(`${questionCount} question(s)`);
    }

    // 8. Check for email having attachments (quotes often have PDFs)
    if (email.hasAttachments) {
      score += 5;
      reasons.push('Has attachments');
    }

    // 9. Warn about very long emails (might be email chains)
    if (email.bodyPreview.length > 5000) {
      score -= 10;
      reasons.push('Very long email (likely chain)');
    }

    // Cap score at 100
    score = Math.min(score, 100);

    const reasonText = reasons.length > 0 ? reasons.join('; ') : 'No indicators';

    return { score, reason: reasonText };
  }

  /**
   * Determine if email should be processed with Claude API
   * @param {Object} email - Email object
   * @param {number} threshold - Minimum score to process (default 30)
   * @returns {Object} { shouldProcess, score, reason }
   */
  static shouldProcess(email, threshold = 30) {
    const { score, reason } = this.calculateQuoteScore(email);
    return {
      shouldProcess: score >= threshold,
      score,
      reason,
    };
  }

  /**
   * Filter array of emails and separate into process/skip groups
   * @param {Array} emails - Array of email objects
   * @param {number} threshold - Score threshold
   * @returns {Object} { toProcess, toSkip, summary }
   */
  static filterEmails(emails, threshold = 30) {
    const toProcess = [];
    const toSkip = [];

    for (const email of emails) {
      const result = this.shouldProcess(email, threshold);

      const emailWithScore = {
        ...email,
        filterScore: result.score,
        filterReason: result.reason,
      };

      if (result.shouldProcess) {
        toProcess.push(emailWithScore);
      } else {
        toSkip.push(emailWithScore);
      }
    }

    const requestPrice = parseFloat(process.env.REQUEST_PRICE) || 0.015;

    const summary = {
      total: emails.length,
      toProcess: toProcess.length,
      toSkip: toSkip.length,
      processPercentage:
        emails.length > 0 ? ((toProcess.length / emails.length) * 100).toFixed(1) : 0,
      estimatedCost: toProcess.length * requestPrice,
      estimatedSavings: toSkip.length * requestPrice,
    };

    return { toProcess, toSkip, summary };
  }

  /**
   * Generate preview report of filtered emails
   * @param {Array} emails - Array of email objects
   * @param {number} threshold - Score threshold
   * @returns {Object} Detailed preview data
   */
  static generatePreview(emails, threshold = 30) {
    const { toProcess, toSkip, summary } = this.filterEmails(emails, threshold);

    const preview = {
      threshold,
      summary,
      toProcess: toProcess.map((email) => ({
        id: email.id,
        subject: email.subject,
        from: email.from?.emailAddress?.name,
        score: email.filterScore,
        reason: email.filterReason,
        receivedDateTime: email.receivedDateTime,
      })),
      toSkip: toSkip.map((email) => ({
        id: email.id,
        subject: email.subject,
        from: email.from?.emailAddress?.name,
        score: email.filterScore,
        reason: email.filterReason,
        receivedDateTime: email.receivedDateTime,
      })),
    };

    return preview;
  }
}

export default EmailFilter;
export const {
  calculateQuoteScore,
  filterEmails,
  getFilterPreview,
  generatePreview,
  shouldProcess,
} = EmailFilter;