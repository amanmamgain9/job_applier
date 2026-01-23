/**
 * Recipe Executor - Runs commands using page bindings
 * 
 * The executor translates high-level commands into actual DOM operations
 * using the bindings discovered by the Navigator.
 */

import type { Page } from '../browser/page';
import type { 
  Command, 
  Recipe, 
  UntilCondition,
  Condition,
  WaitTarget,
  ForEachItemInListCommand,
  RepeatCommand,
  IfCommand,
  GoToCommand,
  ScrollCommand,
  ScrollIfNotEndCommand,
  ClickIfExistsCommand,
} from './commands';
import type { PageBindings, StateCondition } from './bindings';
import { DOMElementNode } from '../browser/dom/views';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createLogger } from '../utils/logger';

const logger = createLogger('RecipeExecutor');

// ============================================================================
// Types
// ============================================================================

export interface ExecutionContext {
  /** Items we've already processed (by ID) */
  processedIds: Set<string>;
  /** Collected data */
  collected: ExtractedItem[];
  /** Current focused element */
  currentElement: unknown | null;
  /** Current item in FOR_EACH loop */
  currentItem: { element: unknown; id: string } | null;
  /** Current item index in FOR_EACH loop */
  currentItemIndex: number;
  /** Extracted content from current details view */
  extractedContent: string | null;
  /** Checkpoint count for NEW_ITEMS condition - set by CHECKPOINT_COUNT command */
  checkpointItemCount: number;
  /** Number of scrolls with no new items */
  noNewItemsCount: number;
  /** Should stop execution */
  shouldStop: boolean;
  /** Should continue to next iteration (skip rest of loop body) */
  shouldContinue: boolean;
}

export interface ExtractedItem {
  id: string;
  content: string;
  data?: Record<string, unknown>;
  extractedAt: number;
}

export interface ExecutionResult {
  success: boolean;
  items: ExtractedItem[];
  error?: string;
  stats: {
    commandsExecuted: number;
    itemsProcessed: number;
    scrollsPerformed: number;
    duration: number;
  };
}

export interface CommandResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

export interface BindingFixRequest {
  command: Command;
  binding: string;
  currentValue: unknown;
  error: string;
  domContext: string;
}

// ============================================================================
// Executor
// ============================================================================

export class RecipeExecutor {
  private page: Page;
  private bindings: PageBindings;
  private extractor: BaseChatModel | null;
  private context: ExecutionContext;
  private stats: ExecutionResult['stats'];
  
  // Callback for when bindings need fixing
  private onBindingError?: (request: BindingFixRequest) => Promise<Partial<PageBindings> | null>;
  
  constructor(
    page: Page,
    bindings: PageBindings,
    extractor?: BaseChatModel,
  ) {
    this.page = page;
    this.bindings = bindings;
    this.extractor = extractor || null;
    this.context = this.createContext();
    this.stats = { commandsExecuted: 0, itemsProcessed: 0, scrollsPerformed: 0, duration: 0 };
  }
  
  /**
   * Set callback for binding errors (Navigator will fix them)
   */
  setBindingErrorHandler(handler: (request: BindingFixRequest) => Promise<Partial<PageBindings> | null>) {
    this.onBindingError = handler;
  }
  
  /**
   * Update bindings (after Navigator fixes them)
   */
  updateBindings(updates: Partial<PageBindings>) {
    this.bindings = { ...this.bindings, ...updates };
  }
  
  /**
   * Get current bindings
   */
  getBindings(): PageBindings {
    return this.bindings;
  }
  
  /**
   * Execute a recipe
   */
  async execute(recipe: Recipe): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.context = this.createContext();
    this.stats = { commandsExecuted: 0, itemsProcessed: 0, scrollsPerformed: 0, duration: 0 };
    
    logger.info(`Executing recipe: ${recipe.name}`);
    
