/**
 * ChatGPT (OpenAI) Service
 * Handles email parsing using OpenAI's Chat Completions API
 */

import OpenAI from 'openai';
import BaseAIService, { type GenerationOptions } from './BaseAIService.js';
import type { Email, ParsedEmailData } from '../../types/index.js';
import dotenv from 'dotenv';
dotenv.config();

interface OpenAIModel {
  id: string;
  owned_by?: string;
  created?: number;
}

interface SimplifiedModel {
  name: string;
  ownedBy: string | null;
  created: number | null;
}

class ChatGPTService extends BaseAIService {
  private client: OpenAI;
  private modelName: string;

  constructor() {
    super('ChatGPT');
    const apiKey = process.env.GPT_API_KEY;
    this.client = new OpenAI({ apiKey });
    this.modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  /**
   * Parse email with ChatGPT to extract shipping quote data
   */
  async parseEmail(email: Email, maxRetries = 3, attachmentText = ''): Promise<ParsedEmailData | null> {
    const emailContent = this.prepareEmailContent(email, attachmentText);
    const prompt = this.getExtractionPrompt(emailContent);

    return await this.withRetry(async () => {
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You extract structured JSON from emails for shipping quotes. Respond with only valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const responseText = (completion.choices?.[0]?.message?.content || '').trim();

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
  async parseEmailWithChatGPT(email: Email, maxRetries = 3, attachmentText = ''): Promise<ParsedEmailData | null> {
    return this.parseEmail(email, maxRetries, attachmentText);
  }

  /**
   * Generate a response from a prompt
   */
  async generateResponse(prompt: string, options: GenerationOptions = {}): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.modelName,
      temperature: options.temperature ?? 0,
      ...(typeof options.maxOutputTokens === 'number' ? { max_tokens: options.maxOutputTokens } : {}),
      ...(options.responseMimeType === 'application/json'
        ? ({ response_format: { type: 'json_object' } } as any)
        : {}),
      messages: [
        {
          role: 'system',
          content: 'You are a shipping pricing analyst. Respond with only valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
    });
    return (completion.choices?.[0]?.message?.content || '').trim();
  }

  /**
   * Validate OpenAI API key
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: 'Hello' }],
      });
      return true;
    } catch (error) {
      const err = error as Error;
      console.error('Error: Invalid OpenAI API key:', err.message || String(error));
      return false;
    }
  }

  /**
   * List available OpenAI models
   */
  async listAvailableModels(): Promise<SimplifiedModel[]> {
    try {
      const res = await this.client.models.list();
      const models = (res.data || []).map((m: OpenAIModel) => ({
        name: m.id,
        ownedBy: m.owned_by || null,
        created: m.created || null,
      }));
      return models;
    } catch (error) {
      const err = error as Error;
      console.error('Error: Error listing OpenAI models:', err.message || String(error));
      return [];
    }
  }
}

const chatgptService = new ChatGPTService();
export default chatgptService;
export const parseEmailWithChatGPT = chatgptService.parseEmailWithChatGPT.bind(chatgptService);
export const validateApiKey = chatgptService.validateApiKey.bind(chatgptService);
export const listAvailableModels = chatgptService.listAvailableModels.bind(chatgptService);
