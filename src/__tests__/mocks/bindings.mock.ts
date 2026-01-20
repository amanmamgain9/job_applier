/**
 * Mock PageBindings for testing
 */

import type { PageBindings } from '@/lib/automation-core/recipe/bindings';

/**
 * Complete mock bindings for LinkedIn job search
 */
export function createLinkedInBindings(): PageBindings {
  return {
    id: 'linkedin_jobs_test',
    urlPattern: 'linkedin.com/jobs',
    version: 1,
    updatedAt: Date.now(),

    SEARCH_BOX: '.jobs-search-box__text-input',

    LIST: 'ul.scaffold-layout__list-container',
    LIST_ITEM: 'li[data-occludable-job-id]',
    LIST_ITEM_ACTIVE: 'li[data-occludable-job-id].active',

    DETAILS_PANEL: '.jobs-details',
    DETAILS_CONTENT: [
      'li[data-occludable-job-id]',
      '.jobs-description-content',
    ],

    SCROLL_CONTAINER: '.jobs-search-results-list',

    PAGE_LOADED: { exists: 'li[data-occludable-job-id]' },
    LIST_LOADED: { exists: 'li[data-occludable-job-id]' },
    LIST_UPDATED: { countChanged: 'li[data-occludable-job-id]' },
    DETAILS_LOADED: { exists: 'li[data-occludable-job-id]' },
    NO_MORE_ITEMS: { exists: '.jobs-search-no-results-banner' },
    LOADING: { exists: '.jobs-search-results__loader' },

    ITEM_ID: {
      from: 'data',
      attribute: 'data-occludable-job-id',
    },

    SCROLL_BEHAVIOR: 'infinite',
    CLICK_BEHAVIOR: 'inline',
  };
}

/**
 * Create minimal valid bindings for unit tests
 */
export function createMinimalBindings(overrides?: Partial<PageBindings>): PageBindings {
  return {
    id: 'minimal_test',
    urlPattern: 'example.com',
    version: 1,
    updatedAt: Date.now(),

    LIST: '.list',
    LIST_ITEM: '.list-item',
    DETAILS_CONTENT: ['.list-item'],

    PAGE_LOADED: { exists: 'body' },
    LIST_LOADED: { exists: '.list-item' },
    LIST_UPDATED: { countChanged: '.list-item' },
    DETAILS_LOADED: { exists: '.list-item' },
    NO_MORE_ITEMS: { exists: '.no-results' },

    ITEM_ID: {
      from: 'href',
      pattern: '/(\\d+)',
    },

    SCROLL_BEHAVIOR: 'infinite',
    CLICK_BEHAVIOR: 'inline',

    ...overrides,
  };
}

/**
 * Create bindings with filters for testing filter operations
 */
export function createBindingsWithFilters(): PageBindings {
  return createMinimalBindings({
    FILTERS: {
      location: {
        selector: '.filter-location',
        type: 'dropdown',
        optionsSelector: '.filter-location option',
      },
      remote: {
        selector: '.filter-remote',
        type: 'checkbox',
      },
      salary: {
        selector: '.filter-salary',
        type: 'input',
      },
    },
    // Named elements - apply button is just another element
    ELEMENTS: {
      applyFilters: '.filter-apply',
      sortDropdown: '.sort-dropdown',
    },
  });
}

