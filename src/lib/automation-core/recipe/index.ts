/**
 * Recipe Module - Command-based browser automation
 * 
 * This module provides a high-level way to automate browser interactions
 * using commands that read like English, with bindings discovered by LLM.
 * 
 * Example:
 * ```typescript
 * import { RecipeRunner, recipeTemplates, createDualModelConfig } from './recipe';
 * 
 * const config = createDualModelConfig(geminiApiKey);
 * const runner = new RecipeRunner({
 *   navigatorLLM: createModel(config.navigator),
 *   extractorLLM: createModel(config.extractor),
 * });
 * 
 * const recipe = recipeTemplates.jobListingExtraction(url, 20);
 * const result = await runner.run(page, recipe);
 * ```
 */

// Commands
export {
  cmd,
  until,
  recipeTemplates,
  type Command,
  type Recipe,
  type UntilCondition,
} from './commands';

// Bindings
export {
  validateBindings,
  loadBindings,
  saveBindings,
  getAllBindings,
  clearAllBindings,
  clearBindingsForUrl,
  exampleBindings,
  type PageBindings,
  type StateCondition,
  type ItemIdExtractor,
} from './bindings';

// Executor
export {
  RecipeExecutor,
  type ExecutionContext,
  type ExecutionResult,
  type ExtractedItem,
  type CommandResult,
  type BindingFixRequest,
} from './executor';

// Navigator
export {
  RecipeNavigator,
  mergeBindings,
  type DOMContext,
  type BindingDiscoveryResult,
  type BindingFixResult,
} from './navigator';

// Runner
export {
  RecipeRunner,
  runRecipe,
  type RunnerConfig,
  type RunnerResult,
  type ExtractedJobData,
  type ProgressCallback,
} from './runner';

