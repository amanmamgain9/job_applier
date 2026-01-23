/**
 * Recipe Runner - High-level API for executing recipes
 * 
 * Combines:
 * - Navigator (discovers/fixes bindings)
 * - Executor (runs commands)
 * - Extractor (parses content)
 * - HappyState (saves progress)
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Page } from '../browser/page';
import type { Recipe } from './commands';
import type { PageBindings } from './bindings';
import { loadBindings, saveBindings, validateBindings } from './bindings';
import { RecipeExecutor, type ExecutionResult, type BindingFixRequest } from './executor';
import { RecipeNavigator, mergeBindings, type DOMContext } from './navigator';
import { JobExtractor } from '../extraction/job-extractor';
import { HappyStateManager } from '../checkpoint/manager';
import { createLogger } from '../utils/logger';
import { DOMElementNode, DOMBaseNode } from '../browser/dom/views';

const logger = createLogger('RecipeRunner');

// ============================================================================
// Types
// ============================================================================

export interface RunnerConfig {
  /** LLM for Navigator (discovers bindings, fixes issues) */
  navigatorLLM: BaseChatModel;
  /** LLM for Extractor (parses content - can be cheaper model) */
  extractorLLM: BaseChatModel;
  /** Maximum items to extract */
  maxItems?: number;
  /** Timeout per step in ms */
  stepTimeout?: number;
  /** Save progress every N items */
  saveProgressEvery?: number;
}

/** Output from a phase of the agent flow */
export interface PhaseOutput {
  phase: 'strategy_planner' | 'filter_generator' | 'sort_generator' | 'search_generator' | 'recipe_generator' | 'binding_discovery';
  timestamp: number;
  duration: number;
  success: boolean;
  /** The actual output (English strategy, JSON fragment, or full recipe) */
  output?: string;
  /** Tool calls made during this phase (for StrategyPlanner) */
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
  error?: string;
}

export interface RunnerResult {
  success: boolean;
  items: ExtractedJobData[];
  bindings: PageBindings;
  error?: string;
  stats: {
    duration: number;
    commandsExecuted: number;
    itemsProcessed: number;
    scrollsPerformed: number;
    bindingFixes: number;
  };
  /** Debug logs from runner and navigator */
  logs?: string[];
  /** Phase outputs from the agent flow */
  phaseOutputs?: PhaseOutput[];
}

export interface ExtractedJobData {
  id: string;
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  jobType?: string;
  description?: string;
  url?: string;
  extractedAt: number;
  rawContent?: string;
}

export interface ProgressCallback {
  (progress: {
    step: string;
    itemsCollected: number;
    totalItems: number;
    currentItem?: ExtractedJobData;
  }): void;
}

// ============================================================================
// Recipe Runner
// ============================================================================

export class RecipeRunner {
  private config: RunnerConfig;
  private navigator: RecipeNavigator;
  private extractor: JobExtractor;
  private happyState: HappyStateManager | null = null;
  private bindings: PageBindings | null = null;
  private bindingFixCount = 0;
  private onProgress?: ProgressCallback;
  private runLogs: string[] = [];
  private phaseOutputs: PhaseOutput[] = [];
  
  constructor(config: RunnerConfig) {
    this.config = config;
    this.navigator = new RecipeNavigator(config.navigatorLLM);
    this.extractor = new JobExtractor(config.extractorLLM);
  }
  
  private log(msg: string) {
    const ts = new Date().toISOString().split('T')[1].slice(0, 12);
    this.runLogs.push(`[${ts}] ${msg}`);
    logger.info(msg);
  }
  
  /**
   * Set progress callback
   */
  setProgressCallback(callback: ProgressCallback) {
    this.onProgress = callback;
  }
  
