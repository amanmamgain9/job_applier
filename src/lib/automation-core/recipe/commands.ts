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
export interface RefreshCommand { type: 'REFRESH' }

// Waiting
export interface WaitForPageCommand { type: 'WAIT_FOR_PAGE' }
export interface WaitForListCommand { type: 'WAIT_FOR_LIST' }
export interface WaitForListUpdateCommand { type: 'WAIT_FOR_LIST_UPDATE' }
export interface WaitForDetailsCommand { type: 'WAIT_FOR_DETAILS' }
export interface WaitCommand { type: 'WAIT'; seconds: number }

// Going To (focus on element)
export interface GoToSearchBoxCommand { type: 'GO_TO_SEARCH_BOX' }
export interface GoToFilterCommand { type: 'GO_TO_FILTER'; name: string }
export interface GoToListCommand { type: 'GO_TO_LIST' }
export interface GoToItemCommand { type: 'GO_TO_ITEM'; which: 'first' | 'next' | 'current' | 'unprocessed' }
export interface GoToDetailsCommand { type: 'GO_TO_DETAILS' }

// Actions
export interface TypeCommand { type: 'TYPE'; text: string }
export interface SubmitCommand { type: 'SUBMIT' }
export interface ClickCommand { type: 'CLICK' }
export interface ClickItemCommand { type: 'CLICK_ITEM' }
export interface SelectCommand { type: 'SELECT'; option: string }
export interface ApplyFilterCommand { type: 'APPLY_FILTER' }
export interface ClearCommand { type: 'CLEAR' }
export interface CheckCommand { type: 'CHECK' }
export interface UncheckCommand { type: 'UNCHECK' }

// Scrolling
export interface ScrollDownCommand { type: 'SCROLL_DOWN' }
export interface ScrollUpCommand { type: 'SCROLL_UP' }
export interface ScrollForMoreCommand { type: 'SCROLL_FOR_MORE' }
export interface ScrollToTopCommand { type: 'SCROLL_TO_TOP' }
export interface ScrollToBottomCommand { type: 'SCROLL_TO_BOTTOM' }

// Data
export interface ExtractDetailsCommand { type: 'EXTRACT_DETAILS' }
export interface SaveCommand { type: 'SAVE'; as: string }
export interface MarkDoneCommand { type: 'MARK_DONE' }

// Flow Control
export interface ForEachItemInListCommand { 
  type: 'FOR_EACH_ITEM_IN_LIST'; 
  body: Command[];
  skipProcessed?: boolean;
}
export interface WhenListExhaustedCommand { 
  type: 'WHEN_LIST_EXHAUSTED'; 
  body: Command[] 
}
export interface IfNewItemsCommand { 
  type: 'IF_NEW_ITEMS'; 
  then: Command[]; 
  else?: Command[] 
}
export interface RepeatCommand { 
  type: 'REPEAT'; 
  body: Command[];
  until: UntilCondition;
}
export interface ContinueCommand { type: 'CONTINUE' }
export interface EndCommand { type: 'END' }

// All commands
export type Command =
  // Navigation
  | OpenPageCommand
  | GoBackCommand
  | RefreshCommand
  // Waiting
  | WaitForPageCommand
  | WaitForListCommand
  | WaitForListUpdateCommand
  | WaitForDetailsCommand
  | WaitCommand
  // Going To
  | GoToSearchBoxCommand
  | GoToFilterCommand
  | GoToListCommand
  | GoToItemCommand
  | GoToDetailsCommand
  // Actions
  | TypeCommand
  | SubmitCommand
  | ClickCommand
  | ClickItemCommand
  | SelectCommand
  | ApplyFilterCommand
  | ClearCommand
  | CheckCommand
  | UncheckCommand
  // Scrolling
  | ScrollDownCommand
  | ScrollUpCommand
  | ScrollForMoreCommand
  | ScrollToTopCommand
  | ScrollToBottomCommand
  // Data
  | ExtractDetailsCommand
  | SaveCommand
  | MarkDoneCommand
  // Flow
  | ForEachItemInListCommand
  | WhenListExhaustedCommand
  | IfNewItemsCommand
  | RepeatCommand
  | ContinueCommand
  | EndCommand
  ;

