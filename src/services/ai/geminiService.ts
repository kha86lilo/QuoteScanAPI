/**
 * Gemini AI Service
 * Handles email parsing using Google's Gemini API
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import BaseAIService, { type GenerationOptions } from './BaseAIService.js';
import type { Email, ParsedEmailData } from '../../types/index.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// AI Request Logger
const LOGS_DIR = path.join(process.cwd(), 'logs', 'ai_requests');

function getLogFilePath(): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `ai_requests_${date}.log`);
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

interface AILogEntry {
  timestamp: string;
  model: string;
  task: 'extraction' | 'pricing' | 'validation';
  promptLength: number;
  responseLength: number;
  durationMs: number;
  success: boolean;
  error?: string;
  promptPreview?: string;
  responsePreview?: string;
}

function logAIRequest(entry: AILogEntry): void {
  try {
    ensureLogDir();
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(getLogFilePath(), logLine);
  } catch (err) {
    console.error('Failed to log AI request:', (err as Error).message);
  }
}

interface GeminiModel {
  name?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  baseModel?: string;
}

interface SimplifiedGeminiModel {
  name: string;
  displayName: string;
  description: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  supported: string[];
  baseModel: string | null;
}

interface ModelsCache {
  data: SimplifiedGeminiModel[];
  timestamp: number;
}

class GeminiService extends BaseAIService {
  private client: GoogleGenerativeAI;
  private extractionModelName: string;
  private pricingModelName: string;
  private extractionModel: GenerativeModel;
  private pricingModel: GenerativeModel;
  private _modelsCache?: ModelsCache;

  constructor() {
    super('Gemini');
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.client = new GoogleGenerativeAI(apiKey);

    // Separate models for extraction and pricing tasks
    this.extractionModelName = process.env.GEMINI_MODEL_EXTRACTION || 'gemini-2.5-flash';
    this.pricingModelName = process.env.GEMINI_MODEL_PRICING || 'gemini-2.5-flash';

    this.extractionModel = this.client.getGenerativeModel({ model: this.extractionModelName });
    this.pricingModel = this.client.getGenerativeModel({ model: this.pricingModelName });

    console.log(`  Gemini models: extraction=${this.extractionModelName}, pricing=${this.pricingModelName}`);
  }

  /**
   * Parse email with Gemini AI to extract shipping quote data
   */
  async parseEmail(email: Email, maxRetries = 3, attachmentText = ''): Promise<ParsedEmailData | null> {
    const emailContent = this.prepareEmailContent(email, attachmentText);
    const prompt = this.getExtractionPrompt(emailContent);

    return await this.withRetry(async () => {
      const startTime = Date.now();
      let responseText = '';
      let success = false;
      let errorMsg: string | undefined;

      try {
        const result = await this.extractionModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });

        responseText = (await result.response.text()).trim();
        const parsedData = this.cleanAndParseResponse(responseText);
        const confidence = this.calculateConfidence(parsedData);

        parsedData.ai_confidence_score = confidence;
        success = true;

        console.log(`  Success: Parsed email with ${this.serviceName} (confidence: ${confidence})`);
        return parsedData;
      } catch (err) {
        errorMsg = (err as Error).message;
        throw err;
      } finally {
        logAIRequest({
          timestamp: new Date().toISOString(),
          model: this.extractionModelName,
          task: 'extraction',
          promptLength: prompt.length,
          responseLength: responseText.length,
          durationMs: Date.now() - startTime,
          success,
          error: errorMsg,
          promptPreview: prompt.slice(0, 200),
          responsePreview: responseText.slice(0, 500),
        });
      }
    }, maxRetries);
  }

  /**
   * Legacy method name for backward compatibility
   */
  async parseEmailWithGemini(email: Email, maxRetries = 3, attachmentText = ''): Promise<ParsedEmailData | null> {
    return this.parseEmail(email, maxRetries, attachmentText);
  }

  /**
   * Generate a response from a prompt
   */
  async generateResponse(prompt: string, options: GenerationOptions = {}): Promise<string> {
    const startTime = Date.now();
    let responseText = '';
    let success = false;
    let errorMsg: string | undefined;

    try {
      const generationConfig: Record<string, unknown> = {
        temperature: options.temperature ?? 0.2,
        topP: options.topP ?? 0.9,
        ...(typeof options.topK === 'number' ? { topK: options.topK } : {}),
        ...(typeof options.maxOutputTokens === 'number' ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(typeof options.responseMimeType === 'string' ? { responseMimeType: options.responseMimeType } : {}),
      };

      const result = await this.pricingModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      } as any);

      const primaryText = (await result.response.text()).trim();
      if (primaryText) {
        responseText = primaryText;
        success = true;
        return primaryText;
      }

      // Some SDK responses (notably JSON mime types) may not populate response.text().
      const parts = (result.response as any)?.candidates?.[0]?.content?.parts;
      const fallbackText = Array.isArray(parts)
        ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
        : '';

      if (fallbackText) {
        responseText = fallbackText;
        success = true;
        return fallbackText;
      }

      const candidates = (result.response as any)?.candidates;
      const candidateCount = Array.isArray(candidates) ? candidates.length : 0;
      const finishReason = candidates?.[0]?.finishReason || candidates?.[0]?.finish_reason || null;
      const promptFeedback = (result.response as any)?.promptFeedback || (result.response as any)?.prompt_feedback || null;
      const blockReason = promptFeedback?.blockReason || promptFeedback?.block_reason || null;

      throw new Error(
        `Gemini returned empty response (candidates=${candidateCount}, finishReason=${finishReason ?? 'n/a'}, blockReason=${blockReason ?? 'n/a'})`
      );
    } catch (err) {
      errorMsg = (err as Error).message;
      throw err;
    } finally {
      logAIRequest({
        timestamp: new Date().toISOString(),
        model: this.pricingModelName,
        task: 'pricing',
        promptLength: prompt.length,
        responseLength: responseText.length,
        durationMs: Date.now() - startTime,
        success,
        error: errorMsg,
        promptPreview: prompt.slice(0, 200),
        responsePreview: responseText.slice(0, 500),
      });
    }
  }

  /**
   * Validate Gemini API key
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.extractionModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });
      return true;
    } catch (error) {
      const err = error as Error;
      console.error('Error: Invalid Gemini API key:', err.message || String(error));
      return false;
    }
  }

  /**
   * List available Gemini models from the API
   */
  async listAvailableModels(filterGenerateContent = true): Promise<SimplifiedGeminiModel[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('Error: GEMINI_API_KEY is not set');
      return [];
    }

    const now = Date.now();
    if (
      this._modelsCache &&
      this._modelsCache.timestamp &&
      now - this._modelsCache.timestamp < 5 * 60 * 1000
    ) {
      return filterGenerateContent
        ? this._modelsCache.data.filter((m) => (m.supported || []).includes('generateContent'))
        : this._modelsCache.data;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Error: Failed to list models: ${res.status} ${res.statusText}`);
        return [];
      }
      const json = (await res.json()) as { models?: GeminiModel[] };
      const models: SimplifiedGeminiModel[] = (json.models || []).map((m) => {
        const name = m.name?.startsWith('models/') ? m.name.replace('models/', '') : m.name || '';
        return {
          name,
          displayName: m.displayName || name,
          description: m.description || null,
          inputTokens: m.inputTokenLimit || null,
          outputTokens: m.outputTokenLimit || null,
          supported: m.supportedGenerationMethods || [],
          baseModel: m.baseModel || null,
        };
      });

      this._modelsCache = { data: models, timestamp: now };

      return filterGenerateContent
        ? models.filter((m) => (m.supported || []).includes('generateContent'))
        : models;
    } catch (error) {
      const err = error as Error;
      console.error('Error: Error fetching models:', err.message || String(error));
      return [];
    }
  }
}

const geminiService = new GeminiService();
export default geminiService;
export const parseEmailWithGemini = geminiService.parseEmailWithGemini.bind(geminiService);
export const validateApiKey = geminiService.validateApiKey.bind(geminiService);
export const listAvailableModels = geminiService.listAvailableModels.bind(geminiService);
