/**
 * Claude AI Service
 * Handles email parsing using Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import BaseAIService from './BaseAIService.js';
import dotenv from 'dotenv';
dotenv.config();

class ClaudeService extends BaseAIService {
  constructor() {
    super('Claude');
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.modelName = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
  }

  /**
   * Parse email with Claude AI to extract shipping quote data
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {number} maxRetries - Number of retry attempts for rate limits
   * @param {string} attachmentText - Optional extracted text from attachments
   * @returns {Promise<Object|null>} Parsed quote data
   */
  async parseEmail(email, maxRetries = 3, attachmentText = '') {
    const emailContent = this.prepareEmailContent(email, attachmentText);
    const prompt = this.getExtractionPrompt(emailContent);

    return await this.withRetry(async () => {
      const message = await this.client.messages.create({
        model: this.modelName,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText = message.content[0].text.trim();
      const parsedData = this.cleanAndParseResponse(responseText);
      const confidence = this.calculateConfidence(parsedData);

      parsedData.ai_confidence_score = confidence;

      console.log(`  ✓ Parsed email with ${this.serviceName} (confidence: ${confidence})`);
      return parsedData;
    }, maxRetries);
  }

  /**
   * Legacy method name for backward compatibility
   */
  async parseEmailWithClaude(email, maxRetries = 3, attachmentText = '') {
    return this.parseEmail(email, maxRetries, attachmentText);
  }

  /**
   * Validate Claude API key
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    try {
      await this.client.messages.create({
        model: this.modelName,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }],
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
