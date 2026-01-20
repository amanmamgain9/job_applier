/**
 * Page Bindings - Maps commands to page-specific selectors
 * 
 * Bindings tell the executor WHERE things are on a specific page.
 * The Navigator LLM discovers these by analyzing the DOM.
 */

// ============================================================================
// Binding Types
// ============================================================================

/**
 * Condition for detecting page states
 */
export interface StateCondition {
  /** Element exists */
  exists?: string;
  /** Element is visible */
  visible?: string;
  /** Element is gone */
  gone?: string;
  /** Item count changed from before */
  countChanged?: string;
  /** Item count is at least N */
  countAtLeast?: { selector: string; count: number };
  /** URL contains string */
  urlContains?: string;
  /** URL matches pattern */
  urlMatches?: string;
  /** Multiple conditions (all must be true) */
  and?: StateCondition[];
  /** Multiple conditions (any must be true) */
  or?: StateCondition[];
}

/**
 * How to extract a unique ID from an item
 */
export interface ItemIdExtractor {
  /** Where to get the ID from */
  from: 'attribute' | 'href' | 'text' | 'data';
  /** Selector to find the element with ID (relative to item) */
  selector?: string;
  /** Attribute name if from='attribute' */
  attribute?: string;
  /** Regex pattern to extract ID */
  pattern?: string;
}

/**
 * Page bindings - maps commands to selectors
 */
export interface PageBindings {
  /** Unique identifier for this binding set */
  id: string;
  /** URL pattern this binding works for */
  urlPattern: string;
  /** When this binding was created/updated */
  version: number;
  updatedAt: number;

  // ==========================================
  // Element Selectors
  // ==========================================
  
  /** Search box input */
  SEARCH_BOX?: string;
  /** Search submit button (if not Enter key) */
  SEARCH_SUBMIT?: string;
  
  /** List container */
  LIST: string;
  /** Individual list items */
  LIST_ITEM: string;
  /** Currently selected/active item indicator */
  LIST_ITEM_ACTIVE?: string;
  
  /** Details panel container */
  DETAILS_PANEL?: string;
  /** Content areas to extract from details */
  DETAILS_CONTENT: string[];
  
  /** Filter elements by name */
  FILTERS?: Record<string, {
    selector: string;
    type: 'dropdown' | 'checkbox' | 'button' | 'input';
    optionsSelector?: string;
  }>;
  
  /** Named elements you can navigate to (buttons, dropdowns, any interactive element) */
  ELEMENTS?: Record<string, string>;
  
  /** Scroll container (if not window) */
  SCROLL_CONTAINER?: string;
  
  /** Load more button (if not infinite scroll) */
  LOAD_MORE_BUTTON?: string;
  
  /** Next page button (if paginated) */
  NEXT_PAGE_BUTTON?: string;
  
  // ==========================================
  // State Detection
  // ==========================================
  
  /** How to know page is loaded */
  PAGE_LOADED: StateCondition;
  /** How to know list is loaded */
  LIST_LOADED: StateCondition;
  /** How to know list has updated (after scroll/pagination) */
  LIST_UPDATED: StateCondition;
  /** How to know details are loaded */
  DETAILS_LOADED: StateCondition;
  /** How to know there are no more items */
  NO_MORE_ITEMS: StateCondition;
  /** How to know list is empty */
  LIST_EMPTY?: StateCondition;
  /** Loading indicator */
  LOADING?: StateCondition;
  
  // ==========================================
  // Item Identification
  // ==========================================
  
  /** How to get unique ID from each item */
  ITEM_ID: ItemIdExtractor;
  
  // ==========================================
  // Behavior
  // ==========================================
  
  /** How scrolling works */
  SCROLL_BEHAVIOR: 'infinite' | 'paginated' | 'load_more_button' | 'static';
  
  /** What happens when you click an item */
  CLICK_BEHAVIOR: 'shows_panel' | 'navigates' | 'expands' | 'inline';
  
