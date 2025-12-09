/**
 * Email Filter Service
 * Pre-filters emails to identify likely quote requests before expensive API processing
 */

import { checkEmailExists, isSpammer } from '../../config/db.js';
import { processEmailAttachments } from '../attachmentProcessor.js';
import type { Email, FilterPreview, FilteredEmailPreview, FilterSummary, AttachmentMeta } from '../../types/index.js';

interface FilterResult {
  score: number;
  reason: string;
}

interface SpamCheckResult {
  isSpam: boolean;
  reason: string;
  score?: number;
}

interface ExclusionCheckResult {
  isExcluded: boolean;
  reason: string;
}

interface ShouldProcessResult {
  shouldProcess: boolean;
  score: number;
  reason: string;
}

interface EmailWithScore extends Email {
  filterScore: number;
  filterReason: string;
}

interface FilterEmailsResult {
  toProcess: EmailWithScore[];
  toSkip: EmailWithScore[];
  summary: FilterSummary;
}

interface FilterOptions {
  processAttachments?: boolean;
}

class EmailFilter {
  static STRONG_QUOTE_KEYWORDS = [
    'quote', 'quotation', 'rfq', 'request for quote', 'price', 'pricing',
    'rate', 'rates', 'cost', 'costs', 'shipment', 'shipping', 'freight',
    'cargo', 'estimate', 'proposal', 'bid', 'tariff',
    'ltl', 'ftl', 'fcl', 'lcl', 'partial load', 'full truckload',
    'drayage', 'transload', 'cross dock', 'intermodal',
    'overweight', 'oversized', 'oversize', 'over dimensional', 'overdimensional',
    'heavy haul', 'permit load', 'wide load', 'superload',
    'flatbed', 'step deck', 'stepdeck', 'rgn', 'lowboy', 'double drop',
    'conestoga', 'hotshot', 'power only',
  ];

  static MODERATE_KEYWORDS = [
    'delivery', 'pickup', 'transport', 'logistics', 'pallet', 'pallets',
    'skid', 'skids', 'crate', 'container', 'containers', 'origin', 'destination',
    'weight', 'dimensions', 'length', 'width', 'height', 'lbs', 'pounds',
    'kg', 'kilograms', 'tonnes', 'tons', 'feet', 'meters',
    'urgent', 'asap', 'rush', 'expedite', 'expedited', 'time sensitive', 'critical',
    'hazmat', 'hazardous', 'temperature controlled', 'refrigerated', 'reefer',
    'customs', 'import', 'export', 'clearance', 'warehousing', 'storage', 'distribution',
    'machinery', 'equipment', 'construction', 'industrial', 'crane', 'forklift',
    'loading dock', 'liftgate', 'tarping', 'tarp', 'securement', 'straps', 'chains',
    'permit', 'permits', 'pilot car', 'escort', 'route survey',
    'steel', 'lumber', 'pipe', 'coil', 'rebar', 'beam', 'truss',
    'generator', 'transformer', 'excavator', 'bulldozer', 'boat', 'yacht',
    'incoterms', 'fob', 'cif', 'ddp', 'exw', 'bol', 'bill of lading',
  ];

  static EXCLUDE_KEYWORDS = [
    'unsubscribe', 'newsletter', 'notification', 'password reset',
    'verify your email', 'confirm your', 'update your', 'invoice',
    'receipt', 'payment received', 're: re:', 'fwd: fwd:', 'out of office',
    'automatic reply', 'delivery confirmation', 'shipment delivered', 'pod',
    'tracking update', 'in transit', 'departed facility',
  ];

  /**
   * Check if an email is from a spammer
   */
  static async checkSpammer(email: Email): Promise<SpamCheckResult> {
    const subject = (email.subject || '').toLowerCase();
    const bodyPreview = (email.bodyPreview || '').toLowerCase();
    const content = `${subject} ${bodyPreview}`;
    for (const keyword of EmailFilter.EXCLUDE_KEYWORDS) {
      if (content.includes(keyword)) {
        return { isSpam: true, reason: `Excluded: Contains '${keyword}'`, score: 0 };
      }
    }

    const senderEmail = (email.from?.emailAddress?.address || '').toLowerCase();
    if (!senderEmail) {
      return { isSpam: false, reason: '' };
    }
    const spammerFound = await isSpammer(senderEmail);
    if (spammerFound) {
      return { isSpam: true, reason: `Blocked spammer: ${senderEmail}` };
    }
    return { isSpam: false, reason: '' };
  }

  static async isToBeExcluded(email: Email): Promise<ExclusionCheckResult> {
    const subject = (email.subject || '').toLowerCase();
    const bodyPreview = (email.bodyPreview || '').toLowerCase();
    const senderEmail = (email.from?.emailAddress?.address || '').toLowerCase();
    const senderName = (email.from?.emailAddress?.name || '').toLowerCase();

    const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1] : '';
    const content = `${subject} ${bodyPreview}`;

