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

const DISCOVERY_SYSTEM_PROMPT = `You are a web page analyzer that discovers CSS selectors for automation.

CRITICAL: You MUST use ONLY class names and selectors that ACTUALLY APPEAR in the provided DOM.
Do NOT invent or guess selectors. If you don't see a class in the DOM, don't use it.

RULES:
1. Output ONLY valid JSON, no explanations or markdown
2. ONLY use classes that are EXPLICITLY shown in the DOM (e.g., if you see class="ember-view jobs-search-results" use ".jobs-search-results")
3. If the DOM shows class="scaffold-layout__list" use ".scaffold-layout__list" exactly
4. For data attributes, use them: [data-job-id], [data-occludable-job-id]
5. For LIST_ITEM, look for repeating elements - usually <li>, <div>, or <a> with similar classes
6. For LIST, find the parent container of the repeating items
7. If you cannot find a suitable selector, use "body" as a fallback

LOOK FOR THESE PATTERNS IN THE DOM:
- Job cards usually have classes containing: "job", "card", "list-item", "result"
- Job IDs are often in data-job-id or data-occludable-job-id attributes
- Lists are often in <ul>, <ol>, or divs with "list", "results", "container" in class names`;

const DISCOVERY_USER_TEMPLATE = `Analyze this job search page DOM and output CSS selectors.

IMPORTANT: Use ONLY the classes you can see below. Do NOT make up selectors.

URL: {url}
TITLE: {title}

DOM ELEMENTS (format: [index]<tag class="..." id="..." ...>text):
{elements}

TASK: Find CSS selectors from the DOM above for:
1. LIST_ITEM: The repeating job card element (look for <li> or <div> with job data attributes or job-related classes)
2. LIST: Parent container of job cards (usually <ul> or <div> containing LIST_ITEMs)
3. DETAILS_CONTENT: Selectors for the content WITHIN each job card (title, company, location text)

For LinkedIn specifically:
- Job cards usually have data-occludable-job-id attribute
- Job title is often in a <strong> or link inside the card
- Company name follows the title
- The card itself contains all the info we need

OUTPUT VALID JSON:
{
  "id": "discovered_bindings",
  "urlPattern": "linkedin.com/jobs",
  "version": 1,
  "LIST": "ul.scaffold-layout__list-container",
  "LIST_ITEM": "li[data-occludable-job-id]",
  "DETAILS_PANEL": null,
  "DETAILS_CONTENT": ["li[data-occludable-job-id]"],
  "SCROLL_CONTAINER": null,
  "PAGE_LOADED": { "exists": "li[data-occludable-job-id]" },
  "LIST_LOADED": { "exists": "li[data-occludable-job-id]" },
  "LIST_UPDATED": { "countChanged": "li[data-occludable-job-id]" },
  "DETAILS_LOADED": { "exists": "li[data-occludable-job-id]" },
  "NO_MORE_ITEMS": { "exists": ".jobs-search-no-results-banner" },
  "ITEM_ID": {
    "from": "data",
    "attribute": "data-occludable-job-id"
  },
  "SCROLL_BEHAVIOR": "infinite",
  "CLICK_BEHAVIOR": "inline"
}

CRITICAL: 
- DETAILS_CONTENT must NOT be empty - use the LIST_ITEM selector as fallback
- Use "inline" for CLICK_BEHAVIOR when details are IN the list item itself
- Use "shows_panel" when clicking opens a separate panel`;

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
      
      const bindings = this.normalizeBindings(parsed, context.url);
      
      // Validate
      const validation = validateBindings(bindings);
      if (!validation.valid) {
        logger.warning('Binding validation errors:', validation.errors);
        logger.warning('Binding validation warnings:', validation.warnings);
        // Return bindings anyway - let executor try with partial bindings
      }
      
      logger.info('Bindings discovered successfully:', bindings.id);
      logger.info('Key bindings: LIST=' + bindings.LIST + ', LIST_ITEM=' + bindings.LIST_ITEM);
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
    
    // DETAILS_CONTENT: use provided values, or fallback to LIST_ITEM selector
    let detailsContent = parsed.DETAILS_CONTENT as string[] | undefined;
    if (!detailsContent || detailsContent.length === 0 || detailsContent.every(s => !s)) {
      // Fallback: extract content from the list item itself
      detailsContent = listItem ? [listItem] : [];
      logger.info('DETAILS_CONTENT was empty, using LIST_ITEM as fallback:', detailsContent);
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
      
      DETAILS_PANEL: parsed.DETAILS_PANEL as string | undefined,
      DETAILS_CONTENT: detailsContent,
      
      FILTERS: parsed.FILTERS as PageBindings['FILTERS'],
      
      SCROLL_CONTAINER: parsed.SCROLL_CONTAINER as string | undefined,
      LOAD_MORE_BUTTON: parsed.LOAD_MORE_BUTTON as string | undefined,
      NEXT_PAGE_BUTTON: parsed.NEXT_PAGE_BUTTON as string | undefined,
      
      PAGE_LOADED: this.normalizeCondition(parsed.PAGE_LOADED) || { exists: 'body' },
      LIST_LOADED: this.normalizeCondition(parsed.LIST_LOADED) || { exists: listItem },
      LIST_UPDATED: this.normalizeCondition(parsed.LIST_UPDATED) || { countChanged: listItem },
      DETAILS_LOADED: this.normalizeCondition(parsed.DETAILS_LOADED) || { exists: detailsContent[0] || 'body' },
      NO_MORE_ITEMS: this.normalizeCondition(parsed.NO_MORE_ITEMS) || { exists: '.no-results' },
      LIST_EMPTY: parsed.LIST_EMPTY ? this.normalizeCondition(parsed.LIST_EMPTY) : undefined,
      LOADING: parsed.LOADING ? this.normalizeCondition(parsed.LOADING) : undefined,
      
      ITEM_ID: this.normalizeItemId(parsed.ITEM_ID),
      
      SCROLL_BEHAVIOR: (parsed.SCROLL_BEHAVIOR as PageBindings['SCROLL_BEHAVIOR']) || 'infinite',
      CLICK_BEHAVIOR: (parsed.CLICK_BEHAVIOR as PageBindings['CLICK_BEHAVIOR']) || 'inline',  // Default to inline for simpler extraction
      
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