  /**
   * Run a recipe on a page
   */
  async run(page: Page, recipe: Recipe): Promise<RunnerResult> {
    const startTime = Date.now();
    this.bindingFixCount = 0;
    this.runLogs = []; // Reset logs for this run
    this.phaseOutputs = []; // Reset phase outputs for this run
    
    const taskId = `recipe_${recipe.id}_${Date.now()}`;
    this.happyState = new HappyStateManager(taskId);
    
    this.log(`Starting recipe: ${recipe.name} (${recipe.id})`);
    
    // Try with existing bindings first, retry with fresh discovery if it fails
    const maxRetries = 2;
    let lastError: string | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const forceRediscover = attempt > 1; // Force fresh discovery on retry
      
      try {
        const result = await this.executeWithBindings(page, recipe, forceRediscover);
        
        // If we got items or succeeded, we're done
        if (result.success || result.items.length > 0) {
          result.stats.duration = Date.now() - startTime;
          return result;
        }
        
        // If failed with a binding-related error, retry with fresh bindings
        if (result.error && this.isBindingError(result.error)) {
          logger.warning(`Attempt ${attempt} failed with binding error: ${result.error}`);
          lastError = result.error;
          
          if (attempt < maxRetries) {
            logger.info('Retrying with fresh binding discovery...');
            continue;
          }
        }
        
        // Non-binding error or last attempt, return result
        result.stats.duration = Date.now() - startTime;
        return result;
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Attempt ${attempt} threw error:`, errorMsg);
        lastError = errorMsg;
        
        // If binding-related error, retry
        if (this.isBindingError(errorMsg) && attempt < maxRetries) {
          logger.info('Retrying with fresh binding discovery...');
          continue;
        }
        
        // Non-binding error or last attempt
        return this.errorResult(errorMsg, startTime);
      }
    }
    
    return this.errorResult(lastError || 'Max retries exceeded', startTime);
  }
  
  /**
   * Check if error is related to bindings (stale selectors, missing elements)
   */
  private isBindingError(error: string): boolean {
    const bindingErrorPatterns = [
      'timeout',
      'waiting for',
      'not found',
      'no element',
      'selector',
      'cannot find',
      'does not exist',
      'null',
    ];
    const errorLower = error.toLowerCase();
    return bindingErrorPatterns.some(pattern => errorLower.includes(pattern));
  }
  
  /**
   * Execute recipe with bindings (single attempt)
   */
  private async executeWithBindings(
    page: Page, 
    recipe: Recipe, 
    forceRediscover: boolean
  ): Promise<RunnerResult> {
    const startTime = Date.now();
    
    // Step 1: Get or discover bindings
    this.reportProgress('Analyzing page', 0, this.config.maxItems || 20);
    this.bindings = await this.getBindingsForPage(page, forceRediscover);
    
    if (!this.bindings) {
      return this.errorResult('Failed to get page bindings', startTime);
    }
    
    // Step 2: Create executor with bindings
    const executor = new RecipeExecutor(page, this.bindings, this.config.extractorLLM);
    
    // Set up binding error handler for inline fixes
    executor.setBindingErrorHandler(async (request) => {
      return await this.handleBindingError(request);
    });
    
    // Step 3: Execute recipe
    this.reportProgress('Extracting items', 0, this.config.maxItems || 20);
    const result = await executor.execute(recipe);
    
    // Step 4: Parse extracted content with Extractor LLM
    this.reportProgress('Parsing results', result.items.length, this.config.maxItems || 20);
    const parsedItems = await this.parseExtractedItems(result.items, page.url());
    
    // Step 5: Save final bindings (only if successful)
    if (result.success && this.bindings) {
      await saveBindings(this.bindings);
    }
    
    // Step 6: Save final happy state
    if (result.success && this.happyState) {
      await this.happyState.save({
        step: result.stats.commandsExecuted,
        url: page.url(),
        title: await page.title(),
        scrollY: 0,
        extractedData: parsedItems,
        summary: `Extracted ${parsedItems.length} items`,
      });
    }
    
    this.log(`Execution complete: ${parsedItems.length} items extracted`);
    return {
      success: result.success,
      items: parsedItems,
      bindings: this.bindings,
      error: result.error,
      stats: {
        duration: Date.now() - startTime,
        commandsExecuted: result.stats.commandsExecuted,
        itemsProcessed: result.stats.itemsProcessed,
        scrollsPerformed: result.stats.scrollsPerformed,
        bindingFixes: this.bindingFixCount,
      },
      logs: this.runLogs,
      phaseOutputs: this.phaseOutputs,
    };
  }
  
  /**
   * Get bindings for current page
   * 
   * The Navigator LLM analyzes the actual page and discovers current selectors.
   * We only use saved bindings if they were recently discovered and not forcing refresh.
   */
  private async getBindingsForPage(page: Page, forceRediscover = false): Promise<PageBindings | null> {
    const url = page.url();
    logger.info('Getting bindings for URL:', url, forceRediscover ? '(forcing rediscovery)' : '');
    
    // Step 1: Try to load recently saved bindings (unless forcing rediscovery)
    if (!forceRediscover) {
      const existing = await loadBindings(url);
      if (existing) {
        // Only use if saved within last 24 hours (selectors can change)
        const age = Date.now() - existing.updatedAt;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (age < maxAge) {
          const validation = validateBindings(existing);
          if (validation.valid) {
            logger.info('Using recently saved bindings:', existing.id, `(${Math.round(age / 60000)} min old)`);
            return existing;
          }
          logger.warning('Saved bindings invalid, rediscovering. Errors:', validation.errors);
        } else {
          logger.info('Saved bindings too old, rediscovering');
        }
      }
    }
    
    // Step 2: Discover bindings using Navigator LLM
    this.log('Discovering bindings using Navigator LLM...');
    const discoveryStartTime = Date.now();
    
    try {
      const domContext = await this.getDOMContext(page);
      this.log(`DOM context: ${domContext.elements.length} chars`);
      this.log(`DOM preview: ${domContext.elements.slice(0, 300).replace(/\n/g, ' ')}`);
      
      if (domContext.elements.length < 100) {
        this.log('WARNING: DOM context seems small, page may not be fully loaded');
      }
      
      const result = await this.navigator.discoverBindings(domContext);
      
      // Log the result for debugging
      if (result.success && result.bindings) {
        this.log(`Navigator SUCCESS: LIST="${result.bindings.LIST}", LIST_ITEM="${result.bindings.LIST_ITEM}"`);
        this.log(`Full bindings: ${JSON.stringify(result.bindings).slice(0, 500)}`);
        
        // Track phase output for binding discovery
        this.phaseOutputs.push({
          phase: 'binding_discovery',
          timestamp: discoveryStartTime,
          duration: Date.now() - discoveryStartTime,
          success: true,
          output: JSON.stringify(result.bindings, null, 2),
        });
      } else {
        this.log(`Navigator FAILED: ${result.error}`);
        
        // Track failed phase output
        this.phaseOutputs.push({
          phase: 'binding_discovery',
          timestamp: discoveryStartTime,
          duration: Date.now() - discoveryStartTime,
          success: false,
          error: result.error,
        });
        return null;
      }
      
      // Validate discovered bindings
      const validation = validateBindings(result.bindings);
      if (!validation.valid) {
        this.log(`Binding validation errors: ${validation.errors.join(', ')}`);
        // Still try to use them - partial bindings might work
      }
      if (validation.warnings.length > 0) {
        this.log(`Binding warnings: ${validation.warnings.join(', ')}`);
      }
      
      // Don't save yet - only save after successful execution
      this.log(`Bindings ready: ${result.bindings.id}`);
      
      return result.bindings;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`Binding discovery error: ${errorMsg}`);
      
      // Track failed phase output
      this.phaseOutputs.push({
        phase: 'binding_discovery',
        timestamp: discoveryStartTime,
        duration: Date.now() - discoveryStartTime,
        success: false,
        error: errorMsg,
      });
      return null;
    }
  }
  
  /**
   * Handle binding errors by asking Navigator to fix
   */
  private async handleBindingError(request: BindingFixRequest): Promise<Partial<PageBindings> | null> {
    logger.info(`Fixing binding error: ${request.binding}`);
    this.bindingFixCount++;
    
    const result = await this.navigator.fixBinding(
      request.command.type,
      request.binding,
      request.currentValue,
      request.error,
      request.domContext
    );
    
    if (result.success && result.fixes && this.bindings) {
      // Merge fixes into current bindings
      this.bindings = mergeBindings(this.bindings, result.fixes);
      return result.fixes;
    }
    
    return null;
  }
  
  /**
   * Get DOM context for Navigator
   * 
   * Generates a DOM representation that includes class names and structure
   * so the Navigator LLM can discover CSS selectors.
   */
  private async getDOMContext(page: Page): Promise<DOMContext> {
    logger.info('Getting DOM context from page...');
    
    try {
      const state = await page.getState();
      const url = page.url();
      const title = await page.title();
      
      // Generate a detailed DOM representation with class names
      const elements = this.generateDOMWithClasses(state.elementTree);
      
      logger.info(`DOM context: url=${url}, title="${title}", elements=${elements.length} chars`);
      
      if (elements.length < 100) {
        logger.warning('DOM elements string is very short - page may be empty or not loaded');
      }
      
      return { url, title, elements };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get DOM context:', errorMsg);
      throw new Error(`Failed to get DOM context: ${errorMsg}`);
    }
  }
  
  /**
   * Generate DOM representation with class names for Navigator LLM
   */
  private generateDOMWithClasses(elementTree: DOMElementNode): string {
    const lines: string[] = [];
    
    const processNode = (node: DOMBaseNode, depth: number): void => {
      if (!node) return;
      
      // Only process DOMElementNode, not DOMTextNode
      if (!(node instanceof DOMElementNode)) return;
      
      const elem = node as DOMElementNode;
      
      // Only include elements with highlight index (interactive elements)
      if (elem.highlightIndex !== null && elem.highlightIndex !== undefined) {
        const indent = '  '.repeat(Math.min(depth, 4));
        
        // Build attribute string with focus on class, id, href
        const attrParts: string[] = [];
        const attrs = elem.attributes;
        
        // Class is most important for CSS selectors
        if (attrs.class) {
          // Show first 4 classes max
          const classes = attrs.class.split(' ').filter(c => c.length > 0).slice(0, 4);
          attrParts.push(`class="${classes.join(' ')}"`);
        }
        if (attrs.id) {
          attrParts.push(`id="${attrs.id.slice(0, 40)}"`);
        }
        if (attrs.href) {
          // Extract path pattern from href
          const hrefMatch = attrs.href.match(/\/[^?#]*/);
          if (hrefMatch) {
            attrParts.push(`href="${hrefMatch[0].slice(0, 50)}"`);
          }
        }
        if (attrs['data-job-id']) {
          attrParts.push(`data-job-id="${attrs['data-job-id']}"`);
        }
        if (attrs['data-occludable-job-id']) {
          attrParts.push(`data-occludable-job-id="${attrs['data-occludable-job-id']}"`);
        }
        if (attrs['data-entity-urn']) {
          attrParts.push(`data-entity-urn="${attrs['data-entity-urn'].slice(0, 50)}"`);
        }
        if (attrs.role) {
          attrParts.push(`role="${attrs.role}"`);
        }
        
        // Get visible text using the class method
        const text = elem.getAllTextTillNextClickableElement().slice(0, 60).trim().replace(/\n/g, ' ');
        
        const attrStr = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';
        const textStr = text ? `>${text}` : ' />';
        
        lines.push(`${indent}[${elem.highlightIndex}]<${elem.tagName}${attrStr}${textStr}`);
      }
      
      // Process children
      for (const child of elem.children) {
        processNode(child, depth + 1);
      }
    };
    
    processNode(elementTree, 0);
    
    return lines.join('\n');
  }
  
  /**
   * Parse extracted content into structured job data
   */
  private async parseExtractedItems(
    items: Array<{ id: string; content: string; extractedAt: number }>,
    sourceUrl: string
  ): Promise<ExtractedJobData[]> {
    const parsed: ExtractedJobData[] = [];
    
    for (const item of items) {
      try {
        const jobData = await this.extractor.extract(item.content);
        
        if (jobData) {
          parsed.push({
            id: item.id,
            title: jobData.title,
            company: jobData.company,
            location: jobData.location || undefined,
            salary: jobData.salary || undefined,
            jobType: jobData.jobType || undefined,
            description: jobData.description || undefined,
            url: this.buildJobUrl(item.id, sourceUrl),
            extractedAt: item.extractedAt,
            rawContent: item.content.slice(0, 500),
          });
          
          this.reportProgress(
            'Parsing results',
            parsed.length,
            items.length,
            parsed[parsed.length - 1]
          );
        }
      } catch (error) {
        logger.warning(`Failed to parse item ${item.id}:`, error);
      }
    }
    
    return parsed;
  }
  
  /**
   * Build job URL from ID and source
   */
  private buildJobUrl(jobId: string, sourceUrl: string): string {
    // If the ID is already a full URL, return it as-is
    if (jobId.startsWith('http://') || jobId.startsWith('https://')) {
      return jobId;
    }
    
    // If it's just an ID, construct the URL
    if (sourceUrl.includes('linkedin.com')) {
      // Extract numeric job ID if present
      const numericId = jobId.match(/\d+/)?.[0] || jobId;
      return `https://www.linkedin.com/jobs/view/${numericId}`;
    }
    if (sourceUrl.includes('indeed.com')) {
      return `https://www.indeed.com/viewjob?jk=${jobId}`;
    }
    return sourceUrl;
  }
  
