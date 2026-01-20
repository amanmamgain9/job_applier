/**
 * Dual-Model LLM Factory - Cost optimization with two models
 * 
 * Two models:
 * 1. Navigator - For finding happy path, recovery, generating new paths (Gemini Flash)
 * 2. Extractor - For fetching/parsing details from visible content (Gemini Flash-Lite)
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMConfig } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('DualModelFactory');

// ============================================================================
// Types
// ============================================================================

export type ModelRole = 'navigator' | 'extractor';

export interface DualModelConfig {
  /** Navigator: For finding happy path, recovery, decisions (Gemini Flash) */
  navigator: LLMConfig;
  /** Extractor: For fetching details from visible content (Gemini Flash-Lite) */
  extractor: LLMConfig;
}

export interface CostInfo {
  inputCostPer1M: number;
  outputCostPer1M: number;
}

// ============================================================================
// Cost Constants (per 1M tokens)
// ============================================================================

const COST_MAP: Record<string, CostInfo> = {
  // Gemini models
  'gemini-2.0-flash-lite': { inputCostPer1M: 0.015, outputCostPer1M: 0.06 },
  'gemini-1.5-flash': { inputCostPer1M: 0.075, outputCostPer1M: 0.30 },
  'gemini-1.5-flash-002': { inputCostPer1M: 0.075, outputCostPer1M: 0.30 },
  'gemini-1.5-pro': { inputCostPer1M: 1.25, outputCostPer1M: 5.00 },
  'gemini-2.0-flash': { inputCostPer1M: 0.10, outputCostPer1M: 0.40 },
  
  // Anthropic models
  'claude-sonnet-4-20250514': { inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  'claude-3-5-sonnet-20241022': { inputCostPer1M: 3.00, outputCostPer1M: 15.00 },
  'claude-3-haiku-20240307': { inputCostPer1M: 0.25, outputCostPer1M: 1.25 },
  
  // OpenAI models
  'gpt-4o-mini': { inputCostPer1M: 0.15, outputCostPer1M: 0.60 },
  'gpt-4o': { inputCostPer1M: 2.50, outputCostPer1M: 10.00 },
};

// ============================================================================
// Default Configurations
// ============================================================================

export function createDualModelConfig(geminiApiKey: string): DualModelConfig {
  return {
    navigator: {
      provider: 'gemini',
      apiKey: geminiApiKey,
      // Use gemini-2.0-flash for navigation (good balance of speed and capability)
      model: 'gemini-2.0-flash',
      temperature: 0.1,
    },
    extractor: {
      provider: 'gemini',
      apiKey: geminiApiKey,
      // Use gemini-2.0-flash-lite for extraction (cheapest, good for simple parsing)
      model: 'gemini-2.0-flash-lite',
      temperature: 0.0, // Deterministic for extraction
    },
  };
}

// ============================================================================
// Factory Functions
// ============================================================================

const DEFAULT_MAX_TOKENS = 4096;

function createModel(config: LLMConfig): BaseChatModel {
  const temperature = config.temperature ?? 0.1;
  const maxTokens = DEFAULT_MAX_TOKENS;

  switch (config.provider) {
    case 'openai': {
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

    case 'anthropic': {
      return new ChatAnthropic({
        model: config.model,
        apiKey: config.apiKey,
        maxTokens,
        temperature,
        clientOptions: {
          timeout: 120000,
        },
      });
    }

    case 'gemini': {
      return new ChatGoogleGenerativeAI({
        model: config.model,
        apiKey: config.apiKey,
        temperature,
      });
    }

    case 'ollama': {
      return new ChatOllama({
        model: config.model,
        baseUrl: config.baseUrl ?? 'http://localhost:11434',
        temperature,
        numCtx: 64000,
      });
    }

    default: {
      // Default to OpenAI-compatible
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

// ============================================================================
// Dual Model Manager
// ============================================================================

export class DualModelManager {
  private config: DualModelConfig;
  private navigatorModel: BaseChatModel | null = null;
  private extractorModel: BaseChatModel | null = null;
  private costTracker: CostTracker;

  constructor(config: DualModelConfig) {
    this.config = config;
    this.costTracker = new CostTracker();
  }

  /**
   * Get the navigator model (for finding happy path, recovery, decisions)
   */
  getNavigator(): BaseChatModel {
    if (!this.navigatorModel) {
      logger.info(`Creating navigator model: ${this.config.navigator.provider}/${this.config.navigator.model}`);
      this.navigatorModel = createModel(this.config.navigator);
    }
    return this.navigatorModel;
  }

  /**
   * Get the extractor model (for fetching details from visible content)
   */
  getExtractor(): BaseChatModel {
    if (!this.extractorModel) {
      logger.info(`Creating extractor model: ${this.config.extractor.provider}/${this.config.extractor.model}`);
      this.extractorModel = createModel(this.config.extractor);
    }
    return this.extractorModel;
  }

  /**
   * Get model by role
   */
  getModel(role: ModelRole): BaseChatModel {
    return role === 'navigator' ? this.getNavigator() : this.getExtractor();
  }

  /**
   * Get cost tracker
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * Record token usage for cost tracking
   */
  recordUsage(role: ModelRole, inputTokens: number, outputTokens: number): void {
    const modelConfig = role === 'navigator' ? this.config.navigator : this.config.extractor;
    this.costTracker.recordUsage(modelConfig.model, inputTokens, outputTokens);
  }

  /**
   * Get config for a role
   */
  getConfig(role: ModelRole): LLMConfig {
    return role === 'navigator' ? this.config.navigator : this.config.extractor;
  }
}

// ============================================================================
// Cost Tracker
// ============================================================================

export interface UsageRecord {
  model: string;
  role: ModelRole;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: number;
}

export class CostTracker {
  private usageRecords: UsageRecord[] = [];
  private totalCost: number = 0;

  recordUsage(model: string, inputTokens: number, outputTokens: number, role: ModelRole = 'navigator'): void {
    const costs = COST_MAP[model] || { inputCostPer1M: 1.0, outputCostPer1M: 3.0 };
    const inputCost = (inputTokens / 1_000_000) * costs.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * costs.outputCostPer1M;
    const estimatedCost = inputCost + outputCost;

    this.usageRecords.push({
      model,
      role,
      inputTokens,
      outputTokens,
      estimatedCost,
      timestamp: Date.now(),
    });

    this.totalCost += estimatedCost;

    logger.debug(
      `[${role}] Cost: $${estimatedCost.toFixed(4)} (${inputTokens} in, ${outputTokens} out) - ` +
      `Total: $${this.totalCost.toFixed(4)}`
    );
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getUsageRecords(): UsageRecord[] {
    return [...this.usageRecords];
  }

  getSessionSummary(): {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    callCount: number;
    byRole: Record<ModelRole, { calls: number; cost: number; inputTokens: number; outputTokens: number }>;
    byModel: Record<string, { calls: number; cost: number }>;
  } {
    const byModel: Record<string, { calls: number; cost: number }> = {};
    const byRole: Record<ModelRole, { calls: number; cost: number; inputTokens: number; outputTokens: number }> = {
      navigator: { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0 },
      extractor: { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0 },
    };
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const record of this.usageRecords) {
      // By model
      if (!byModel[record.model]) {
        byModel[record.model] = { calls: 0, cost: 0 };
      }
      byModel[record.model].calls++;
      byModel[record.model].cost += record.estimatedCost;
      
      // By role
      byRole[record.role].calls++;
      byRole[record.role].cost += record.estimatedCost;
      byRole[record.role].inputTokens += record.inputTokens;
      byRole[record.role].outputTokens += record.outputTokens;
      
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;
    }

    return {
      totalCost: this.totalCost,
      totalInputTokens,
      totalOutputTokens,
      callCount: this.usageRecords.length,
      byRole,
      byModel,
    };
  }

  reset(): void {
    this.usageRecords = [];
    this.totalCost = 0;
  }
}

