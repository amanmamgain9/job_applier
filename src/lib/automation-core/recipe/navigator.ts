/**
 * Recipe Navigator - Discovers and fixes page bindings using LLM
 * 
 * The Navigator analyzes the DOM and generates bindings that map
 * commands to page-specific selectors. It also fixes broken bindings
 * when commands fail.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { PageBindings, StateCondition, ItemIdExtractor } from './bindings';
import { validateBindings } from './bindings';
import { createLogger } from '../utils/logger';

const logger = createLogger('RecipeNavigator');

// ============================================================================
// Types
// ============================================================================

export interface DOMContext {
  url: string;
  title: string;
  /** Simplified DOM showing interactive elements */
  elements: string;
  /** Sample of visible text content */
  visibleText?: string;
}

export interface BindingDiscoveryResult {
  success: boolean;
  bindings?: PageBindings;
  error?: string;
}

export interface BindingFixResult {
  success: boolean;
  fixes?: Partial<PageBindings>;
  error?: string;
}

// ============================================================================
// Prompts
// ============================================================================

const DISCOVERY_SYSTEM_PROMPT = `You are a web page analyzer that discovers CSS selectors for job listing automation.

Your job: identify selectors for the job list, individual job items, and the job details panel.

RULES:
1. Output ONLY valid JSON, no markdown or explanations
2. Use ONLY selectors that EXIST in the provided DOM
3. Look for data attributes like [data-job-id], [data-occludable-job-id]
4. For class selectors, use exactly what you see: class="jobs-list" → ".jobs-list"
5. NEVER return empty string "" for LIST or LIST_ITEM - these are REQUIRED

CRITICAL - UNDERSTAND THE PAGE LAYOUT:
Most job sites have TWO areas:
1. LEFT: A scrollable LIST of job cards (clickable items that repeat multiple times)
2. RIGHT: A DETAILS PANEL that shows full info when you click a job

IGNORE navigation elements like header links (Home, My Network, Jobs, etc.) - these are NOT the job list!
Focus on the MAIN CONTENT AREA where job cards/listings are displayed.

You MUST identify BOTH areas separately:
- LIST: The parent container holding ALL job cards (usually a <ul> or <div>)
- LIST_ITEM: The individual job cards that REPEAT within the list
- DETAILS_PANEL: The container where full job details appear after clicking
- DETAILS_CONTENT: Selectors for content INSIDE the details panel

DO NOT confuse:
- Navigation header links with the job list
- The list items with the details panel
- A single selected job with the repeating list items`;

const DISCOVERY_USER_TEMPLATE = `Analyze this job search page and find CSS selectors.

URL: {url}
TITLE: {title}

DOM ELEMENTS:
{elements}

TASK: Find selectors for the JOB LISTING area (NOT the navigation header).

Look for these patterns in the main content area:

FOR LINKEDIN (linkedin.com):
- LIST: ".scaffold-layout__list-container" or ".jobs-search-results-list" or "div.jobs-search__left-rail"
- LIST_ITEM: "[data-occludable-job-id]" or ".job-card-container" or ".jobs-search-results__list-item"
- DETAILS_PANEL: ".jobs-details" or ".jobs-search__job-details" or ".jobs-details__main-content"
- DETAILS_CONTENT: [".jobs-unified-top-card__job-title", ".jobs-unified-top-card__company-name", ".jobs-description"]

FOR OTHER JOB SITES:
- LIST: Look for <ul> or <div> with "list", "results", "cards" in class names
- LIST_ITEM: Look for repeating <li> or <div> elements with job-id data attributes
- DETAILS_PANEL: Look for "details", "description", "job-view" in class names

OUTPUT THIS EXACT JSON FORMAT:
{
  "LIST": "REQUIRED - selector for job list container (never empty string)",
  "LIST_ITEM": "REQUIRED - selector for each repeating job card (never empty string)",
  "DETAILS_PANEL": "selector for details panel, or null if inline",
  "DETAILS_CONTENT": ["selector for title", "selector for company", "selector for description"],
  "SCROLL_CONTAINER": "selector if list scrolls separately, else null",
  "NEXT_PAGE_BUTTON": "pagination next button selector, or null",
  "LOAD_MORE_BUTTON": "load more button selector, or null",
  "PAGE_LOADED": { "exists": "selector confirming page loaded (use LIST selector)" },
  "LIST_LOADED": { "exists": "selector confirming list has items (use LIST_ITEM selector)" },
  "DETAILS_LOADED": { "exists": "selector confirming details loaded" },
  "NO_MORE_ITEMS": { "exists": "selector for no results message" },
  "ITEM_ID": { "from": "data", "attribute": "data-occludable-job-id" },
  "CLICK_BEHAVIOR": "shows_panel",
  "ELEMENTS": {
    "applyButton": "apply button selector",
    "saveButton": "save button selector"
  }
}

CRITICAL REQUIREMENTS:
- LIST and LIST_ITEM MUST be non-empty strings with valid CSS selectors
- IGNORE navigation header links (Home, My Network, Jobs menu) - focus on the main job list
- For PAGE_LOADED, use the same selector as LIST (e.g. { "exists": ".jobs-search-results-list" })
- For LIST_LOADED, use the same selector as LIST_ITEM`;