    if (senderDomain === 'seahorseexpress.com' || senderEmail.includes('seahorseexpress.com')) {
      return { isExcluded: true, reason: 'Internal Seahorse email - outgoing quote (excluded)' };
    }

    const seahorseStaff = ['danny nasser', 'tina merkab', 'seahorse express'];
    if (seahorseStaff.some((name) => senderName.includes(name))) {
      return { isExcluded: true, reason: `Known Seahorse staff: ${senderName} (excluded)` };
    }

    for (const keyword of EmailFilter.EXCLUDE_KEYWORDS) {
      if (content.includes(keyword)) {
        return { isExcluded: true, reason: `Excluded: Contains '${keyword}'` };
      }
    }
    return { isExcluded: false, reason: '' };
  }

  /**
   * Calculate a score (0-100) indicating likelihood this is a quote email
   */
  static calculateQuoteScore(email: Email): FilterResult {
    let score = 0;
    const reasons: string[] = [];

    const subject = (email.subject || '').toLowerCase();
    const bodyPreview = (email.bodyPreview || '').toLowerCase();
    const senderEmail = (email.from?.emailAddress?.address || '').toLowerCase();
    const senderName = (email.from?.emailAddress?.name || '').toLowerCase();

    const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1] : '';
    const content = `${subject} ${bodyPreview}`;

    if (senderDomain === 'seahorseexpress.com' || senderEmail.includes('seahorseexpress.com')) {
      return { score: 0, reason: 'Internal Seahorse email - outgoing quote (excluded)' };
    }

    const seahorseStaff = ['danny nasser', 'tina merkab', 'seahorse express'];
    if (seahorseStaff.some((name) => senderName.includes(name))) {
      return { score: 0, reason: `Known Seahorse staff: ${senderName} (excluded)` };
    }

    for (const keyword of EmailFilter.EXCLUDE_KEYWORDS) {
      if (content.includes(keyword)) {
        return { score: 0, reason: `Excluded: Contains '${keyword}'` };
      }
    }

    const strongInSubject = EmailFilter.STRONG_QUOTE_KEYWORDS.filter((kw) =>
      subject.includes(kw)
    ).length;
    if (strongInSubject > 0) {
      score += 40;
      reasons.push(`${strongInSubject} strong keyword(s) in subject`);
    }

    const strongInBody = EmailFilter.STRONG_QUOTE_KEYWORDS.filter((kw) =>
      bodyPreview.includes(kw)
    ).length;
    if (strongInBody > 0) {
      score += 20;
      reasons.push(`${strongInBody} strong keyword(s) in body`);
    }

    const moderateCount = EmailFilter.MODERATE_KEYWORDS.filter((kw) => content.includes(kw)).length;
    if (moderateCount > 0) {
      score += Math.min(moderateCount * 5, 20);
      reasons.push(`${moderateCount} moderate keyword(s)`);
    }

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

    if (
      senderEmail.startsWith('noreply@') ||
      senderEmail.startsWith('no-reply@') ||
      senderEmail.startsWith('donotreply@')
    ) {
      score -= 20;
      reasons.push('Automated sender');
    }

    const questionCount = (content.match(/\?/g) || []).length;
    if (questionCount > 0) {
      score += Math.min(questionCount * 3, 10);
      reasons.push(`${questionCount} question(s)`);
    }

    if (email.hasAttachments) {
      score += 5;
      reasons.push('Has attachments');
    }

    if (email.attachmentText) {
      const attachmentContent = email.attachmentText.toLowerCase();

      const strongInAttachment = EmailFilter.STRONG_QUOTE_KEYWORDS.filter((kw) =>
        attachmentContent.includes(kw)
      ).length;
      if (strongInAttachment > 0) {
        score += 25;
        reasons.push(`${strongInAttachment} strong keyword(s) in attachments`);
      }

      const moderateInAttachment = EmailFilter.MODERATE_KEYWORDS.filter((kw) =>
        attachmentContent.includes(kw)
      ).length;
      if (moderateInAttachment > 0) {
        score += Math.min(moderateInAttachment * 3, 15);
        reasons.push(`${moderateInAttachment} moderate keyword(s) in attachments`);
      }

      const attachmentHasDollar =
        attachmentContent.includes('$') || attachmentContent.includes('usd');
      const attachmentHasWeight = /\d+\s*(kg|lb|lbs|ton|tonnes)/i.test(attachmentContent);
      const attachmentHasDimensions = /\d+\s*x\s*\d+\s*x\s*\d+/i.test(attachmentContent);

      if (attachmentHasDollar) {
        score += 8;
        reasons.push('Attachment contains price ($)');
      }
      if (attachmentHasWeight) {
        score += 8;
        reasons.push('Attachment contains weight');
      }
      if (attachmentHasDimensions) {
        score += 8;
        reasons.push('Attachment contains dimensions');
      }
    }

    if ((email.bodyPreview || '').length > 5000) {
      score -= 10;
      reasons.push('Very long email (likely chain)');
    }

    score = Math.min(score, 100);

    const reasonText = reasons.length > 0 ? reasons.join('; ') : 'No indicators';

    return { score, reason: reasonText };
  }

  /**
   * Determine if email should be processed with Claude API
   */
  static async shouldProcess(email: Email, threshold = 30): Promise<ShouldProcessResult> {
    const { score, reason } = this.calculateQuoteScore(email);
    return {
      shouldProcess: score >= threshold,
      score,
      reason,
    };
  }

  /**
   * Filter array of emails and separate into process/skip groups
   */
  static async filterEmails(
    emails: Email[],
    threshold = 30,
    options: FilterOptions = {}
  ): Promise<FilterEmailsResult> {
    const { processAttachments = true } = options;
    const toProcess: EmailWithScore[] = [];
    const toSkip: EmailWithScore[] = [];

    for (const email of emails) {
      const spamCheck = await this.checkSpammer(email);

      let emailWithAttachmentText = email;
      if (spamCheck.isSpam) {
        const emailWithScore: EmailWithScore = {
          ...emailWithAttachmentText,
          filterScore: 0,
          filterReason: spamCheck.reason,
        };
        toSkip.push(emailWithScore);
        continue;
      }

      const exclusionCheck = await this.isToBeExcluded(email);
      if (exclusionCheck.isExcluded) {
        const emailWithScore: EmailWithScore = {
          ...emailWithAttachmentText,
          filterScore: 0,
          filterReason: exclusionCheck.reason,
        };
        toSkip.push(emailWithScore);
        continue;
      }

      const exists = await checkEmailExists(email.id);
      if (exists) {
        console.log(`  Already processed, skipping`);
        const emailWithScore: EmailWithScore = {
          ...emailWithAttachmentText,
          filterScore: 0,
          filterReason: 'Already processed',
        };
        toSkip.push(emailWithScore);
        continue;
      }

      if (processAttachments && email.hasAttachments) {
        try {
          console.log(
            `  Fetching attachments for: ${(email.subject || 'No Subject').substring(0, 40)}...`
          );
          const attachmentResults = await processEmailAttachments(email.id);
          if (attachmentResults.extractedText) {
            emailWithAttachmentText = {
              ...email,
              attachmentText: attachmentResults.extractedText,
            };
          }
        } catch (error) {
          const err = error as Error;
          console.error(`  Warning: Error processing attachments: ${err.message}`);
        }
      }

      const result = await this.shouldProcess(emailWithAttachmentText, threshold);

      const emailWithScore: EmailWithScore = {
        ...emailWithAttachmentText,
        filterScore: result.score,
        filterReason: result.reason,
      };

      if (result.shouldProcess) {
        toProcess.push(emailWithScore);
      } else {
        toSkip.push(emailWithScore);
      }
    }

    const requestPrice = parseFloat(process.env.REQUEST_PRICE || '') || 0.015;

    const summary: FilterSummary = {
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
   */
  static async generatePreview(
    emails: Email[],
    threshold = 30,
    options: FilterOptions = {}
  ): Promise<FilterPreview> {
    const { toProcess, toSkip, summary } = await this.filterEmails(emails, threshold, options);

    const preview: FilterPreview = {
      threshold,
      summary,
      toProcess: toProcess.map((email): FilteredEmailPreview => ({
        id: email.id,
        subject: email.subject,
        from: email.from?.emailAddress?.name,
        score: email.filterScore,
        reason: email.filterReason,
        receivedDateTime: email.receivedDateTime,
        hasAttachments: email.hasAttachments,
        attachmentMeta: email.attachmentMeta || null,
      })),
      toSkip: toSkip.map((email): FilteredEmailPreview => ({
        id: email.id,
        subject: email.subject,
        from: email.from?.emailAddress?.name,
        score: email.filterScore,
        reason: email.filterReason,
        receivedDateTime: email.receivedDateTime,
        hasAttachments: email.hasAttachments,
        attachmentMeta: email.attachmentMeta || null,
      })),
    };

    return preview;
  }
}

export default EmailFilter;
export const calculateQuoteScore = EmailFilter.calculateQuoteScore.bind(EmailFilter);
export const checkSpammer = EmailFilter.checkSpammer.bind(EmailFilter);
export const isToBeExcluded = EmailFilter.isToBeExcluded.bind(EmailFilter);
export const filterEmails = EmailFilter.filterEmails.bind(EmailFilter);
export const generatePreview = EmailFilter.generatePreview.bind(EmailFilter);
export const shouldProcess = EmailFilter.shouldProcess.bind(EmailFilter);