    try {
      for (const command of recipe.commands) {
        if (this.context.shouldStop) break;
        
        const result = await this.executeCommand(command);
        
        if (!result.success && result.error) {
          // Try to get Navigator to fix the binding
          const fixed = await this.tryFixBinding(command, result.error);
          if (fixed) {
            // Retry the command
            const retryResult = await this.executeCommand(command);
            if (!retryResult.success) {
              throw new Error(`Command failed after fix: ${retryResult.error}`);
            }
          } else {
            throw new Error(result.error);
          }
        }
      }
      
      this.stats.duration = Date.now() - startTime;
      
      return {
        success: true,
        items: this.context.collected,
        stats: this.stats,
      };
    } catch (error) {
      this.stats.duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      logger.error('Recipe execution failed:', errorMsg);
      
      return {
        success: false,
        items: this.context.collected,
        error: errorMsg,
        stats: this.stats,
      };
    }
  }
  
  /**
   * Execute a single command
   */
  private async executeCommand(command: Command): Promise<CommandResult> {
    this.stats.commandsExecuted++;
    logger.debug(`Executing: ${command.type}`);
    
    try {
      switch (command.type) {
        // Navigation (2)
        case 'OPEN_PAGE':
          await this.page.navigateTo(command.url);
          return { success: true };
          
        case 'GO_BACK':
          await this.page.goBack();
          return { success: true };
        
        // Waiting (2)
        case 'WAIT_FOR':
          return await this.executeWaitFor(command.target);
          
        case 'WAIT':
          await this.wait(command.seconds * 1000);
          return { success: true };
        
        // Focus (3)
        case 'GO_TO':
          return await this.goToElement(command);
          
        case 'GO_TO_FILTER':
          if (!this.bindings.FILTERS?.[command.name]) {
            return { success: false, error: `Filter "${command.name}" not defined in bindings` };
          }
          this.context.currentElement = await this.findElement(
            this.bindings.FILTERS[command.name].selector
          );
          if (!this.context.currentElement) {
            return { success: false, error: `Filter element not found: ${this.bindings.FILTERS[command.name].selector}` };
          }
          return { success: true };
          
        case 'GO_TO_ITEM':
          return await this.goToItem(command.which);
        
        // Actions (6)
        case 'TYPE':
          if (!this.context.currentElement) {
            return { success: false, error: 'No element focused for TYPE' };
          }
          await this.typeIntoElement(this.context.currentElement, command.text);
          return { success: true };
          
        case 'SUBMIT':
          await this.pressKey('Enter');
          return { success: true };
          
        case 'CLICK':
          // In FOR_EACH context, click current item; otherwise click focused element
          if (this.context.currentItem) {
            // If click behavior is "inline", we don't need to actually click
            if (this.bindings.CLICK_BEHAVIOR === 'inline') {
              logger.debug('Inline mode: skipping click, content is in item');
              return { success: true };
            }
            await this.clickElement(this.context.currentItem.element);
            return { success: true };
          }
          if (!this.context.currentElement) {
            return { success: false, error: 'No element focused for CLICK' };
          }
          await this.clickElement(this.context.currentElement);
          return { success: true };
          
        case 'CLICK_IF_EXISTS':
          return await this.executeClickIfExists(command);
          
        case 'SELECT':
          if (!this.context.currentElement) {
            return { success: false, error: 'No element focused for SELECT' };
          }
          await this.selectOption(this.context.currentElement, command.option);
          return { success: true };
          
        case 'CLEAR':
          if (!this.context.currentElement) {
            return { success: false, error: 'No element focused for CLEAR' };
          }
          await this.clearElement(this.context.currentElement);
          return { success: true };
          
        case 'SET_CHECKED':
          if (!this.context.currentElement) {
            return { success: false, error: 'No element focused for SET_CHECKED' };
          }
          await this.setCheckboxState(this.context.currentElement, command.checked);
          return { success: true };
            
        // Scrolling (2)
        case 'SCROLL':
          return await this.executeScroll(command);
          
        case 'SCROLL_IF_NOT_END':
          return await this.executeScrollIfNotEnd(command);
        
        // Data (3)
        case 'EXTRACT_DETAILS':
          return await this.extractDetails(command.selectors);
          
        case 'SAVE':
          return this.saveCurrentItem(command.as);
          
        case 'MARK_DONE':
          if (this.context.currentItem) {
            this.context.processedIds.add(this.context.currentItem.id);
            this.stats.itemsProcessed++;
          }
          return { success: true };
        
        // Flow Control (5)
        case 'FOR_EACH_ITEM_IN_LIST':
          return await this.executeForEach(command);
          
        case 'IF':
          return await this.executeIf(command);
          
        case 'CHECKPOINT_COUNT':
          this.context.checkpointItemCount = await this.getItemCount();
          logger.debug(`Checkpoint: saved item count = ${this.context.checkpointItemCount}`);
          return { success: true };
          
        case 'REPEAT':
          return await this.executeRepeat(command);
          
        case 'END':
          this.context.shouldStop = true;
          return { success: true };
          
        default:
          return { success: false, error: `Unknown command type: ${(command as Command).type}` };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }
  
  // ============================================================================
  // Helper Methods
  // ============================================================================
  
  private createContext(): ExecutionContext {
    return {
      processedIds: new Set(),
      collected: [],
      currentElement: null,
      currentItem: null,
      currentItemIndex: -1,
      extractedContent: null,
      checkpointItemCount: 0,
      noNewItemsCount: 0,
      shouldStop: false,
      shouldContinue: false,
    };
  }
  
  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private async findElement(selector: string): Promise<unknown> {
    // Use page.evaluate to find element
    const exists = await this.evaluateSelector(selector);
    return exists ? selector : null;  // Return selector as handle for now
  }
  
  private async findAllElements(selector: string): Promise<Array<{ selector: string; index: number; text: string; href?: string; dataId?: string }>> {
    // Get actual elements from the page
    const elements = await this.page.querySelectorAll(selector);
    return elements.map((el, i) => ({
      selector,
      index: i,
      text: el.text,
      href: el.href,
      dataId: el.dataId,
    }));
  }
  
  private async countElements(selector: string): Promise<number> {
    // Use actual page DOM evaluation
    return await this.page.countSelector(selector);
  }
  
  private async evaluateSelector(selector: string): Promise<boolean> {
    // Use actual page DOM evaluation
    return await this.page.selectorExists(selector);
  }
  
  private async clickElement(element: unknown): Promise<void> {
    if (typeof element === 'string') {
      // It's a selector - click it directly
      const clicked = await this.page.clickSelector(element);
      if (!clicked) {
        throw new Error(`Could not click selector: ${element}`);
      }
    } else if (element && typeof element === 'object') {
      const itemData = element as { selector?: string; index?: number };
      if (itemData.selector && typeof itemData.index === 'number') {
        // It's an indexed element from querySelectorAll
        // Build a selector for this specific element using :nth-child or similar
        const selector = `${itemData.selector}:nth-of-type(${itemData.index + 1})`;
        const clicked = await this.page.clickSelector(selector);
        if (!clicked) {
          // Fallback: try clicking the nth element with basic selector
          const fallbackClicked = await this.page.clickSelector(itemData.selector);
          if (!fallbackClicked) {
            throw new Error(`Could not click element at index ${itemData.index}`);
          }
        }
      } else if ('index' in itemData && typeof itemData.index === 'number') {
        // It's a DOM element index
        const domElement = this.page.getDomElementByIndex(itemData.index);
        if (domElement) {
          await this.page.clickElementNode(false, domElement);
        }
      }
    }
  }
  
  private async typeIntoElement(element: unknown, text: string): Promise<void> {
    if (typeof element === 'string') {
      const index = await this.getElementIndex(element);
      if (index !== null) {
        const domElement = this.page.getDomElementByIndex(index);
        if (domElement) {
          await this.page.inputTextElementNode(false, domElement, text);
        }
      }
    }
  }
  
  private async pressKey(key: string): Promise<void> {
    await this.page.sendKeys(key);
  }
  
  private async clearElement(_element: unknown): Promise<void> {
    // Select all and delete
    await this.page.sendKeys('Control+a');
    await this.page.sendKeys('Backspace');
  }
  
  private async selectOption(element: unknown, option: string): Promise<void> {
    if (typeof element === 'string') {
      // It's a selector - find the element index and use dropdown selection
      const index = await this.getElementIndex(element);
      if (index !== null) {
        await this.page.selectDropdownOption(index, option);
      } else {
        throw new Error(`Could not find element for selector: ${element}`);
      }
    } else if (element && typeof element === 'object') {
      const itemData = element as { index?: number };
      if (typeof itemData.index === 'number') {
        await this.page.selectDropdownOption(itemData.index, option);
      } else {
        throw new Error('Element does not have a valid index for dropdown selection');
      }
    } else {
      throw new Error('Invalid element for dropdown selection');
    }
  }
  
  private async setCheckboxState(element: unknown, checked: boolean): Promise<void> {
    if (typeof element === 'string') {
      // It's a selector - click it to toggle
      const index = await this.getElementIndex(element);
      if (index !== null) {
        const domElement = this.page.getDomElementByIndex(index);
        if (domElement) {
          // Check current state and click if needed
          const currentState = await this.page.evaluateOnElement(index, (el) => {
            if (el instanceof HTMLInputElement && el.type === 'checkbox') {
              return el.checked;
            }
            return el.getAttribute('aria-checked') === 'true';
          });
          
          if (currentState !== checked) {
            await this.page.clickElementNode(false, domElement);
          }
        }
      }
    } else if (element && typeof element === 'object') {
      const itemData = element as { index?: number };
      if (typeof itemData.index === 'number') {
        const domElement = this.page.getDomElementByIndex(itemData.index);
        if (domElement) {
          const currentState = await this.page.evaluateOnElement(itemData.index, (el) => {
            if (el instanceof HTMLInputElement && el.type === 'checkbox') {
              return el.checked;
            }
            return el.getAttribute('aria-checked') === 'true';
          });
          
          if (currentState !== checked) {
            await this.page.clickElementNode(false, domElement);
          }
        }
      }
    }
  }
  
  /**
   * WAIT_FOR - unified wait command
   */
  private async executeWaitFor(target: WaitTarget): Promise<CommandResult> {
    switch (target) {
      case 'page':
        return await this.waitForCondition(this.bindings.PAGE_LOADED || { exists: 'body' });
        
      case 'list':
        // Fall back to waiting for LIST_ITEM if LIST_LOADED not defined
        return await this.waitForCondition(
          this.bindings.LIST_LOADED || { exists: this.bindings.LIST_ITEM }
        );
        
      case 'listUpdate':
        return await this.waitForCondition(
          this.bindings.LIST_UPDATED || { countChanged: this.bindings.LIST_ITEM }
        );
        
      case 'details':
        // If click behavior is "inline", details are already visible in the item
        if (this.bindings.CLICK_BEHAVIOR === 'inline') {
          await this.wait(100);
          return { success: true };
        }
        // Wait for loading to finish if there's a loading indicator
        if (this.bindings.LOADING) {
          await this.waitForCondition({ gone: this.bindings.LOADING.exists }, 10000);
        }
        // Wait for the details panel to appear
        const result = await this.waitForCondition(
          this.bindings.DETAILS_LOADED || { exists: this.bindings.DETAILS_PANEL || 'body' }
        );
        if (result.success) {
          // Give content inside the panel time to render
          // Many sites show the container first, then lazily load content
          await this.wait(300);
        }
        return result;
        
      default:
        return { success: false, error: `Unknown wait target: ${target}` };
    }
  }
  
  /**
   * GO_TO - unified element focus
   * Handles built-in names: 'searchBox', 'list', 'details'
   * Also handles custom ELEMENTS bindings
   */
  private async goToElement(command: GoToCommand): Promise<CommandResult> {
    let selector: string | undefined;
    
    // Check built-in names first
    switch (command.name) {
      case 'searchBox':
        selector = this.bindings.SEARCH_BOX;
        if (!selector) {
          return { success: false, error: 'SEARCH_BOX binding not defined' };
        }
        break;
        
      case 'list':
        selector = this.bindings.LIST;
        break;
        
      case 'details':
        selector = this.bindings.DETAILS_PANEL;
        if (!selector) {
          return { success: false, error: 'DETAILS_PANEL binding not defined' };
        }
        break;
        
      default:
        // Check ELEMENTS bindings
        selector = this.bindings.ELEMENTS?.[command.name];
        if (!selector) {
          return { success: false, error: `Element "${command.name}" not defined in ELEMENTS bindings` };
        }
    }
    
    this.context.currentElement = await this.findElement(selector);
    if (!this.context.currentElement) {
      return { success: false, error: `Element not found: ${selector}` };
    }
    
    return { success: true };
  }
  
  
  private async getItemCount(): Promise<number> {
    return await this.countElements(this.bindings.LIST_ITEM);
  }
  
  private async getElementIndex(selector: string): Promise<number | null> {
    // Find element index in current page state
    const state = await this.page.getState();
    for (const [index, element] of state.selectorMap.entries()) {
      if (element.toString().includes(selector.replace('.', ''))) {
        return index;
      }
    }
    return null;
  }
  
  private async goToItem(which: 'first' | 'next' | 'current' | 'unprocessed'): Promise<CommandResult> {
    const items = await this.findAllElements(this.bindings.LIST_ITEM);
    
    if (items.length === 0) {
      return { success: false, error: 'No items found in list' };
    }
    
    if (which === 'first') {
      const item = items[0];
      const id = await this.getItemId(item);
      this.context.currentItem = { element: item, id };
      this.context.currentItemIndex = 0;
      return { success: true };
    }
    
    if (which === 'next') {
      const nextIndex = this.context.currentItemIndex + 1;
      if (nextIndex >= items.length) {
        return { success: false, error: 'No more items in list' };
      }
      const item = items[nextIndex];
      const id = await this.getItemId(item);
      this.context.currentItem = { element: item, id };
      this.context.currentItemIndex = nextIndex;
      return { success: true };
    }
    
    if (which === 'current') {
      if (!this.context.currentItem || this.context.currentItemIndex < 0) {
        return { success: false, error: 'No current item - navigate to an item first' };
      }
      // Already on current item, nothing to do
      return { success: true };
    }
    
    if (which === 'unprocessed') {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = await this.getItemId(item);
        if (!this.context.processedIds.has(id)) {
          this.context.currentItem = { element: item, id };
          this.context.currentItemIndex = i;
          return { success: true };
        }
      }
      return { success: false, error: 'No unprocessed items' };
    }
    
    return { success: false, error: `Unknown item selector: ${which}` };
  }
  
  private async getItemId(item: unknown): Promise<string> {
    // Extract ID based on bindings.ITEM_ID configuration
    const extractor = this.bindings.ITEM_ID;
    const itemData = item as { selector?: string; index?: number; text?: string; href?: string; dataId?: string };
    
    // If element has a data-id attribute, use it
    if (itemData.dataId) {
      return itemData.dataId;
    }
    
    if (extractor.from === 'href' && itemData.href) {
      // Extract ID from href using pattern if defined
      if (extractor.pattern) {
        try {
          const regex = new RegExp(extractor.pattern);
          const match = itemData.href.match(regex);
          if (match && match[1]) {
            return match[1];
          }
        } catch {
          // Regex failed, fall through
        }
      }
      // Use URL as ID if no pattern
      return itemData.href;
    }
    
    if (extractor.from === 'data' && extractor.attribute && itemData.dataId) {
      return itemData.dataId;
    }
    
    // Fallback: use index + timestamp to ensure uniqueness
    return `item_${itemData.index ?? Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  private async extractDetails(_commandSelectors?: string[]): Promise<CommandResult> {
    let content = '';
    
    // Simple approach: Just get ALL text from DETAILS_PANEL
    // Let the LLM (in runner) parse the structured data from raw text
    if (this.bindings.DETAILS_PANEL) {
      // Retry logic: content might still be loading
      const maxRetries = 3;
      for (let retry = 0; retry < maxRetries; retry++) {
        const panelText = await this.getTextFromSelector(this.bindings.DETAILS_PANEL);
        if (panelText && panelText.trim()) {
          content = panelText.trim();
          logger.debug(`Extracted ${content.length} chars from DETAILS_PANEL`);
          break;
        }
        
        // No content yet - wait and retry
        if (retry < maxRetries - 1) {
          logger.debug(`No content on attempt ${retry + 1}, waiting before retry...`);
          await this.wait(500);
        }
      }
    }
    
    // Fallback: use current item text (list item text)
    if (!content.trim() && this.context.currentItem) {
      const itemData = this.context.currentItem.element as { text?: string; href?: string };
      if (itemData.text) {
        content = itemData.text;
        logger.debug(`Fallback: extracted from current item: ${content.slice(0, 100)}...`);
      }
    }
    
    if (!content.trim()) {
      logger.warning('No content extracted from details');
      return { success: false, error: 'No content extracted' };
    }
    
    this.context.extractedContent = content.trim();
    logger.debug(`Extracted ${content.length} chars of content`);
    return { success: true, data: { contentLength: content.length } };
  }
  
  private async getTextFromSelector(selector: string): Promise<string> {
    // Use actual page DOM evaluation
    const texts = await this.page.getTextFromSelector(selector);
    return texts.join('\n');
  }
  
  private saveCurrentItem(as: string): CommandResult {
    if (!this.context.currentItem || !this.context.extractedContent) {
      return { success: false, error: 'No current item or content to save' };
    }
    
    const item: ExtractedItem = {
      id: this.context.currentItem.id,
      content: this.context.extractedContent,
      extractedAt: Date.now(),
    };
    
    this.context.collected.push(item);
    logger.debug(`Saved item as "${as}": ${item.id}`);
    
    return { success: true };
  }
  
  private async waitForCondition(condition: StateCondition, timeout = 10000): Promise<CommandResult> {
    const startTime = Date.now();
    
    logger.debug(`Waiting for condition: ${JSON.stringify(condition)}`);
    
    while (Date.now() - startTime < timeout) {
      const met = await this.checkCondition(condition);
      if (met) {
        logger.debug(`Condition met after ${Date.now() - startTime}ms`);
        return { success: true };
      }
      await this.wait(300);
    }
    
    // Log which selector we were waiting for
    const selector = condition.exists || condition.gone || condition.countChanged || 'unknown';
    logger.warning(`Timeout waiting for selector "${selector}" after ${timeout}ms`);
    
    return { 
      success: false, 
      error: `Timeout waiting for condition: ${JSON.stringify(condition)}` 
    };
  }
  
  private async checkCondition(condition: StateCondition): Promise<boolean> {
    if (condition.exists) {
      return await this.evaluateSelector(condition.exists);
    }
    
    if (condition.gone) {
      return !(await this.evaluateSelector(condition.gone));
    }
    
    if (condition.countChanged) {
      const currentCount = await this.countElements(condition.countChanged);
      return currentCount !== this.context.checkpointItemCount;
    }
    
    if (condition.and) {
      for (const c of condition.and) {
        if (!(await this.checkCondition(c))) return false;
      }
      return true;
    }
    
    if (condition.or) {
      for (const c of condition.or) {
        if (await this.checkCondition(c)) return true;
      }
      return false;
    }
    
    return true;
  }
  
  private async checkUntilCondition(condition: UntilCondition): Promise<boolean> {
    switch (condition.type) {
      case 'COLLECTED':
        return this.context.collected.length >= condition.count;
        
      case 'NO_MORE_ITEMS':
        return this.context.noNewItemsCount >= 3;  // No new items after 3 attempts
        
      case 'MAX_SCROLLS':
        return this.stats.scrollsPerformed >= condition.count;
        
      case 'OR':
        for (const c of condition.conditions) {
          if (await this.checkUntilCondition(c)) return true;
        }
        return false;
        
      case 'AND':
        for (const c of condition.conditions) {
          if (!(await this.checkUntilCondition(c))) return false;
        }
        return true;
        
      default:
        return false;
    }
  }
  
  // ============================================================================
  // Flow Control Execution
  // ============================================================================
  
  private async executeForEach(command: ForEachItemInListCommand): Promise<CommandResult> {
    const items = await this.findAllElements(this.bindings.LIST_ITEM);
    
    logger.info(`FOR_EACH_ITEM_IN_LIST: found ${items.length} items`);
    
    if (items.length === 0) {
      logger.warning(`No items found with selector: ${this.bindings.LIST_ITEM}`);
      return { success: true };  // Not a failure, just empty list
    }
    
    // Log first item for debugging
    if (items[0]) {
      logger.debug(`First item: id=${items[0].dataId}, text="${items[0].text?.slice(0, 80)}..."`);
    }
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemId = await this.getItemId(item);
      
      // Skip if already processed and skipProcessed is true
      if (command.skipProcessed && this.context.processedIds.has(itemId)) {
        logger.debug(`Skipping already processed item: ${itemId}`);
        continue;
      }
      
      this.context.currentItem = { element: item, id: itemId };
      this.context.shouldContinue = false;
      
      logger.debug(`Processing item ${i + 1}/${items.length}: ${itemId}`);
      
      for (const cmd of command.body) {
        if (this.context.shouldStop || this.context.shouldContinue) break;
        
        const result = await this.executeCommand(cmd);
        if (!result.success) {
          logger.warning(`Command ${cmd.type} failed for item ${itemId}: ${result.error}`);
          break;  // Skip to next item
        }
      }
      
      // Log progress after each item
      if ((i + 1) % 5 === 0 || i === items.length - 1) {
        logger.info(`Processed ${i + 1}/${items.length} items, collected ${this.context.collected.length}`);
      }
      
      if (this.context.shouldStop) break;
    }
    
    return { success: true };
  }
  
  private async executeRepeat(command: RepeatCommand): Promise<CommandResult> {
    let iteration = 0;
    const maxIterations = 50; // Safety limit
    
    while (!this.context.shouldStop && iteration < maxIterations) {
      iteration++;
      logger.debug(`REPEAT iteration ${iteration}: collected=${this.context.collected.length}, processed=${this.context.processedIds.size}`);
      
      // Execute body
      for (const cmd of command.body) {
        if (this.context.shouldStop) break;
        await this.executeCommand(cmd);
      }
      
      // Check until condition
      const shouldEnd = await this.checkUntilCondition(command.until);
      if (shouldEnd) {
        logger.info(`REPEAT ended: until condition met after ${iteration} iterations, collected=${this.context.collected.length}`);
        break;
      }
      
      // Check for no more items condition
      const noMore = await this.checkCondition(this.bindings.NO_MORE_ITEMS);
      if (noMore) {
        logger.info(`REPEAT ended: no more items after ${iteration} iterations, collected=${this.context.collected.length}`);
        break;
      }
    }
    
    if (iteration >= maxIterations) {
      logger.warning(`REPEAT hit max iterations (${maxIterations}), collected=${this.context.collected.length}`);
    }
    
    return { success: true };
  }
  
  /**
   * Execute IF command - generic conditional
   */
  private async executeIf(command: IfCommand): Promise<CommandResult> {
    const conditionMet = await this.evaluateCondition(command.condition);
    const commands = conditionMet ? command.then : (command.else || []);
    
    for (const cmd of commands) {
      if (this.context.shouldStop) break;
      const result = await this.executeCommand(cmd);
      if (!result.success) {
        return result;
      }
    }
    
    return { success: true };
  }
  
  /**
   * Evaluate a Condition for IF command
   */
  private async evaluateCondition(condition: Condition): Promise<boolean> {
    switch (condition.type) {
      case 'LIST_END':
        return await this.isListAtEnd();
        
      case 'PAGE_END':
        return await this.isPageAtEnd();
        
      case 'NEW_ITEMS': {
        const currentCount = await this.getItemCount();
        return currentCount > this.context.checkpointItemCount;
      }
        
      case 'EXISTS': {
        const selector = this.resolveBindingName(condition.name);
        if (!selector) return false;
        return await this.evaluateSelector(selector);
      }
        
      case 'VISIBLE': {
        const selector = this.resolveBindingName(condition.name);
        if (!selector) return false;
        return await this.isElementVisible(selector);
      }
        
      case 'NOT':
        return !(await this.evaluateCondition(condition.condition));
        
      case 'AND':
        for (const c of condition.conditions) {
          if (!(await this.evaluateCondition(c))) return false;
        }
        return true;
        
      case 'OR':
        for (const c of condition.conditions) {
          if (await this.evaluateCondition(c)) return true;
        }
        return false;
        
      default:
        logger.warning(`Unknown condition type: ${(condition as Condition).type}`);
        return false;
    }
  }
  
  /**
   * Resolve a binding name to a selector
   * Supports built-in names and custom ELEMENTS bindings
   */
  private resolveBindingName(name: string): string | null {
    // Built-in binding names
    switch (name) {
      case 'nextPageButton':
        return this.bindings.NEXT_PAGE_BUTTON || null;
      case 'loadMoreButton':
        return this.bindings.LOAD_MORE_BUTTON || null;
      case 'list':
        return this.bindings.LIST;
      case 'listItem':
        return this.bindings.LIST_ITEM;
      case 'detailsPanel':
        return this.bindings.DETAILS_PANEL || null;
      case 'searchBox':
        return this.bindings.SEARCH_BOX || null;
    }
    
    // Custom ELEMENTS bindings
    if (this.bindings.ELEMENTS?.[name]) {
      return this.bindings.ELEMENTS[name];
    }
    
    return null;
  }
  
  /**
   * Check if list container is scrolled to the end
   */
  private async isListAtEnd(): Promise<boolean> {
    const scrollContainer = this.bindings.SCROLL_CONTAINER;
    if (!scrollContainer) {
      // No specific scroll container, check page scroll
      return await this.isPageAtEnd();
    }
    
    // Check if scroll container is at the bottom by evaluating in page
    const state = await this.page.getState();
    // Use scroll info from state if available
    const scrollHeight = state.scrollHeight || 0;
    const scrollY = state.scrollY || 0;
    const viewportHeight = state.visualViewportHeight || 0;
    
    // Consider at end if we're within 50px of bottom
    return scrollY + viewportHeight >= scrollHeight - 50;
  }
  
  /**
   * Check if page is scrolled to the end
   */
  private async isPageAtEnd(): Promise<boolean> {
    const state = await this.page.getState();
    const scrollHeight = state.scrollHeight || 0;
    const scrollY = state.scrollY || 0;
    const viewportHeight = state.visualViewportHeight || 0;
    
    // Consider at end if we're within 50px of bottom
    return scrollY + viewportHeight >= scrollHeight - 50;
  }
  
  /**
   * Check if an element is visible in the viewport
   * Falls back to checking if element exists since we don't have visibility check
   */
  private async isElementVisible(selector: string): Promise<boolean> {
    // For now, just check if element exists
    // A more sophisticated check would verify it's in viewport
    return await this.evaluateSelector(selector);
  }
  
  /**
   * Execute SCROLL command with explicit target
   */
  private async executeScroll(command: ScrollCommand): Promise<CommandResult> {
    if (command.target === 'list') {
      await this.scrollList(command.direction);
    } else {
      await this.scrollPage(command.direction);
    }
    this.stats.scrollsPerformed++;
    return { success: true };
  }
  
  /**
   * Execute SCROLL_IF_NOT_END command
   */
  private async executeScrollIfNotEnd(command: ScrollIfNotEndCommand): Promise<CommandResult> {
    const atEnd = command.target === 'list' 
      ? await this.isListAtEnd() 
      : await this.isPageAtEnd();
    
    if (!atEnd) {
      if (command.target === 'list') {
        await this.scrollList('down');
      } else {
        await this.scrollPage('down');
      }
      this.stats.scrollsPerformed++;
      return { success: true, data: { scrolled: true } };
    }
    
    return { success: true, data: { scrolled: false } };
  }
  
  /**
   * Scroll the list container
   */
  private async scrollList(direction: 'up' | 'down'): Promise<void> {
    const scrollContainer = this.bindings.SCROLL_CONTAINER;
    if (scrollContainer) {
      // Find the scroll container element and scroll it
      const containerElement = await this.getScrollContainerElement();
      if (containerElement) {
        if (direction === 'down') {
          await this.page.scrollToNextPage(containerElement);
        } else {
          await this.page.scrollToPreviousPage(containerElement);
        }
        return;
      }
    }
    // Fallback to page scroll if no container specified or found
    await this.scrollPage(direction);
  }
  
  /**
   * Get the scroll container element if defined
   */
  private async getScrollContainerElement(): Promise<DOMElementNode | undefined> {
    const scrollContainer = this.bindings.SCROLL_CONTAINER;
    if (!scrollContainer) return undefined;
    
    const state = await this.page.getState();
    // Find element by matching the scroll container selector
    const findElement = (node: DOMElementNode): DOMElementNode | undefined => {
      // Check if this element matches the selector (simplified check)
      const classes = node.attributes.class || '';
      const selectorClass = scrollContainer.replace('.', '').split(' ')[0];
      if (classes.includes(selectorClass)) {
        return node;
      }
      // Search children
      for (const child of node.children) {
        if (child instanceof DOMElementNode) {
          const found = findElement(child);
          if (found) return found;
        }
      }
      return undefined;
    };
    
    return findElement(state.elementTree);
  }
  
  /**
   * Scroll the page
   */
  private async scrollPage(direction: 'up' | 'down'): Promise<void> {
    if (direction === 'down') {
      await this.page.scrollToNextPage();
    } else {
      await this.page.scrollToPreviousPage();
    }
  }
  
  /**
   * Execute CLICK_IF_EXISTS command - safe click that doesn't fail if missing
   */
  private async executeClickIfExists(command: ClickIfExistsCommand): Promise<CommandResult> {
    const selector = this.resolveBindingName(command.name);
    
    if (!selector) {
      logger.debug(`CLICK_IF_EXISTS: binding "${command.name}" not defined, skipping`);
      return { success: true, data: { clicked: false } };
    }
    
    const exists = await this.evaluateSelector(selector);
    if (!exists) {
      logger.debug(`CLICK_IF_EXISTS: element "${command.name}" not found, skipping`);
      return { success: true, data: { clicked: false } };
    }
    
    await this.clickElement(selector);
    logger.debug(`CLICK_IF_EXISTS: clicked "${command.name}"`);
    return { success: true, data: { clicked: true } };
  }
  
  // ============================================================================
  // Binding Error Recovery
  // ============================================================================
  
  private async tryFixBinding(command: Command, error: string): Promise<boolean> {
    if (!this.onBindingError) return false;
    
    // Determine which binding caused the error
    const bindingKey = this.getBindingForCommand(command);
    if (!bindingKey) return false;
    
    // Get DOM context for Navigator
    const domContext = await this.getDOMContext();
    
    const request: BindingFixRequest = {
      command,
      binding: bindingKey,
      currentValue: (this.bindings as unknown as Record<string, unknown>)[bindingKey],
      error,
      domContext,
    };
    
    const fix = await this.onBindingError(request);
    
    if (fix) {
      this.updateBindings(fix);
      return true;
    }
    
    return false;
  }
  
  private getBindingForCommand(command: Command): string | null {
    switch (command.type) {
      case 'WAIT_FOR':
        switch (command.target) {
          case 'list': return 'LIST_LOADED';
          case 'details': return 'DETAILS_LOADED';
          case 'page': return 'PAGE_LOADED';
          case 'listUpdate': return 'LIST_UPDATED';
          default: return null;
        }
      case 'GO_TO':
        switch (command.name) {
          case 'list': return 'LIST';
          case 'details': return 'DETAILS_PANEL';
          case 'searchBox': return 'SEARCH_BOX';
          default: return 'ELEMENTS';
        }
      case 'EXTRACT_DETAILS':
        return 'DETAILS_CONTENT';
      default:
        return null;
    }
  }
  
  private async getDOMContext(): Promise<string> {
    // Get simplified DOM for Navigator context
    const state = await this.page.getState();
    return state.elementTree.clickableElementsToString([]);
  }
}

