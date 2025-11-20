/**
 * ChatGPT (OpenAI) Service
 * Handles email parsing using OpenAI's Chat Completions API
 */

import OpenAI from "openai";
import BaseAIService from './BaseAIService.js';
import dotenv from "dotenv";
dotenv.config();

class ChatGPTService extends BaseAIService {
  constructor() {
    super('ChatGPT');
    const apiKey = process.env.GPT_API_KEY;
    this.client = new OpenAI({ apiKey });
    this.modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  /**
   * Parse email with ChatGPT to extract shipping quote data
   * @param {Object} email - Raw email data from Microsoft Graph
   * @param {number} maxRetries - Number of retry attempts for rate limits
   * @param {string} attachmentText - Optional extracted text from attachments
   * @returns {Promise<Object|null>} Parsed quote data
   */
  async parseEmail(email, maxRetries = 3, attachmentText = '') {
    const emailContent = this.prepareEmailContent(email, attachmentText);
    const prompt = this.getExtractionPrompt(emailContent);

    return await this.withRetry(async () => {
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You extract structured JSON from emails for shipping quotes. Respond with only valid JSON.",
          },
          { role: "user", content: prompt },
        ],
      });

      const responseText = (
        completion.choices?.[0]?.message?.content || ""
      ).trim();
      
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
  async parseEmailWithChatGPT(email, maxRetries = 3, attachmentText = '') {
    return this.parseEmail(email, maxRetries, attachmentText);
  }

  /**
   * Validate OpenAI API key
   * @returns {Promise<boolean>}
   */
  async validateApiKey() {
    try {
      await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: "user", content: "Hello" }],
      });
      return true;
    } catch (error) {
      console.error(
        "✗ Invalid OpenAI API key:",
        error.message || error.toString()
      );
      return false;
    }
  }

  /**
   * List available OpenAI models
   * @returns {Promise<Array>} Simplified list of models
   */
  async listAvailableModels() {
    try {
      const res = await this.client.models.list();
      const models = (res.data || []).map((m) => ({
        name: m.id,
        ownedBy: m.owned_by || null,
        created: m.created || null,
      }));
      return models;
    } catch (error) {
      console.error(
        "✗ Error listing OpenAI models:",
        error.message || error.toString()
      );
      return [];
    }
  }
}

const chatgptService = new ChatGPTService();
export default chatgptService;
export const { parseEmailWithChatGPT, validateApiKey, listAvailableModels } =
  chatgptService;
