/**
 * @packageDocumentation
 *
 * automation-core - Browser automation library for Chrome Extensions
 *
 * Two APIs available:
 * 
 * 1. **Recipe API (Recommended)** - Command-based automation with LLM binding discovery
 *    - High-level commands like OPEN_PAGE, CLICK_ITEM, EXTRACT_DETAILS
 *    - Navigator LLM discovers page-specific selectors
 *    - Extractor LLM parses content (cheap model)
 *    - Much cheaper: ~$0.01-0.02 per run
 * 
 * 2. **Agent API (Legacy)** - Full LLM-driven automation
 *    - LLM decides every action
 *    - More flexible but expensive: ~$1-2 per run
 *
 * @example Recipe API (Recommended)
 * ```typescript
 * import { 
 *   RecipeRunner, 
 *   recipeTemplates, 
 *   BrowserContext,
 *   createDualModelConfig 
 * } from '@/lib/automation-core';
 * 
 * // Setup
 * const config = createDualModelConfig(geminiApiKey);
 * const context = await BrowserContext.fromActiveTab();
 * const page = await context.getCurrentPage();
 * 
 * // Create runner with navigator + extractor models
 * const runner = new RecipeRunner({
 *   navigatorLLM: createChatModel(config.navigator),
 *   extractorLLM: createChatModel(config.extractor),
 *   maxItems: 20,
 * });
 * 
 * // Run a pre-built recipe
 * const recipe = recipeTemplates.jobListingExtraction(url, 20);
 * const result = await runner.run(page, recipe);
 * 
 * console.log(result.items); // Extracted job data
 * ```
 *
 * @example Agent API (Legacy)
 * ```typescript
 * import { AutomationAgent, BrowserContext } from '@/lib/automation-core';
 *
 * const context = await BrowserContext.fromActiveTab();
 * const agent = new AutomationAgent({
 *   context,
 *   llm: {
 *     provider: 'gemini',
 *     apiKey: 'key',
 *     model: 'gemini-1.5-flash'
 *   }
 * });
 *
 * const result = await agent.execute("Extract 20 jobs from this page");
 * ```
 */

// ============================================================================
// Recipe API (Recommended - Cost Optimized)
// ============================================================================

// Recipe Runner - Main entry point for recipe-based automation
export {
  RecipeRunner,
  runRecipe,
  type RunnerConfig,
  type RunnerResult,
  type PhaseOutput,
  type ExtractedJobData,
  type ProgressCallback,
} from './recipe/runner';

// Commands - High-level automation commands
export {
  cmd,
  until,
  recipeTemplates,
  type Command,
  type Recipe,
  type UntilCondition,
} from './recipe/commands';

// Bindings - Page-specific selectors
export {
  validateBindings,
  loadBindings,
  saveBindings,
  clearAllBindings,
  clearBindingsForUrl,
  exampleBindings,
  type PageBindings,
  type StateCondition,
} from './recipe/bindings';

// Navigator - Discovers and fixes bindings
export {
  RecipeNavigator,
  type BindingDiscoveryResult,
  type BindingFixResult,
} from './recipe/navigator';

// Executor - Runs commands
export {
  RecipeExecutor,
  type ExecutionResult as RecipeExecutionResult,
  type CommandResult,
} from './recipe/executor';

// ============================================================================
// Dual Model Configuration (Cost Optimized)
// ============================================================================

export {
  DualModelManager,
  CostTracker,
  createDualModelConfig,
  type DualModelConfig,
  type ModelRole,
  type UsageRecord,
} from './llm/tiered-factory';

// Checkpoint Manager
export {
  HappyStateManager,
  type HappyState,
} from './checkpoint/manager';

// Job Extractor
export {
  JobExtractor,
  extractJobFromContent,
  type JobData,
} from './extraction/job-extractor';

// ============================================================================
// Agent API (Legacy - Full LLM Control)
// ============================================================================

// Main entry point
export { AutomationAgent, type AgentConfig, type EventHandler } from './automation-agent';

// Browser
export { BrowserContext } from './browser/context';
export { Page } from './browser/page';
export {
  type BrowserContextConfig,
  type BrowserState,
  type PageState,
  type TabInfo,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  BrowserError,
  URLNotAllowedError,
} from './browser/types';
export { DOMElementNode, DOMTextNode } from './browser/dom/views';

// Agent
export { Executor, type ExecutorConfig } from './agent/executor';
export { NavigatorAgent } from './agent/navigator';
export { ActionBuilder, Action, type ActionSchema } from './agent/actions';
export { AgentContext } from './agent/types';

// StrategyPlanner Agent (New Architecture)
export {
  StrategyPlanner,
  createBrowserTools,
  createMockTools,
  type PlannerContext,
  type PlannerResult,
  type PlannerTools,
} from './agent/strategy-planner';

// Generators (New Architecture)
export {
  FilterGenerator,
  SortGenerator,
  SearchGenerator,
  RecipeGenerator,
  type GeneratorContext,
  type GeneratorResult,
  type GeneratorFragment,
  type RecipeGeneratorContext,
  type RecipeGeneratorResult,
} from './generators';

// Agent Orchestrator (New Architecture)
export {
  AgentOrchestrator,
  type OrchestratorConfig,
  type OrchestratorContext,
  type OrchestratorResult,
} from './orchestrator';

// LLM
export { createChatModel, validateLLMConfig } from './llm/factory';

// Types
export {
  type LLMConfig,
  type LLMProvider,
  type TaskResult,
  type StepRecord,
  type ExecutionEvent,
  type ExecutionEventType,
  type AgentOptions,
  type AgentOutput,
  ActionResult,
  DEFAULT_AGENT_OPTIONS,
} from './types';

// Utilities
export { createLogger, setDebugEnabled } from './utils/logger';

