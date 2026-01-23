/**
 * Recipe Commands - High-level navigation commands that read like English
 * 
 * Commands describe WHAT to do, not HOW.
 * Bindings (discovered by Navigator LLM) define the page-specific selectors.
 */

// ============================================================================
// Command Types
// ============================================================================

// Navigation
export interface OpenPageCommand { type: 'OPEN_PAGE'; url: string }
export interface GoBackCommand { type: 'GO_BACK' }

// Waiting
export type WaitTarget = 'page' | 'list' | 'listUpdate' | 'details';
export interface WaitForCommand { type: 'WAIT_FOR'; target: WaitTarget }
export interface WaitCommand { type: 'WAIT'; seconds: number }

// Focus (sets currentElement for subsequent actions)
export interface GoToCommand { type: 'GO_TO'; name: string }  // 'searchBox', 'list', or ELEMENTS key
export interface GoToFilterCommand { type: 'GO_TO_FILTER'; name: string }  // FILTERS map key
export interface GoToItemCommand { type: 'GO_TO_ITEM'; which: 'first' | 'next' | 'unprocessed' }

// Actions (operate on currentElement)
export interface TypeCommand { type: 'TYPE'; text: string }
export interface SubmitCommand { type: 'SUBMIT' }
export interface ClickCommand { type: 'CLICK' }
export interface ClickIfExistsCommand { 
  type: 'CLICK_IF_EXISTS'; 
  name: string;  // Binding name: 'nextPageButton', 'loadMoreButton', or ELEMENTS key
}
export interface SelectCommand { type: 'SELECT'; option: string }
export interface ClearCommand { type: 'CLEAR' }
export interface SetCheckedCommand { type: 'SET_CHECKED'; checked: boolean }

// Scrolling
export type ScrollTarget = 'page' | 'list';
export interface ScrollCommand { 
  type: 'SCROLL'; 
  target: ScrollTarget; 
  direction: 'up' | 'down';
}
export interface ScrollIfNotEndCommand { 
  type: 'SCROLL_IF_NOT_END'; 
  target: ScrollTarget;
}

// Data
export interface ExtractDetailsCommand { 
  type: 'EXTRACT_DETAILS';
  /** CSS selectors to extract content from (optional - falls back to bindings.DETAILS_CONTENT) */
  selectors?: string[];
}
export interface SaveCommand { type: 'SAVE'; as: string }
export interface MarkDoneCommand { type: 'MARK_DONE' }

// Flow Control
export interface ForEachItemInListCommand { 
  type: 'FOR_EACH_ITEM_IN_LIST'; 
  body: Command[];
  skipProcessed?: boolean;
}
export interface IfCommand {
  type: 'IF';
  condition: Condition;
  then: Command[];
  else?: Command[];
}
export interface RepeatCommand { 
  type: 'REPEAT'; 
  body: Command[];
  until: UntilCondition;
}
export interface CheckpointCountCommand { type: 'CHECKPOINT_COUNT' }
export interface EndCommand { type: 'END' }

// All commands (18 total, down from 26)
export type Command =
  // Navigation (2)
  | OpenPageCommand
  | GoBackCommand
  // Waiting (2)
  | WaitForCommand
  | WaitCommand
  // Focus (3)
  | GoToCommand
  | GoToFilterCommand
  | GoToItemCommand
  // Actions (6)
  | TypeCommand
  | SubmitCommand
  | ClickCommand
  | ClickIfExistsCommand
  | SelectCommand
  | ClearCommand
  | SetCheckedCommand
  // Scrolling (2)
  | ScrollCommand
  | ScrollIfNotEndCommand
  // Data (3)
  | ExtractDetailsCommand
  | SaveCommand
  | MarkDoneCommand
  // Flow (5)
  | ForEachItemInListCommand
  | IfCommand
  | RepeatCommand
  | CheckpointCountCommand
  | EndCommand
  ;

// ============================================================================
// Conditions (for IF command)
// ============================================================================

/**
 * Conditions for the IF command.
 * These check runtime state to determine branching.
 */
