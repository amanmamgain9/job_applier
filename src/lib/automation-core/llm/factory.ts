/**
 * LLM Factory - Creates chat models for different providers
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMConfig, LLMProvider } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('LLMFactory');

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Configuration for creating a chat model
 */
export interface ChatModelConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

/**
 * Create a chat model based on the provider configuration
 */
export function createChatModel(config: LLMConfig): BaseChatModel {
  const temperature = config.temperature ?? 0.1;
  const maxTokens = DEFAULT_MAX_TOKENS;

  logger.info(`Creating chat model: ${config.provider}/${config.model}`);

  switch (config.provider) {
    case 'openai': {
      const args: {
        model: string;
        apiKey: string;
        configuration?: Record<string, unknown>;
        topP?: number;
        temperature?: number;
        maxTokens?: number;
      } = {
        model: config.model,
        apiKey: config.apiKey,
        temperature,
        maxTokens,
      };

      if (config.baseUrl) {
        args.configuration = { baseURL: config.baseUrl };
      }

      return new ChatOpenAI(args);
    }

    case 'anthropic': {
      const args = {
        model: config.model,
        apiKey: config.apiKey,
        maxTokens,
        temperature,
        clientOptions: {
          timeout: 120000, // 2 minute timeout for complex pages
        },
      };
      return new ChatAnthropic(args);
    }

    case 'gemini': {
      const args = {
        model: config.model,
        apiKey: config.apiKey,
        temperature,
      };
      return new ChatGoogleGenerativeAI(args);
    }

    case 'ollama': {
      const args = {
        model: config.model,
        apiKey: config.apiKey || 'ollama', // Required but ignored by Ollama
        baseUrl: config.baseUrl ?? 'http://localhost:11434',
        temperature,
        maxTokens,
        numCtx: 64000, // Large context for agent work
      };
      return new ChatOllama(args);
    }

    default: {
      // Default to OpenAI-compatible provider
      logger.info(`Using OpenAI-compatible provider for: ${config.provider}`);
      const args: {
        model: string;
        apiKey: string;
        configuration?: Record<string, unknown>;
        temperature?: number;
        maxTokens?: number;
      } = {
        model: config.model,
        apiKey: config.apiKey,
        temperature,
        maxTokens,
      };

      if (config.baseUrl) {
        args.configuration = { baseURL: config.baseUrl };
      }

      return new ChatOpenAI(args);
    }
  }
}

/**
 * Validate LLM configuration
 */
export function validateLLMConfig(config: LLMConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.provider) {
    errors.push('Provider is required');
  }

  if (!config.model) {
    errors.push('Model name is required');
  }

  if (!config.apiKey && config.provider !== 'ollama') {
    errors.push('API key is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