const FIX_SYSTEM_PROMPT = `You are fixing a broken page binding. A command failed because the selector doesn't match.

OUTPUT FORMAT: Valid JSON only with the fixed binding values.

Analyze what exists in the DOM and provide the correct selector.`;

const FIX_USER_TEMPLATE = `A command failed. Fix the binding.

COMMAND: {command}
BINDING: {binding}
CURRENT VALUE: {currentValue}
ERROR: {error}

CURRENT DOM:
{domContext}

What should {binding} be instead? Output JSON with just the fixed values:
{
  "{binding}": "new value or object"
}`;

// ============================================================================
// Navigator
// ============================================================================

export class RecipeNavigator {
  private llm: BaseChatModel;
  
  constructor(llm: BaseChatModel) {
    this.llm = llm;
  }
  
  /**
   * Discover bindings for a page by analyzing its DOM
   */
  async discoverBindings(context: DOMContext): Promise<BindingDiscoveryResult> {
    logger.info(`Discovering bindings for: ${context.url}`);
    logger.info(`DOM context: title="${context.title}", elements length=${context.elements?.length || 0}`);
    
    // Validate context
    if (!context.elements || context.elements.length < 50) {
      logger.error('DOM context is empty or too small - page may not be loaded');
      return { success: false, error: 'DOM context is empty - page may not be fully loaded' };
    }
    
    const prompt = DISCOVERY_USER_TEMPLATE
      .replace('{url}', context.url)
      .replace('{title}', context.title)
      .replace('{elements}', context.elements.slice(0, 30000)); // Limit to avoid token limits
    
    logger.info(`Prompt length: ${prompt.length} chars`);
    
    try {
      logger.info('Calling Navigator LLM...');
      const response = await this.llm.invoke([
        new SystemMessage(DISCOVERY_SYSTEM_PROMPT),
        new HumanMessage(prompt),
      ]);
      
      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);
      
      logger.info(`LLM response length: ${content.length} chars`);
      
      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('No JSON found in LLM response. Response preview:', content.slice(0, 500));
        return { success: false, error: 'No JSON found in LLM response' };
      }
      
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        logger.error('Failed to parse JSON from response:', parseError);
        logger.error('JSON preview:', jsonMatch[0].slice(0, 500));
        return { success: false, error: 'Failed to parse JSON from LLM response' };
      }
      
      let bindings = this.normalizeBindings(parsed, context.url);
      
      // Validate
      const validation = validateBindings(bindings);
      if (!validation.valid) {
        logger.warning('Binding validation errors:', validation.errors);
        logger.warning('Binding validation warnings:', validation.warnings);
        
        // If critical fields are empty, fail with clear error (no fallbacks during development)
        if (!bindings.LIST || !bindings.LIST_ITEM) {
          logger.error('LLM returned empty critical bindings - LIST or LIST_ITEM is empty');
          return { success: false, error: `LLM returned invalid bindings: ${validation.errors.join(', ')}` };
        }
      }
      
      logger.info('Bindings discovered successfully:', bindings.id);
      logger.info('Key bindings: LIST=' + bindings.LIST + ', LIST_ITEM=' + bindings.LIST_ITEM);
      logger.info('DETAILS_PANEL=' + bindings.DETAILS_PANEL + ', CLICK_BEHAVIOR=' + bindings.CLICK_BEHAVIOR);
      return { success: true, bindings };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      logger.error('Binding discovery LLM call failed:', errorMsg);
      logger.error('Stack:', errorStack);
      return { success: false, error: `LLM call failed: ${errorMsg}` };
    }
  }
  
  /**
   * Fix a broken binding based on error context
   */
  async fixBinding(
    command: string,
    binding: string,
    currentValue: unknown,
    error: string,
    domContext: string
  ): Promise<BindingFixResult> {
    logger.info(`Fixing binding: ${binding}`);
    
    const prompt = FIX_USER_TEMPLATE
      .replace('{command}', command)
      .replace('{binding}', binding)
      .replace(/\{binding\}/g, binding)
      .replace('{currentValue}', JSON.stringify(currentValue))
      .replace('{error}', error)
      .replace('{domContext}', domContext.slice(0, 5000));  // Limit context size
    
    try {
      const response = await this.llm.invoke([
        new SystemMessage(FIX_SYSTEM_PROMPT),
        new HumanMessage(prompt),
      ]);
      
      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'No JSON found in response' };
      }
      
      const fixes = JSON.parse(jsonMatch[0]) as Partial<PageBindings>;
      
      logger.info(`Binding fixed: ${binding} -> ${JSON.stringify(fixes)}`);
      return { success: true, fixes };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Binding fix failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }
  
  /**
   * Normalize and fill in defaults for parsed bindings
   */
  private normalizeBindings(parsed: Record<string, unknown>, url: string): PageBindings {
    // Extract domain for URL pattern
    const urlPattern = new URL(url).hostname;
    
    const listItem = parsed.LIST_ITEM as string || '';
    const detailsPanel = parsed.DETAILS_PANEL as string | null | undefined;
    
    // Determine CLICK_BEHAVIOR based on whether DETAILS_PANEL is set
    // If there's a details panel, we need to click to show it
    // If not, details are inline in the list item
    const clickBehavior: PageBindings['CLICK_BEHAVIOR'] = detailsPanel ? 'shows_panel' : 'inline';
    
    // DETAILS_CONTENT: use provided values only - no fallbacks
    // If there's a details panel, these should be selectors WITHIN that panel
    // If inline, these should be selectors within the list item
    let detailsContent = parsed.DETAILS_CONTENT as string[] | undefined;
    if (!detailsContent || detailsContent.length === 0 || detailsContent.every(s => !s)) {
      // No fallback - just use empty array, let it fail if LLM didn't provide proper selectors
      detailsContent = [];
      logger.warning('DETAILS_CONTENT was empty - LLM did not provide content selectors');
    }
    
    // DETAILS_LOADED should wait for the details panel if we have one
    let detailsLoaded = this.normalizeCondition(parsed.DETAILS_LOADED);
    if (!detailsLoaded) {
      logger.warning('DETAILS_LOADED was empty - LLM did not provide a wait condition');
      // Must provide something for type safety, use body as last resort
      detailsLoaded = { exists: 'body' };
    }
    
    return {
      id: (parsed.id as string) || `bindings_${Date.now()}`,
      urlPattern: (parsed.urlPattern as string) || urlPattern,
      version: (parsed.version as number) || 1,
      updatedAt: Date.now(),
      
      SEARCH_BOX: parsed.SEARCH_BOX as string | undefined,
      
      LIST: parsed.LIST as string || '',
      LIST_ITEM: listItem,
      LIST_ITEM_ACTIVE: parsed.LIST_ITEM_ACTIVE as string | undefined,
      
      DETAILS_PANEL: detailsPanel || undefined,
      DETAILS_CONTENT: detailsContent,
      
      FILTERS: parsed.FILTERS as PageBindings['FILTERS'],
      ELEMENTS: parsed.ELEMENTS as Record<string, string> | undefined,
      
      SCROLL_CONTAINER: parsed.SCROLL_CONTAINER as string | undefined,
      LOAD_MORE_BUTTON: parsed.LOAD_MORE_BUTTON as string | undefined,
      NEXT_PAGE_BUTTON: parsed.NEXT_PAGE_BUTTON as string | undefined,
      
      PAGE_LOADED: this.normalizeCondition(parsed.PAGE_LOADED) || { exists: 'body' },
      LIST_LOADED: this.normalizeCondition(parsed.LIST_LOADED) || { exists: listItem },
      LIST_UPDATED: this.normalizeCondition(parsed.LIST_UPDATED) || { countChanged: listItem },
      DETAILS_LOADED: detailsLoaded,
      NO_MORE_ITEMS: this.normalizeCondition(parsed.NO_MORE_ITEMS) || { exists: '.no-results' },
      LIST_EMPTY: parsed.LIST_EMPTY ? this.normalizeCondition(parsed.LIST_EMPTY) : undefined,
      LOADING: parsed.LOADING ? this.normalizeCondition(parsed.LOADING) : undefined,
      
      ITEM_ID: this.normalizeItemId(parsed.ITEM_ID),
      
      CLICK_BEHAVIOR: clickBehavior,
      
      RETURN_TO_LIST: parsed.RETURN_TO_LIST as PageBindings['RETURN_TO_LIST'],
      CLOSE_DETAILS_BUTTON: parsed.CLOSE_DETAILS_BUTTON as string | undefined,
    };
  }
  
  private normalizeCondition(input: unknown): StateCondition | undefined {
    if (!input) return undefined;
    
    if (typeof input === 'string') {
      return { exists: input };
    }
    
    if (typeof input === 'object') {
      return input as StateCondition;
    }
    
    return undefined;
  }
  
  private normalizeItemId(input: unknown): ItemIdExtractor {
    if (!input || typeof input !== 'object') {
      return {
        from: 'href',
        selector: 'a[href]',
        pattern: '/(\\d+)',
      };
    }
    
    const parsed = input as Record<string, unknown>;
    
    return {
      from: (parsed.from as ItemIdExtractor['from']) || 'href',
      selector: parsed.selector as string | undefined,
      attribute: parsed.attribute as string | undefined,
      pattern: parsed.pattern as string | undefined,
    };
  }
  
}

// ============================================================================
// Binding Merger
// ============================================================================

/**
 * Merge new bindings with existing ones, preferring new values
 */
export function mergeBindings(
  existing: PageBindings,
  updates: Partial<PageBindings>
): PageBindings {
  return {
    ...existing,
    ...updates,
    version: existing.version + 1,
    updatedAt: Date.now(),
    // Deep merge for complex objects
    FILTERS: updates.FILTERS 
      ? { ...existing.FILTERS, ...updates.FILTERS }
      : existing.FILTERS,
    DETAILS_CONTENT: updates.DETAILS_CONTENT || existing.DETAILS_CONTENT,
  };
}