  /**
   * Report progress
   */
  private reportProgress(
    step: string,
    itemsCollected: number,
    totalItems: number,
    currentItem?: ExtractedJobData
  ) {
    if (this.onProgress) {
      this.onProgress({ step, itemsCollected, totalItems, currentItem });
    }
  }
  
  /**
   * Create error result
   */
  private errorResult(error: string, startTime: number): RunnerResult {
    this.log(`ERROR: ${error}`);
    return {
      success: false,
      items: [],
      bindings: this.bindings || {} as PageBindings,
      error,
      stats: {
        duration: Date.now() - startTime,
        commandsExecuted: 0,
        itemsProcessed: 0,
        scrollsPerformed: 0,
        bindingFixes: this.bindingFixCount,
      },
      logs: this.runLogs,
    };
  }
  
  /**
   * Get current bindings
   */
  getBindings(): PageBindings | null {
    return this.bindings;
  }
  
  /**
   * Clear saved bindings for a URL pattern
   */
  async clearBindings(urlPattern: string): Promise<void> {
    // Would remove from storage
    logger.info(`Cleared bindings for: ${urlPattern}`);
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick run a recipe with minimal setup
 */
export async function runRecipe(
  page: Page,
  recipe: Recipe,
  navigatorLLM: BaseChatModel,
  extractorLLM: BaseChatModel,
  options?: Partial<RunnerConfig>
): Promise<RunnerResult> {
  const runner = new RecipeRunner({
    navigatorLLM,
    extractorLLM,
    ...options,
  });
  
  return await runner.run(page, recipe);
}

