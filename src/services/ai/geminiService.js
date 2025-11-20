/**
 * Gemini AI Service
 * Handles email parsing using Google's Gemini API
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import BaseAIService from './BaseAIService.js';
import dotenv from 'dotenv';
dotenv.config();

class GeminiService extends BaseAIService {
  constructor() {
    super('Gemini');
    const apiKey = process.env.GEMINI_API_KEY;
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
    this.model = this.client.getGenerativeModel({ model: this.modelName });
  }

  /**
   * Parse email with Gemini AI to extract shipping quote data
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {number} maxRetries - Number of retry attempts for rate limits
   * @param {string} attachmentText - Optional extracted text from attachments
   * @returns {Promise<Object|null>} Parsed quote data
   */
  async parseEmail(email, maxRetries = 3, attachmentText = '') {
    const emailContent = this.prepareEmailContent(email, attachmentText);
    const prompt = this.getExtractionPrompt(emailContent);

    return await this.withRetry(async () => {
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const responseText = (await result.response.text()).trim();
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
  async parseEmailWithGemini(email, maxRetries = 3, attachmentText = '') {
    return this.parseEmail(email, maxRetries, attachmentText);
  }

  /**
   * Validate Gemini API key
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    try {
      await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });
      return true;
    } catch (error) {
      console.error('✗ Invalid Gemini API key:', error.message || error.toString());
      return false;
    }
  }

  /**
   * List available Gemini models from the API
   * @param {boolean} filterGenerateContent - When true, only include models supporting generateContent
   * @returns {Promise<Array>} Simplified list of models
   */
  async listAvailableModels(filterGenerateContent = true) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('✗ GEMINI_API_KEY is not set');
      return [];
    }

    // Simple in-memory cache to avoid frequent calls
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
        console.error(`✗ Failed to list models: ${res.status} ${res.statusText}`);
        return [];
      }
      const json = await res.json();
      const models = (json.models || []).map((m) => {
        const name = m.name?.startsWith('models/') ? m.name.replace('models/', '') : m.name;
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
      console.error('✗ Error fetching models:', error.message || error.toString());
      return [];
    }
  }
}

const geminiService = new GeminiService();
export default geminiService;
export const { parseEmailWithGemini, validateApiKey, listAvailableModels } = geminiService;