export type Condition =
  | { type: 'LIST_END' }              // List container can't scroll further
  | { type: 'PAGE_END' }              // Page/window can't scroll further
  | { type: 'NEW_ITEMS' }             // Item count changed since last CHECKPOINT_COUNT
  | { type: 'EXISTS'; name: string }  // Element exists (uses binding name)
  | { type: 'VISIBLE'; name: string } // Element is visible in viewport
  | { type: 'NOT'; condition: Condition }
  | { type: 'AND'; conditions: Condition[] }
  | { type: 'OR'; conditions: Condition[] }
  ;

// ============================================================================
// Until Conditions (for REPEAT command)
// ============================================================================

export type UntilCondition =
  | { type: 'COLLECTED'; count: number }
  | { type: 'NO_MORE_ITEMS' }
  | { type: 'MAX_SCROLLS'; count: number }
  | { type: 'OR'; conditions: UntilCondition[] }
  | { type: 'AND'; conditions: UntilCondition[] }
  ;

// ============================================================================
// Recipe
// ============================================================================

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  
  // The commands to execute
  commands: Command[];
  
  // Default configuration
  config?: {
    maxItems?: number;
    timeout?: number;
  };
}

// ============================================================================
// Command Builders (for easy recipe construction)
// ============================================================================

export const cmd = {
  // Navigation
  openPage: (url: string): OpenPageCommand => ({ type: 'OPEN_PAGE', url }),
  goBack: (): GoBackCommand => ({ type: 'GO_BACK' }),
  
  // Waiting
  waitFor: (target: WaitTarget): WaitForCommand => ({ type: 'WAIT_FOR', target }),
  wait: (seconds: number): WaitCommand => ({ type: 'WAIT', seconds }),
  
  // Focus
  goTo: (name: string): GoToCommand => ({ type: 'GO_TO', name }),
  goToFilter: (name: string): GoToFilterCommand => ({ type: 'GO_TO_FILTER', name }),
  goToItem: (which: 'first' | 'next' | 'unprocessed' = 'next'): GoToItemCommand => 
    ({ type: 'GO_TO_ITEM', which }),
  
  // Actions
  type: (text: string): TypeCommand => ({ type: 'TYPE', text }),
  submit: (): SubmitCommand => ({ type: 'SUBMIT' }),
  click: (): ClickCommand => ({ type: 'CLICK' }),
  clickIfExists: (name: string): ClickIfExistsCommand => ({ type: 'CLICK_IF_EXISTS', name }),
  select: (option: string): SelectCommand => ({ type: 'SELECT', option }),
  clear: (): ClearCommand => ({ type: 'CLEAR' }),
  setChecked: (checked: boolean): SetCheckedCommand => ({ type: 'SET_CHECKED', checked }),
  
  // Scrolling
  scroll: (target: ScrollTarget, direction: 'up' | 'down' = 'down'): ScrollCommand => 
    ({ type: 'SCROLL', target, direction }),
  scrollList: (direction: 'up' | 'down' = 'down'): ScrollCommand => 
    ({ type: 'SCROLL', target: 'list', direction }),
  scrollPage: (direction: 'up' | 'down' = 'down'): ScrollCommand => 
    ({ type: 'SCROLL', target: 'page', direction }),
  scrollIfNotEnd: (target: ScrollTarget): ScrollIfNotEndCommand => 
    ({ type: 'SCROLL_IF_NOT_END', target }),
  scrollListIfNotEnd: (): ScrollIfNotEndCommand => 
    ({ type: 'SCROLL_IF_NOT_END', target: 'list' }),
  scrollPageIfNotEnd: (): ScrollIfNotEndCommand => 
    ({ type: 'SCROLL_IF_NOT_END', target: 'page' }),
  
  // Data
  extractDetails: (): ExtractDetailsCommand => ({ type: 'EXTRACT_DETAILS' }),
  save: (as: string = 'item'): SaveCommand => ({ type: 'SAVE', as }),
  markDone: (): MarkDoneCommand => ({ type: 'MARK_DONE' }),
  
  // Flow
  forEachItemInList: (body: Command[], skipProcessed = true): ForEachItemInListCommand => 
    ({ type: 'FOR_EACH_ITEM_IN_LIST', body, skipProcessed }),
  if: (condition: Condition, then: Command[], elseCmd?: Command[]): IfCommand => 
    ({ type: 'IF', condition, then, else: elseCmd }),
  repeat: (body: Command[], until: UntilCondition): RepeatCommand => 
    ({ type: 'REPEAT', body, until }),
  checkpointCount: (): CheckpointCountCommand => ({ type: 'CHECKPOINT_COUNT' }),
  end: (): EndCommand => ({ type: 'END' }),
};

