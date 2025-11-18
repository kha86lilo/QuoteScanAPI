/**
 * AI Service Factory
 * Factory pattern for creating and configuring AI parser services
 * Allows dynamic selection of AI provider based on configuration
 */

import geminiService from './geminiService.js';
import claudeService from './claudeService.js';
import chatgptService from './chatgptService.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Available AI service providers
 */
export const AI_PROVIDERS = {
  GEMINI: 'gemini',
  CLAUDE: 'claude',
  CHATGPT: 'chatgpt',
  OPENAI: 'openai' // Alias for chatgpt
};

/**
 * Get the configured AI service instance
 * @param {string} provider - Optional provider override (gemini, claude, chatgpt)
 * @returns {BaseAIService} AI service instance
 * @throws {Error} If provider is invalid or not configured
 */
export function getAIService(provider = null) {
  // Use override or fall back to environment variable
  const selectedProvider = (provider || process.env.AI_PROVIDER || AI_PROVIDERS.CHATGPT).toLowerCase();

  switch (selectedProvider) {
    case AI_PROVIDERS.GEMINI:
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY not configured in environment variables');
      }
      return geminiService;

    case AI_PROVIDERS.CLAUDE:
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured in environment variables');
      }
      return claudeService;

    case AI_PROVIDERS.CHATGPT:
    case AI_PROVIDERS.OPENAI:
      if (!process.env.GPT_API_KEY) {
        throw new Error('GPT_API_KEY not configured in environment variables');
      }
      return chatgptService;

    default:
      throw new Error(`Unknown AI provider: ${selectedProvider}. Valid options: gemini, claude, chatgpt`);
  }
}

/**
 * Get list of available (configured) providers
 * @returns {Array<string>} List of provider names that have API keys configured
 */
export function getAvailableProviders() {
  const available = [];

  if (process.env.GEMINI_API_KEY) {
    available.push(AI_PROVIDERS.GEMINI);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    available.push(AI_PROVIDERS.CLAUDE);
  }
  if (process.env.GPT_API_KEY) {
    available.push(AI_PROVIDERS.CHATGPT);
  }

  return available;
}

/**
 * Validate configuration for a specific provider
 * @param {string} provider - Provider name
 * @returns {Promise<Object>} Validation result {valid: boolean, message: string}
 */
export async function validateProvider(provider) {
  try {
    const service = getAIService(provider);
    const isValid = await service.validateApiKey();
    
    return {
      valid: isValid,
      provider: provider,
      message: isValid ? `${provider} API key is valid` : `${provider} API key is invalid`
    };
  } catch (error) {
    return {
      valid: false,
      provider: provider,
      message: error.message
    };
  }
}

/**
 * Validate all configured providers
 * @returns {Promise<Array>} Array of validation results
 */
export async function validateAllProviders() {
  const available = getAvailableProviders();
  const results = [];

  for (const provider of available) {
    const result = await validateProvider(provider);
    results.push(result);
  }

  return results;
}

/**
 * Get current AI provider configuration info
 * @returns {Object} Configuration details
 */
export function getProviderInfo() {
  const currentProvider = process.env.AI_PROVIDER || AI_PROVIDERS.CHATGPT;
  const available = getAvailableProviders();

  return {
    current: currentProvider.toLowerCase(),
    available: available,
    configured: {
      gemini: !!process.env.GEMINI_API_KEY,
      claude: !!process.env.ANTHROPIC_API_KEY,
      chatgpt: !!process.env.GPT_API_KEY
    },
    models: {
      gemini: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20',
      claude: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      chatgpt: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }
  };
}

export default {
  AI_PROVIDERS,
  getAIService,
  getAvailableProviders,
  validateProvider,
  validateAllProviders,
  getProviderInfo
};