  /** How to return to list after viewing details (if navigates) */
  RETURN_TO_LIST?: 'go_back' | 'click_close' | 'none';
  CLOSE_DETAILS_BUTTON?: string;
}

// ============================================================================
// Binding Validation
// ============================================================================

export interface BindingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateBindings(bindings: Partial<PageBindings>): BindingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required fields
  if (!bindings.LIST) errors.push('LIST selector is required');
  if (!bindings.LIST_ITEM) errors.push('LIST_ITEM selector is required');
  if (!bindings.DETAILS_CONTENT?.length) errors.push('DETAILS_CONTENT selectors are required');
  if (!bindings.ITEM_ID) errors.push('ITEM_ID extractor is required');
  if (!bindings.LIST_LOADED) errors.push('LIST_LOADED condition is required');
  if (!bindings.DETAILS_LOADED) errors.push('DETAILS_LOADED condition is required');
  if (!bindings.SCROLL_BEHAVIOR) errors.push('SCROLL_BEHAVIOR is required');
  if (!bindings.CLICK_BEHAVIOR) errors.push('CLICK_BEHAVIOR is required');
  
  // Conditional requirements
  if (bindings.SCROLL_BEHAVIOR === 'load_more_button' && !bindings.LOAD_MORE_BUTTON) {
    errors.push('LOAD_MORE_BUTTON required when SCROLL_BEHAVIOR is load_more_button');
  }
  if (bindings.SCROLL_BEHAVIOR === 'paginated' && !bindings.NEXT_PAGE_BUTTON) {
    errors.push('NEXT_PAGE_BUTTON required when SCROLL_BEHAVIOR is paginated');
  }
  if (bindings.CLICK_BEHAVIOR === 'navigates' && !bindings.RETURN_TO_LIST) {
    warnings.push('RETURN_TO_LIST recommended when CLICK_BEHAVIOR is navigates');
  }
  
  // Warnings
  if (!bindings.NO_MORE_ITEMS) {
    warnings.push('NO_MORE_ITEMS condition not set - may not detect end of list');
  }
  if (!bindings.PAGE_LOADED) {
    warnings.push('PAGE_LOADED condition not set - using default');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Example Bindings
// ============================================================================

export const exampleBindings: Record<string, PageBindings> = {
  linkedin_jobs: {
    id: 'linkedin_jobs_v1',
    urlPattern: 'linkedin.com/jobs',
    version: 1,
    updatedAt: Date.now(),
    
    SEARCH_BOX: '.jobs-search-box__text-input',
    
    LIST: '.jobs-search-results-list',
    LIST_ITEM: '.jobs-search-results__list-item',
    LIST_ITEM_ACTIVE: '.jobs-search-results__list-item--active',
    
    DETAILS_PANEL: '.jobs-details',
    DETAILS_CONTENT: [
      '.jobs-unified-top-card',
      '.jobs-description-content',
    ],
    
    // Named elements for GO_TO command
    ELEMENTS: {
      sortDropdown: '.jobs-search-sort-button',
      showResults: '.filter-show-results-button',
    },
    
    SCROLL_CONTAINER: '.jobs-search-results-list',
    
    PAGE_LOADED: { exists: '.jobs-search-results-list' },
    LIST_LOADED: { exists: '.jobs-search-results__list-item' },
    LIST_UPDATED: { countChanged: '.jobs-search-results__list-item' },
    DETAILS_LOADED: { exists: '.jobs-description-content' },
    NO_MORE_ITEMS: { 
      or: [
        { exists: '.jobs-search-no-results' },
        { exists: '.jobs-search-results__list-item[data-is-last="true"]' },
      ]
    },
    LOADING: { exists: '.jobs-search-results__loader' },
    
    ITEM_ID: {
      from: 'href',
      selector: 'a[href*="/jobs/view/"]',
      pattern: '/jobs/view/(\\d+)',
    },
    
    SCROLL_BEHAVIOR: 'infinite',
    CLICK_BEHAVIOR: 'shows_panel',
  },
  
  indeed_jobs: {
    id: 'indeed_jobs_v1',
    urlPattern: 'indeed.com/jobs',
    version: 1,
    updatedAt: Date.now(),
    
    SEARCH_BOX: '#text-input-what',
    
    LIST: '.jobsearch-ResultsList',
    LIST_ITEM: '.job_seen_beacon',
    
    DETAILS_PANEL: '.jobsearch-ViewJobLayout',
    DETAILS_CONTENT: [
      '.jobsearch-JobInfoHeader',
      '.jobsearch-JobComponent-description',
    ],
    
    // Named elements for GO_TO command
    ELEMENTS: {
      sortDropdown: '#filter-dateposted',
      findJobsButton: '.yosegi-InlineWhatWhere-primaryButton',
    },
    
    PAGE_LOADED: { exists: '.jobsearch-ResultsList' },
    LIST_LOADED: { exists: '.job_seen_beacon' },
    LIST_UPDATED: { countChanged: '.job_seen_beacon' },
    DETAILS_LOADED: { exists: '.jobsearch-JobComponent-description' },
    NO_MORE_ITEMS: { exists: '.jobsearch-NoResults' },
    
    ITEM_ID: {
      from: 'attribute',
      selector: 'a[data-jk]',
      attribute: 'data-jk',
    },
    
    SCROLL_BEHAVIOR: 'paginated',
    NEXT_PAGE_BUTTON: '[data-testid="pagination-page-next"]',
    CLICK_BEHAVIOR: 'shows_panel',
  },
};

// ============================================================================
// Binding Storage
// ============================================================================

const STORAGE_KEY = 'page_bindings';

export async function loadBindings(urlPattern: string): Promise<PageBindings | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const allBindings = result[STORAGE_KEY] as Record<string, PageBindings> | undefined;
    
    if (!allBindings) return null;
    
    // Find matching binding
    for (const binding of Object.values(allBindings)) {
      if (urlPattern.includes(binding.urlPattern) || binding.urlPattern.includes(urlPattern)) {
        return binding;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function saveBindings(bindings: PageBindings): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const allBindings = (result[STORAGE_KEY] as Record<string, PageBindings>) || {};
    
    allBindings[bindings.id] = {
      ...bindings,
      updatedAt: Date.now(),
    };
    
    await chrome.storage.local.set({ [STORAGE_KEY]: allBindings });
  } catch (error) {
    console.error('Failed to save bindings:', error);
  }
}

export async function getAllBindings(): Promise<PageBindings[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const allBindings = result[STORAGE_KEY] as Record<string, PageBindings> | undefined;
    return allBindings ? Object.values(allBindings) : [];
  } catch {
    return [];
  }
}

/**
 * Clear all saved bindings (forces fresh LLM discovery on next run)
 */
export async function clearAllBindings(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
    console.log('Cleared all page bindings');
  } catch (error) {
    console.error('Failed to clear bindings:', error);
  }
}

/**
 * Clear bindings for a specific URL pattern
 */
export async function clearBindingsForUrl(urlPattern: string): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const allBindings = (result[STORAGE_KEY] as Record<string, PageBindings>) || {};
    
    let cleared = false;
    for (const [id, binding] of Object.entries(allBindings)) {
      if (urlPattern.includes(binding.urlPattern) || binding.urlPattern.includes(urlPattern)) {
        delete allBindings[id];
        cleared = true;
      }
    }
    
    if (cleared) {
      await chrome.storage.local.set({ [STORAGE_KEY]: allBindings });
      console.log(`Cleared bindings for: ${urlPattern}`);
    }
    
    return cleared;
  } catch (error) {
    console.error('Failed to clear bindings:', error);
    return false;
  }
}

