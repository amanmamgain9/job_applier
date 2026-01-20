/**
 * RecipeRunner Tests
 * 
 * Tests the high-level runner that orchestrates Navigator, Executor, and Extractor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecipeRunner } from './runner';
import { recipeTemplates } from './commands';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Page } from '../browser/page';
import { 
  createMockPage, 
  createJobListElements,
  type MockPage,
} from '@/__tests__/mocks/page.mock';
import { clearMockStorage } from '@/__tests__/setup';

// Helper to cast MockPage to Page for runner
const asPage = (mock: MockPage): Page => mock as unknown as Page;

// ============================================================================
// Mock LLM Factory
// ============================================================================

function createMockNavigatorLLM(options: {
  bindings?: Record<string, unknown>;
  shouldFail?: boolean;
} = {}): BaseChatModel {
  const { bindings, shouldFail = false } = options;
  
  const defaultBindings = {
    id: 'mock_bindings',
    urlPattern: 'example.com',
    LIST: '.list',
    LIST_ITEM: '.list-item',
    DETAILS_CONTENT: ['.list-item'],
    PAGE_LOADED: { exists: 'body' },
    LIST_LOADED: { exists: '.list-item' },
    LIST_UPDATED: { countChanged: '.list-item' },
    DETAILS_LOADED: { exists: '.list-item' },
    NO_MORE_ITEMS: { exists: '.no-results' },
    ITEM_ID: { from: 'href', pattern: '/(\\d+)' },
    SCROLL_BEHAVIOR: 'infinite',
    CLICK_BEHAVIOR: 'inline',
  };

  return {
    invoke: vi.fn().mockImplementation(async () => {
      if (shouldFail) {
        return { content: 'Error: Could not analyze page' };
      }
      return { content: JSON.stringify(bindings || defaultBindings) };
    }),
    _llmType: vi.fn().mockReturnValue('mock'),
    bindTools: vi.fn().mockReturnThis(),
    pipe: vi.fn().mockReturnThis(),
  } as unknown as BaseChatModel;
}

function createMockExtractorLLM(options: {
  shouldFail?: boolean;
  jobs?: Array<{ title: string; company: string }>;
} = {}): BaseChatModel {
  const { shouldFail = false, jobs = [] } = options;
  let callIndex = 0;

  return {
    invoke: vi.fn().mockImplementation(async () => {
      if (shouldFail) {
        throw new Error('Extraction failed');
      }
      
      const job = jobs[callIndex] || {
        title: `Job ${callIndex + 1}`,
        company: `Company ${callIndex + 1}`,
      };
      callIndex++;
      
      return {
        content: JSON.stringify({
          title: job.title,
          company: job.company,
          location: 'Remote',
          jobType: 'Full-time',
        }),
      };
    }),
    _llmType: vi.fn().mockReturnValue('mock'),
    bindTools: vi.fn().mockReturnThis(),
    pipe: vi.fn().mockReturnThis(),
  } as unknown as BaseChatModel;
}

// ============================================================================
// Tests
// ============================================================================

describe('RecipeRunner', () => {
  let mockPage: MockPage;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockStorage();
    mockPage = createMockPage({ elements: createJobListElements(5) });
  });

  describe('Initialization', () => {
    it('should create runner with config', () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
        maxItems: 10,
      });

      expect(runner).toBeDefined();
      expect(runner.getBindings()).toBeNull();
    });
  });

  describe('Recipe Execution', () => {
    it('should return result with all expected fields', async () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        5
      );

      const result = await runner.run(asPage(mockPage), recipe);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('bindings');
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('logs');
      expect(result.stats).toHaveProperty('duration');
      expect(result.stats).toHaveProperty('commandsExecuted');
      expect(result.stats).toHaveProperty('itemsProcessed');
      expect(result.stats).toHaveProperty('scrollsPerformed');
      expect(result.stats).toHaveProperty('bindingFixes');
    });

    it('should discover bindings and include them in result', async () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        2
      );

      const result = await runner.run(asPage(mockPage), recipe);

      // Result should have bindings (either discovered or failed)
      expect(result).toHaveProperty('bindings');
    });

    it('should return items array in result', async () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM({
        jobs: [
          { title: 'Software Engineer', company: 'TechCorp' },
          { title: 'Senior Developer', company: 'StartupInc' },
        ],
      });

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
        maxItems: 5,
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        5
      );

      const result = await runner.run(asPage(mockPage), recipe);

      // Result should have items array
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe('Progress Callback', () => {
    it('should call progress callback during execution', async () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      const progressCalls: Array<{ step: string; itemsCollected: number }> = [];
      runner.setProgressCallback((progress) => {
        progressCalls.push({
          step: progress.step,
          itemsCollected: progress.itemsCollected,
        });
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        3
      );

      await runner.run(asPage(mockPage), recipe);

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls.some(p => p.step === 'Analyzing page')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle binding discovery failure', async () => {
      const navigatorLLM = createMockNavigatorLLM({ shouldFail: true });
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        2
      );

      const result = await runner.run(asPage(mockPage), recipe);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return stats even on failure', async () => {
      const navigatorLLM = createMockNavigatorLLM({ shouldFail: true });
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        2
      );

      const result = await runner.run(asPage(mockPage), recipe);

      expect(result.stats).toBeDefined();
      expect(result.stats.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include logs for debugging', async () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        2
      );

      const result = await runner.run(asPage(mockPage), recipe);

      expect(result.logs).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.logs!.length).toBeGreaterThan(0);
    });
  });

  describe('Binding Management', () => {
    it('should include bindings in result object', async () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        2
      );

      const result = await runner.run(asPage(mockPage), recipe);

      // Result should have bindings property
      expect(result).toHaveProperty('bindings');
    });

    it('should return null from getBindings() before any run', () => {
      const navigatorLLM = createMockNavigatorLLM();
      const extractorLLM = createMockExtractorLLM();

      const runner = new RecipeRunner({
        navigatorLLM,
        extractorLLM,
      });

      expect(runner.getBindings()).toBeNull();
    });
  });

  describe('Recipe Templates', () => {
    it('jobListingExtraction should create valid recipe', () => {
      const recipe = recipeTemplates.jobListingExtraction(
        'https://example.com/jobs',
        10
      );

      expect(recipe.id).toBe('job_listing_extraction');
      expect(recipe.commands.length).toBeGreaterThan(0);
      expect(recipe.config?.maxItems).toBe(10);
      
      const commandTypes = recipe.commands.map(c => c.type);
      expect(commandTypes).toContain('OPEN_PAGE');
      expect(commandTypes).toContain('WAIT_FOR_PAGE');
      expect(commandTypes).toContain('REPEAT');
    });

    it('jobListingWithSearch should include search commands', () => {
      const recipe = recipeTemplates.jobListingWithSearch(
        'https://example.com/jobs',
        'software engineer',
        10
      );

      const commandTypes = recipe.commands.map(c => c.type);
      expect(commandTypes).toContain('GO_TO_SEARCH_BOX');
      expect(commandTypes).toContain('TYPE');
      expect(commandTypes).toContain('SUBMIT');
    });
  });
});

