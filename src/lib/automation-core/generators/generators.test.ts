/**
 * Tests for Generators
 */

import { describe, it, expect, vi } from 'vitest';
import { FilterGenerator } from './filter-generator';
import { SortGenerator } from './sort-generator';
import { SearchGenerator } from './search-generator';
import { RecipeGenerator } from './recipe-generator';
import type { GeneratorContext } from './types';
import type { RecipeGeneratorContext } from './recipe-generator';

// Mock LLM
function createMockLLM(response: string) {
  return {
    invoke: vi.fn().mockResolvedValue({
      content: response,
    }),
  } as unknown as any;
}

describe('FilterGenerator', () => {
  const context: GeneratorContext = {
    dom: '<div class="filters"><select id="date-filter"><option>Past week</option></select></div>',
    url: 'https://example.com/jobs',
    title: 'Job Listings',
    strategy: 'Use the date filter dropdown to filter by Past week',
    instructions: 'Apply Past week filter',
  };

  it('should generate filter fragment from LLM response', async () => {
    const mockLLM = createMockLLM(JSON.stringify({
      filterSelector: '#date-filter',
      filterType: 'dropdown',
      optionsSelector: '#date-filter option',
      targetOption: 'Past week',
      commands: [
        { type: 'CLICK', selector: '#date-filter' },
        { type: 'SELECT', selector: '#date-filter', option: 'Past week' },
      ],
    }));

    const generator = new FilterGenerator(mockLLM);
    const result = await generator.generate(context);

    expect(result.success).toBe(true);
    expect(result.fragment).toBeDefined();
    expect(result.fragment?.type).toBe('filter');
    expect(result.fragment?.selector).toBe('#date-filter');
    expect(result.fragment?.commands.length).toBe(2);
    expect(result.fragment?.metadata?.filterType).toBe('dropdown');
  });

  it('should handle LLM errors gracefully', async () => {
    const mockLLM = createMockLLM('Not valid JSON');
    const generator = new FilterGenerator(mockLLM);
    const result = await generator.generate(context);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('SortGenerator', () => {
  const context: GeneratorContext = {
    dom: '<div class="sort"><button class="sort-btn">Most Recent</button></div>',
    url: 'https://example.com/jobs',
    title: 'Job Listings',
    strategy: 'Click the sort button to sort by Most Recent',
  };

  it('should generate sort fragment from LLM response', async () => {
    const mockLLM = createMockLLM(JSON.stringify({
      sortSelector: '.sort-btn',
      sortType: 'button',
      sortOption: 'Most Recent',
      commands: [
        { type: 'CLICK', selector: '.sort-btn' },
      ],
    }));

    const generator = new SortGenerator(mockLLM);
    const result = await generator.generate(context);

    expect(result.success).toBe(true);
    expect(result.fragment?.type).toBe('sort');
    expect(result.fragment?.selector).toBe('.sort-btn');
    expect(result.fragment?.metadata?.sortOption).toBe('Most Recent');
  });
});

describe('SearchGenerator', () => {
  const context: GeneratorContext = {
    dom: '<div class="search"><input type="text" id="search-input"/><button id="search-btn">Search</button></div>',
    url: 'https://example.com/jobs',
    title: 'Job Listings',
    strategy: 'Use the search input to search for jobs',
    instructions: 'Search for "software engineer"',
  };

  it('should generate search fragment from LLM response', async () => {
    const mockLLM = createMockLLM(JSON.stringify({
      searchInputSelector: '#search-input',
      submitSelector: '#search-btn',
      searchQuery: 'software engineer',
      commands: [
        { type: 'CLEAR', selector: '#search-input' },
        { type: 'TYPE', selector: '#search-input', text: 'software engineer' },
        { type: 'CLICK', selector: '#search-btn' },
      ],
    }));

    const generator = new SearchGenerator(mockLLM);
    const result = await generator.generate(context);

    expect(result.success).toBe(true);
    expect(result.fragment?.type).toBe('search');
    expect(result.fragment?.selector).toBe('#search-input');
    expect(result.fragment?.selectors?.submit).toBe('#search-btn');
    expect(result.fragment?.commands.length).toBe(3);
  });
});

describe('RecipeGenerator', () => {
  const context: RecipeGeneratorContext = {
    dom: '<div class="job-list"><div class="job-card">Job 1</div></div>',
    url: 'https://example.com/jobs',
    title: 'Job Listings',
    strategy: `
      ## PAGE UNDERSTANDING
      This is a job listing page with a list of job cards.
      
      ## STRATEGY
      1. SCROLL/PAGINATION: Scroll down to load more jobs
      2. EXTRACTION: Extract from each job card
      3. NEEDED GENERATORS: None
    `,
    fragments: [],
    task: 'Extract 10 jobs',
    maxItems: 10,
  };

  it('should generate recipe from LLM response', async () => {
    const mockLLM = createMockLLM(JSON.stringify({
      bindings: {
        LIST: '.job-list',
        LIST_ITEM: '.job-card',
        PAGE_LOADED: { exists: '.job-list' },
        LIST_LOADED: { exists: '.job-card' },
        CLICK_BEHAVIOR: 'inline',
      },
      recipe: {
        id: 'test_recipe',
        name: 'Test Recipe',
        commands: [
          { type: 'WAIT_FOR', target: 'page' },
          { type: 'FOR_EACH_ITEM_IN_LIST', commands: [
            { type: 'EXTRACT_DETAILS' },
            { type: 'SAVE', as: 'job' },
          ]},
          { type: 'END' },
        ],
      },
    }));

    const generator = new RecipeGenerator(mockLLM);
    const result = await generator.generate(context);

    expect(result.success).toBe(true);
    expect(result.recipe).toBeDefined();
    expect(result.recipe?.id).toBe('test_recipe');
    expect(result.recipe?.commands.length).toBeGreaterThan(0);
    expect(result.bindings).toBeDefined();
    expect(result.bindings?.LIST).toBe('.job-list');
    expect(result.bindings?.LIST_ITEM).toBe('.job-card');
    
    // Verify that "commands" was normalized to "body" for FOR_EACH_ITEM_IN_LIST
    const forEachCmd = result.recipe?.commands.find(c => c.type === 'FOR_EACH_ITEM_IN_LIST');
    expect(forEachCmd).toBeDefined();
    expect((forEachCmd as any).body).toBeDefined();
    expect((forEachCmd as any).commands).toBeUndefined();
  });

  it('should include generator fragments in recipe', async () => {
    const contextWithFragments: RecipeGeneratorContext = {
      ...context,
      fragments: [
        {
          type: 'filter',
          selector: '#date-filter',
          commands: [{ type: 'SELECT', name: 'filterDropdown', option: 'Past week' } as any],
        },
      ],
    };

    const mockLLM = createMockLLM(JSON.stringify({
      bindings: {
        LIST: '.job-list',
        LIST_ITEM: '.job-card',
      },
      recipe: {
        id: 'recipe_with_filter',
        name: 'Recipe with Filter',
        commands: [
          { type: 'SELECT', selector: '#date-filter', option: 'Past week' },
          { type: 'WAIT', seconds: 1 },
          { type: 'WAIT_FOR', target: 'list' },
          { type: 'END' },
        ],
      },
    }));

    const generator = new RecipeGenerator(mockLLM);
    const result = await generator.generate(contextWithFragments);

    expect(result.success).toBe(true);
    // Verify LLM received the fragments
    expect(mockLLM.invoke).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('filter'),
        }),
      ])
    );
  });
});

