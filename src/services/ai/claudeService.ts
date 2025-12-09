/**
 * Claude AI Service
 * Handles email parsing using Anthropic's Claude API
 */

import Anthropic from '@anthropic-ai/sdk';
import BaseAIService from './BaseAIService.js';
import type { Email, ParsedEmailData } from '../../types/index.js';
import dotenv from 'dotenv';
dotenv.config();

class ClaudeService extends BaseAIService {
  private client: Anthropic;
  private modelName: string;

  constructor() {
    super('Claude');
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.modelName = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
  }

  /**
   * Parse email with Claude AI to extract shipping quote data
   */
  async parseEmail(email: Email, maxRetries = 3, attachmentText = ''): Promise<ParsedEmailData | null> {
    const emailContent = this.prepareEmailContent(email, attachmentText);
    const prompt = this.getExtractionPrompt(emailContent);

    return await this.withRetry(async () => {
      const message = await this.client.messages.create({
        model: this.modelName,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = message.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }
      const responseText = content.text.trim();
      const parsedData = this.cleanAndParseResponse(responseText);
      const confidence = this.calculateConfidence(parsedData);

      parsedData.ai_confidence_score = confidence;

      console.log(`  Success: Parsed email with ${this.serviceName} (confidence: ${confidence})`);
      return parsedData;
    }, maxRetries);
  }

  /**
   * Legacy method name for backward compatibility
   */
  async parseEmailWithClaude(email: Email, maxRetries = 3, attachmentText = ''): Promise<ParsedEmailData | null> {
    return this.parseEmail(email, maxRetries, attachmentText);
  }

  /**
   * Generate a response from a prompt
   */
  async generateResponse(prompt: string): Promise<string> {
    const message = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }
    return content.text.trim();
  }

  /**
   * Validate Claude API key
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.modelName,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      return true;
    } catch (error) {
      const err = error as Error;
      console.error('Error: Invalid Anthropic API key:', err.message);
      return false;
    }
  }
}

const claudeService = new ClaudeService();
export default claudeService;
export const parseEmailWithClaude = claudeService.parseEmailWithClaude.bind(claudeService);
