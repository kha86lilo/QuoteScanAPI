/**
 * AI Service Factory
 * Factory pattern for creating and configuring AI parser services
 */

import geminiService from './geminiService.js';
import claudeService from './claudeService.js';
import chatgptService from './chatgptService.js';
import type BaseAIService from './BaseAIService.js';
import type { AIProviderInfo, AIProviderValidation } from '../../types/index.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Available AI service providers
 */
export const AI_PROVIDERS = {
  GEMINI: 'gemini',
  CLAUDE: 'claude',
  CHATGPT: 'chatgpt',
  OPENAI: 'openai',
} as const;

export type AIProvider = (typeof AI_PROVIDERS)[keyof typeof AI_PROVIDERS];

/**
 * Get the configured AI service instance
 */
export function getAIService(provider: string | null = null): BaseAIService {
  const selectedProvider = (
    provider ||
    process.env.AI_PROVIDER ||
    AI_PROVIDERS.CHATGPT
  ).toLowerCase();

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
      throw new Error(
        `Unknown AI provider: ${selectedProvider}. Valid options: gemini, claude, chatgpt`
      );
  }
}

/**
 * Get list of available (configured) providers
 */
export function getAvailableProviders(): string[] {
  const available: string[] = [];

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
 */
export async function validateProvider(provider: string): Promise<AIProviderValidation> {
  try {
    const service = getAIService(provider);
    const isValid = await service.validateApiKey();

    return {
      valid: isValid,
      provider: provider,
      message: isValid ? `${provider} API key is valid` : `${provider} API key is invalid`,
    };
  } catch (error) {
    const err = error as Error;
    return {
      valid: false,
      provider: provider,
      message: err.message,
    };
  }
}

/**
 * Validate all configured providers
 */
export async function validateAllProviders(): Promise<AIProviderValidation[]> {
  const available = getAvailableProviders();
  const results: AIProviderValidation[] = [];

  for (const provider of available) {
    const result = await validateProvider(provider);
    results.push(result);
  }

  return results;
}

/**
 * Get current AI provider configuration info
 */
export function getProviderInfo(): AIProviderInfo {
  const currentProvider = process.env.AI_PROVIDER || AI_PROVIDERS.CHATGPT;
  const available = getAvailableProviders();

  return {
    current: currentProvider.toLowerCase(),
    available: available,
    configured: {
      gemini: !!process.env.GEMINI_API_KEY,
      claude: !!process.env.ANTHROPIC_API_KEY,
      chatgpt: !!process.env.GPT_API_KEY,
    },
    models: {
      gemini: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20',
      claude: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      chatgpt: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },
  };
}

export default {
  AI_PROVIDERS,
  getAIService,
  getAvailableProviders,
  validateProvider,
  validateAllProviders,
  getProviderInfo,
};
