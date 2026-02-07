/**
 * Manager
 * 
 * Top-level coordinator for the Recipe Generation System.
 * Coordinates phases: Discovery → Recipe Generation (future)
 * 
 * Owns ManagerMemory with task, goals, and phase results.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Page } from '../browser/page';
import { ExplorationResult, runDiscovery, DiscoveryContext } from '../agents/discovery';
import { ReportService } from '../reporting';
import { createLogger } from '../utils/logger';

const logger = createLogger('Manager');

// ============================================================================
// Types
// ============================================================================

export interface ManagerMemory {
  task: string;
  goals: string[];
  discoveryResult?: ExplorationResult;
  // recipe?: Recipe;  // Future: Phase 2
  currentPhase: 'discovery' | 'recipe_generation' | 'done';
}

export interface ManagerOptions {
  page: Page;
  llm: BaseChatModel;
  apiKey: string;
  model?: string;
  report?: ReportService;
  maxSteps?: number;
}

export interface ManagerResult {
  success: boolean;
  discoveryResult: ExplorationResult;
  // recipe?: Recipe;  // Future: Phase 2
  error?: string;
}

// ============================================================================
// Manager Class
// ============================================================================

export class Manager {
  private options: ManagerOptions;
  private memory: ManagerMemory | null = null;

  constructor(options: ManagerOptions) {
    this.options = options;
  }

  /**
   * Run the full task automation pipeline.
   * Currently: Discovery only. Future: Discovery → Recipe Generation.
   */
  async run(task: string, goals: string[] = []): Promise<ManagerResult> {
    logger.info('Manager.run started', { task, goals });
    
    // Initialize memory
    this.memory = {
      task,
      goals,
      currentPhase: 'discovery',
    };

    try {
      // Phase 1: Discovery
      logger.info('Starting Phase 1: Discovery');
      this.memory.currentPhase = 'discovery';
      
      const discoveryContext: DiscoveryContext = {
        page: this.options.page,
        goals,
        llm: this.options.llm,
        apiKey: this.options.apiKey,
        model: this.options.model,
        report: this.options.report,
        maxSteps: this.options.maxSteps,
      };

      const discoveryResult = await runDiscovery({
        goal: task,
        context: discoveryContext,
      });

      if (!discoveryResult.goalCompleted) {
        logger.error('Discovery failed', { reason: discoveryResult.reason });
        return {
          success: false,
          discoveryResult: discoveryResult.result || makeEmptyResult(),
          error: discoveryResult.reason || 'Discovery failed',
        };
      }

      this.memory.discoveryResult = discoveryResult.result;
      logger.info('Discovery completed', { 
        pagesExplored: discoveryResult.result?.pageKeys.length,
        success: discoveryResult.result?.success,
      });

      // Phase 2: Recipe Generation (not yet implemented)
      // this.memory.currentPhase = 'recipe_generation';
      // const recipe = await runComposer({ ... });
      // this.memory.recipe = recipe;

      this.memory.currentPhase = 'done';
      
      return {
        success: true,
        discoveryResult: discoveryResult.result!,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Manager.run error', { error: errorMsg });
      
      return {
        success: false,
        discoveryResult: this.memory.discoveryResult || makeEmptyResult(),
        error: errorMsg,
      };
    }
  }

  /**
   * Get current memory state (for debugging/inspection).
   */
  getMemory(): ManagerMemory | null {
    return this.memory;
  }
}

// ============================================================================
// Helper
// ============================================================================

function makeEmptyResult(): ExplorationResult {
  return {
    success: false,
    pageKeys: [],
    events: [],
    finalUnderstanding: '',
    error: 'No exploration performed',
  };
}

// ============================================================================
// Convenience Function (legacy compatibility)
// ============================================================================

/**
 * Run manager as a function (wraps Manager class).
 * For backwards compatibility during refactor.
 */
export async function runManager(
  task: string,
  goals: string[],
  options: ManagerOptions
): Promise<ManagerResult> {
  const manager = new Manager(options);
  return manager.run(task, goals);
}