// Until condition builders (for REPEAT)
export const until = {
  collected: (count: number): UntilCondition => ({ type: 'COLLECTED', count }),
  noMoreItems: (): UntilCondition => ({ type: 'NO_MORE_ITEMS' }),
  maxScrolls: (count: number): UntilCondition => ({ type: 'MAX_SCROLLS', count }),
  or: (...conditions: UntilCondition[]): UntilCondition => ({ type: 'OR', conditions }),
  and: (...conditions: UntilCondition[]): UntilCondition => ({ type: 'AND', conditions }),
};

// Condition builders (for IF)
export const when = {
  listEnd: (): Condition => ({ type: 'LIST_END' }),
  pageEnd: (): Condition => ({ type: 'PAGE_END' }),
  newItems: (): Condition => ({ type: 'NEW_ITEMS' }),
  exists: (name: string): Condition => ({ type: 'EXISTS', name }),
  visible: (name: string): Condition => ({ type: 'VISIBLE', name }),
  not: (condition: Condition): Condition => ({ type: 'NOT', condition }),
  and: (...conditions: Condition[]): Condition => ({ type: 'AND', conditions }),
  or: (...conditions: Condition[]): Condition => ({ type: 'OR', conditions }),
};

// ============================================================================
// Pre-built Recipe Templates
// ============================================================================

export const recipeTemplates = {
  /**
   * Job listing extraction with hybrid scroll + pagination:
   * - Process visible items
   * - Scroll to load more
   * - If scroll doesn't load more, try pagination
   * - Repeat until collected enough or no more items
   */
  jobListingExtraction: (url: string, maxItems: number = 20): Recipe => ({
    id: 'job_listing_extraction',
    name: 'Job Listing Extraction',
    commands: [
      cmd.openPage(url),
      cmd.waitFor('page'),
      cmd.waitFor('list'),
      
      cmd.repeat([
        // Process current items
        cmd.forEachItemInList([
          cmd.click(),  // Click current item (set by FOR_EACH)
          cmd.waitFor('details'),
          cmd.extractDetails(),
          cmd.save('job'),
          cmd.markDone(),
        ]),
        
        // Try to load more items
        cmd.checkpointCount(),
        cmd.scrollPage('down'),
        cmd.wait(1),
        
        // If scroll didn't load more, try pagination
        cmd.if(when.not(when.newItems()), [
          cmd.clickIfExists('nextPageButton'),
          cmd.waitFor('listUpdate'),
        ]),
      ], until.or(
        until.collected(maxItems),
        until.noMoreItems()
      )),
      
      cmd.end(),
    ],
    config: { maxItems },
  }),

  /**
   * Job listing with search
   */
  jobListingWithSearch: (url: string, query: string, maxItems: number = 20): Recipe => ({
    id: 'job_listing_with_search',
    name: 'Job Listing with Search',
    commands: [
      cmd.openPage(url),
      cmd.waitFor('page'),
      
      cmd.goTo('searchBox'),
      cmd.type(query),
      cmd.submit(),
      cmd.waitFor('list'),
      
      cmd.repeat([
        cmd.forEachItemInList([
          cmd.click(),
          cmd.waitFor('details'),
          cmd.extractDetails(),
          cmd.save('job'),
          cmd.markDone(),
        ]),
        
        cmd.checkpointCount(),
        cmd.scrollPage('down'),
        cmd.wait(1),
        
        cmd.if(when.not(when.newItems()), [
          cmd.clickIfExists('nextPageButton'),
          cmd.waitFor('listUpdate'),
        ]),
      ], until.or(
        until.collected(maxItems),
        until.noMoreItems()
      )),
      
      cmd.end(),
    ],
    config: { maxItems },
  }),
};
