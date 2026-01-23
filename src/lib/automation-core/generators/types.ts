/**
 * Generator Types - Shared types for all generators
 */

import type { Command } from '../recipe/commands';

// ============================================================================
// Generator Context
// ============================================================================

export interface GeneratorContext {
  /** DOM snapshot of the page */
  dom: string;
  /** URL of the page */
  url: string;
  /** Page title */
  title: string;
  /** Strategy output from StrategyPlanner (English) */
  strategy: string;
  /** Specific instructions for this generator (extracted from strategy) */
  instructions?: string;
}

// ============================================================================
// Generator Output
// ============================================================================

export interface GeneratorFragment {
  /** Type of fragment */
  type: 'filter' | 'sort' | 'search';
  /** Primary selector for the interaction */
  selector: string;
  /** Additional selectors */
  selectors?: Record<string, string>;
  /** Recipe commands for this interaction */
  commands: Command[];
  /** Any metadata */
  metadata?: Record<string, unknown>;
}

export interface GeneratorResult {
  success: boolean;
  fragment?: GeneratorFragment;
  error?: string;
}

// ============================================================================
// Generator Interface
// ============================================================================

export interface Generator {
  /** Generate a recipe fragment */
  generate(context: GeneratorContext): Promise<GeneratorResult>;
}

