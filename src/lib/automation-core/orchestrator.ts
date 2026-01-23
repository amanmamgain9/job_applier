/**
 * AgentOrchestrator - Runs the full agent flow
 * 
 * Flow:
 * 1. StrategyPlanner: Explore page + plan strategy (English output)
 * 2. Generators: Generate fragments for filter/sort/search (if needed)
 * 3. RecipeGenerator: Combine into final executable recipe
 * 
 * Each phase outputs are captured for debugging/reporting.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Page } from './browser/page';
import type { Recipe } from './recipe/commands';
import type { PageBindings } from './recipe/bindings';
import type { PhaseOutput } from './recipe/runner';
import { StrategyPlanner, createBrowserTools, type PlannerTools } from './agent/strategy-planner';
import { FilterGenerator, SortGenerator, SearchGenerator, RecipeGenerator } from './generators';
import type { GeneratorFragment } from './generators';
import { createLogger } from './utils/logger';

const logger = createLogger('Orchestrator');

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorConfig {
  /** LLM for StrategyPlanner */
  plannerLLM: BaseChatModel;
  /** LLM for Generators (can be same as planner) */
  generatorLLM?: BaseChatModel;
  /** Maximum tool calls for StrategyPlanner */
  maxToolCalls?: number;
  /** Skip exploration and use provided strategy */
  providedStrategy?: string;
}

export interface OrchestratorContext {
  /** The page to automate */
  page: Page;
  /** Task description */
  task: string;
  /** Maximum items to extract */
  maxItems: number;
  /** Optional: specific filter to apply */
  filter?: string;
  /** Optional: specific sort to apply */
  sort?: string;
  /** Optional: search query */
  searchQuery?: string;
}

export interface OrchestratorResult {
  success: boolean;
  recipe?: Recipe;
  bindings?: PageBindings;
  /** Phase outputs for debugging/reporting */
  phaseOutputs: PhaseOutput[];
  /** Combined strategy output (English) */
  strategy?: string;
  /** Generator fragments */
  fragments?: GeneratorFragment[];
  error?: string;
}

// ============================================================================
// AgentOrchestrator
// ============================================================================

export class AgentOrchestrator {
  private config: OrchestratorConfig;
  private planner: StrategyPlanner;
  private filterGen: FilterGenerator;
  private sortGen: SortGenerator;
  private searchGen: SearchGenerator;
  private recipeGen: RecipeGenerator;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    const genLLM = config.generatorLLM || config.plannerLLM;
    
