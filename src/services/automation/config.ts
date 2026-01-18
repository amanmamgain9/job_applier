/**
 * LLM configuration for automation agent
 * 
 * TODO: Replace with secure storage (chrome.storage.sync) before production
 * For now, reads from environment variables
 */

import type { LLMConfig, LLMProvider } from '@/lib/automation-core';

export function getLLMConfig(): LLMConfig {
  const provider = (import.meta.env.VITE_LLM_PROVIDER as LLMProvider) || 'anthropic';
  const apiKey = import.meta.env.VITE_LLM_API_KEY || import.meta.env.VITE_ANTHROPIC_API_KEY || '';
  const model = import.meta.env.VITE_LLM_MODEL || 'claude-sonnet-4-20250514';
  const baseUrl = import.meta.env.VITE_LLM_BASE_URL;

  console.log('[Config] LLM config check:', { 
    provider, 
    model, 
    hasApiKey: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'none'
  });

  if (!apiKey) {
    console.error('[Config] No API key found in environment variables');
    throw new Error('LLM API key not configured. Set VITE_LLM_API_KEY or VITE_ANTHROPIC_API_KEY in .env');
  }

  return {
    provider,
    apiKey,
    model,
    ...(baseUrl && { baseUrl }),
    temperature: 0.1,
  };
}

export function hasLLMConfig(): boolean {
  try {
    getLLMConfig();
    return true;
  } catch {
    return false;
  }
}