// ============================================================================
// Conditions
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
  refresh: (): RefreshCommand => ({ type: 'REFRESH' }),
  
  // Waiting
  waitForPage: (): WaitForPageCommand => ({ type: 'WAIT_FOR_PAGE' }),
  waitForList: (): WaitForListCommand => ({ type: 'WAIT_FOR_LIST' }),
  waitForListUpdate: (): WaitForListUpdateCommand => ({ type: 'WAIT_FOR_LIST_UPDATE' }),
  waitForDetails: (): WaitForDetailsCommand => ({ type: 'WAIT_FOR_DETAILS' }),
  wait: (seconds: number): WaitCommand => ({ type: 'WAIT', seconds }),
  
  // Going To
  goToSearchBox: (): GoToSearchBoxCommand => ({ type: 'GO_TO_SEARCH_BOX' }),
  goToFilter: (name: string): GoToFilterCommand => ({ type: 'GO_TO_FILTER', name }),
  goToList: (): GoToListCommand => ({ type: 'GO_TO_LIST' }),
  goToItem: (which: 'first' | 'next' | 'current' | 'unprocessed' = 'next'): GoToItemCommand => 
    ({ type: 'GO_TO_ITEM', which }),
  goToDetails: (): GoToDetailsCommand => ({ type: 'GO_TO_DETAILS' }),
  
  // Actions
  type: (text: string): TypeCommand => ({ type: 'TYPE', text }),
  submit: (): SubmitCommand => ({ type: 'SUBMIT' }),
  click: (): ClickCommand => ({ type: 'CLICK' }),
  clickItem: (): ClickItemCommand => ({ type: 'CLICK_ITEM' }),
  select: (option: string): SelectCommand => ({ type: 'SELECT', option }),
  applyFilter: (): ApplyFilterCommand => ({ type: 'APPLY_FILTER' }),
  clear: (): ClearCommand => ({ type: 'CLEAR' }),
  check: (): CheckCommand => ({ type: 'CHECK' }),
  uncheck: (): UncheckCommand => ({ type: 'UNCHECK' }),
  
  // Scrolling
  scrollDown: (): ScrollDownCommand => ({ type: 'SCROLL_DOWN' }),
  scrollUp: (): ScrollUpCommand => ({ type: 'SCROLL_UP' }),
  scrollForMore: (): ScrollForMoreCommand => ({ type: 'SCROLL_FOR_MORE' }),
  scrollToTop: (): ScrollToTopCommand => ({ type: 'SCROLL_TO_TOP' }),
  scrollToBottom: (): ScrollToBottomCommand => ({ type: 'SCROLL_TO_BOTTOM' }),
  
  // Data
  extractDetails: (): ExtractDetailsCommand => ({ type: 'EXTRACT_DETAILS' }),
  save: (as: string = 'item'): SaveCommand => ({ type: 'SAVE', as }),
  markDone: (): MarkDoneCommand => ({ type: 'MARK_DONE' }),
  
  // Flow
  forEachItemInList: (body: Command[], skipProcessed = true): ForEachItemInListCommand => 
    ({ type: 'FOR_EACH_ITEM_IN_LIST', body, skipProcessed }),
  whenListExhausted: (body: Command[]): WhenListExhaustedCommand => 
    ({ type: 'WHEN_LIST_EXHAUSTED', body }),
  ifNewItems: (then: Command[], elseCmd?: Command[]): IfNewItemsCommand => 
    ({ type: 'IF_NEW_ITEMS', then, else: elseCmd }),
  repeat: (body: Command[], until: UntilCondition): RepeatCommand => 
    ({ type: 'REPEAT', body, until }),
  continue: (): ContinueCommand => ({ type: 'CONTINUE' }),
  end: (): EndCommand => ({ type: 'END' }),
};

// Until condition builders
export const until = {
  collected: (count: number): UntilCondition => ({ type: 'COLLECTED', count }),
  noMoreItems: (): UntilCondition => ({ type: 'NO_MORE_ITEMS' }),
  maxScrolls: (count: number): UntilCondition => ({ type: 'MAX_SCROLLS', count }),
  or: (...conditions: UntilCondition[]): UntilCondition => ({ type: 'OR', conditions }),
  and: (...conditions: UntilCondition[]): UntilCondition => ({ type: 'AND', conditions }),
};

// ============================================================================
// Pre-built Recipe Templates
// ============================================================================

export const recipeTemplates = {
  /**
   * Basic job listing extraction:
   * - Go to page
   * - For each item: click, wait for details, extract, save
   * - Scroll for more
   * - Repeat until collected enough or no more items
   */
  jobListingExtraction: (url: string, maxItems: number = 20): Recipe => ({
    id: 'job_listing_extraction',
    name: 'Job Listing Extraction',
    commands: [
      cmd.openPage(url),
      cmd.waitForPage(),
      cmd.waitForList(),
      
      cmd.repeat([
        cmd.forEachItemInList([
          cmd.clickItem(),
          cmd.waitForDetails(),
          cmd.extractDetails(),
          cmd.save('job'),
          cmd.markDone(),
        ]),
        
        cmd.scrollForMore(),
        cmd.waitForListUpdate(),
      ], until.or(
        until.collected(maxItems),
        until.noMoreItems()
      )),
      
      cmd.end(),
    ],
    config: { maxItems },
  }),

  /**
   * Job listing with search:
   * - Go to page
   * - Search for query
   * - Then extract jobs
   */
  jobListingWithSearch: (url: string, query: string, maxItems: number = 20): Recipe => ({
    id: 'job_listing_with_search',
    name: 'Job Listing with Search',
    commands: [
      cmd.openPage(url),
      cmd.waitForPage(),
      
      cmd.goToSearchBox(),
      cmd.type(query),
      cmd.submit(),
      cmd.waitForList(),
      
      cmd.repeat([
        cmd.forEachItemInList([
          cmd.clickItem(),
          cmd.waitForDetails(),
          cmd.extractDetails(),
          cmd.save('job'),
          cmd.markDone(),
        ]),
        
        cmd.scrollForMore(),
        cmd.waitForListUpdate(),
      ], until.or(
        until.collected(maxItems),
        until.noMoreItems()
      )),
      
      cmd.end(),
    ],
    config: { maxItems },
  }),
};