    this.planner = new StrategyPlanner(config.plannerLLM, {
      maxToolCalls: config.maxToolCalls ?? 5,
    });
    this.filterGen = new FilterGenerator(genLLM);
    this.sortGen = new SortGenerator(genLLM);
    this.searchGen = new SearchGenerator(genLLM);
    this.recipeGen = new RecipeGenerator(genLLM);
  }

  /**
   * Run the full agent flow
   */
  async run(context: OrchestratorContext): Promise<OrchestratorResult> {
    const phaseOutputs: PhaseOutput[] = [];
    const fragments: GeneratorFragment[] = [];
    
    logger.info('Starting agent orchestration');
    logger.info(`Task: ${context.task}`);
    logger.info(`Max items: ${context.maxItems}`);

    try {
      // Get page state
      const state = await context.page.getState();
      if (!state?.elementTree) {
        return {
          success: false,
          phaseOutputs,
          error: 'Could not get page state - DOM tree is empty',
        };
      }

      const dom = state.elementTree.clickableElementsToString();
      const url = context.page.url();
      const title = await context.page.title() || 'Unknown';

      logger.info(`Page: ${url}`);
      logger.info(`DOM size: ${dom.length} chars`);

      // ========================================
      // Phase 1: StrategyPlanner
      // ========================================
      let strategy: string;
      
      if (this.config.providedStrategy) {
        // Use provided strategy (skip exploration)
        strategy = this.config.providedStrategy;
        logger.info('Using provided strategy (skipping exploration)');
        
        phaseOutputs.push({
          phase: 'strategy_planner',
          timestamp: Date.now(),
          duration: 0,
          success: true,
          output: strategy,
        });
      } else {
        // Run StrategyPlanner
        const plannerStart = Date.now();
        logger.info('Phase 1: Running StrategyPlanner...');
        
        const tools = this.createPlannerTools(context.page);
        const plannerResult = await this.planner.plan({
          dom,
          url,
          title,
          task: context.task,
        }, tools);

        const plannerDuration = Date.now() - plannerStart;
        strategy = plannerResult.strategy;

        phaseOutputs.push({
          phase: 'strategy_planner',
          timestamp: plannerStart,
          duration: plannerDuration,
          success: plannerResult.errors.length === 0,
          output: strategy,
          toolCalls: plannerResult.toolCalls,
          error: plannerResult.errors.length > 0 ? plannerResult.errors.join('; ') : undefined,
        });

        logger.info(`StrategyPlanner complete (${plannerDuration}ms)`);
        logger.info(`Tool calls: ${plannerResult.toolCalls.length}`);
      }

      // ========================================
      // Phase 2: Generators (if needed)
      // ========================================
      const neededGenerators = this.parseNeededGenerators(strategy);
      logger.info(`Needed generators: ${neededGenerators.join(', ') || 'none'}`);

      // Run FilterGenerator if needed
      if (neededGenerators.includes('filter') || context.filter) {
        const filterStart = Date.now();
        logger.info('Phase 2a: Running FilterGenerator...');
        
        const filterResult = await this.filterGen.generate({
          dom,
          url,
          title,
          strategy,
          instructions: context.filter || 'Apply the filter mentioned in the strategy',
        });

        phaseOutputs.push({
          phase: 'filter_generator',
          timestamp: filterStart,
          duration: Date.now() - filterStart,
          success: filterResult.success,
          output: filterResult.fragment ? JSON.stringify(filterResult.fragment, null, 2) : undefined,
          error: filterResult.error,
        });

        if (filterResult.success && filterResult.fragment) {
          fragments.push(filterResult.fragment);
        }
      }

      // Run SortGenerator if needed
      if (neededGenerators.includes('sort') || context.sort) {
        const sortStart = Date.now();
        logger.info('Phase 2b: Running SortGenerator...');
        
        const sortResult = await this.sortGen.generate({
          dom,
          url,
          title,
          strategy,
          instructions: context.sort || 'Apply the sort mentioned in the strategy',
        });

        phaseOutputs.push({
          phase: 'sort_generator',
          timestamp: sortStart,
          duration: Date.now() - sortStart,
          success: sortResult.success,
          output: sortResult.fragment ? JSON.stringify(sortResult.fragment, null, 2) : undefined,
          error: sortResult.error,
        });

        if (sortResult.success && sortResult.fragment) {
          fragments.push(sortResult.fragment);
        }
      }

      // Run SearchGenerator if needed
      if (neededGenerators.includes('search') || context.searchQuery) {
        const searchStart = Date.now();
        logger.info('Phase 2c: Running SearchGenerator...');
        
        const searchResult = await this.searchGen.generate({
          dom,
          url,
          title,
          strategy,
          instructions: context.searchQuery || 'Generate search commands based on the strategy',
        });

        phaseOutputs.push({
          phase: 'search_generator',
          timestamp: searchStart,
          duration: Date.now() - searchStart,
          success: searchResult.success,
          output: searchResult.fragment ? JSON.stringify(searchResult.fragment, null, 2) : undefined,
          error: searchResult.error,
        });

        if (searchResult.success && searchResult.fragment) {
          fragments.push(searchResult.fragment);
        }
      }

      // ========================================
      // Phase 3: RecipeGenerator
      // ========================================
      const recipeStart = Date.now();
      logger.info('Phase 3: Running RecipeGenerator...');
      
      const recipeResult = await this.recipeGen.generate({
        url,
        title,
        dom,
        strategy,
        fragments,
        task: context.task,
        maxItems: context.maxItems,
      });

      phaseOutputs.push({
        phase: 'recipe_generator',
        timestamp: recipeStart,
        duration: Date.now() - recipeStart,
        success: recipeResult.success,
        output: recipeResult.recipe ? JSON.stringify(recipeResult.recipe, null, 2) : undefined,
        error: recipeResult.error,
      });

      if (!recipeResult.success) {
        return {
          success: false,
          phaseOutputs,
          strategy,
          fragments,
          error: recipeResult.error || 'Recipe generation failed',
        };
      }

      logger.info('Orchestration complete!');
      logger.info(`Recipe: ${recipeResult.recipe?.id} with ${recipeResult.recipe?.commands.length} commands`);

      return {
        success: true,
        recipe: recipeResult.recipe,
        bindings: recipeResult.bindings,
        phaseOutputs,
        strategy,
        fragments,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Orchestration failed:', errorMsg);
      
      return {
        success: false,
        phaseOutputs,
        error: errorMsg,
      };
    }
  }

  /**
   * Parse which generators are needed from the strategy
   * Only include if the strategy says they're NEEDED (not just present on page)
   */
  private parseNeededGenerators(strategy: string): string[] {
    const generators: string[] = [];
    const lowerStrategy = strategy.toLowerCase();

    // Look for explicit "NEEDED GENERATORS:" section
    const neededMatch = lowerStrategy.match(/needed generators?[:\s]+([^\n]+)/i);
    if (neededMatch) {
      const neededSection = neededMatch[1].toLowerCase();
      
      // Check if it says "none" or similar
      if (neededSection.includes('none') || neededSection.includes('n/a') || neededSection.includes('not needed')) {
        return [];
      }
      
      // Only add if explicitly mentioned in the NEEDED section
      if (neededSection.includes('filter')) {
        generators.push('filter');
      }
      if (neededSection.includes('sort')) {
        generators.push('sort');
      }
      if (neededSection.includes('search')) {
        generators.push('search');
      }
    }

    return generators;
  }

  /**
   * Create planner tools that interact with the browser
   */
  private createPlannerTools(page: Page): PlannerTools {
    return createBrowserTools(page);
  }
}

