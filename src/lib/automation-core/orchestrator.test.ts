/**
 * Tests for AgentOrchestrator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from './orchestrator';
import type { Page } from './browser/page';

// Mock Page
function createMockPage(url = 'https://example.com/jobs'): Page {
  const mockElementTree = {
    clickableElementsToString: () => `
      <div class="job-list" data-ref="[1]">
        <div class="job-card" data-ref="[2]">
          <h3>Software Engineer</h3>
          <span>Company A</span>
        </div>
        <div class="job-card" data-ref="[3]">
          <h3>Product Manager</h3>
          <span>Company B</span>
        </div>
      </div>
    `,
    toString: () => 'mock element tree',
  };

  return {
    url: () => url,
    title: () => Promise.resolve('Job Listings'),
    attached: true,
    getState: vi.fn().mockResolvedValue({
      elementTree: mockElementTree,
    }),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    scrollDown: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(true),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    getHtml: vi.fn().mockResolvedValue('<div>mock</div>'),
    getTabId: vi.fn().mockReturnValue(1),
  } as unknown as Page;
}

// Mock LLM that produces valid outputs
function createMockLLM() {
  const responses = [
    // StrategyPlanner response (final output after potential tool calls)
    `## PAGE UNDERSTANDING
This is a job listing page with a left sidebar containing job cards and a right panel showing job details.

## STRATEGY
1. SCROLL/PAGINATION STRATEGY: Scroll within the job list container to load more items
2. EXTRACTION STRATEGY: Click each job card to load details, then extract from the detail panel
3. NEEDED GENERATORS: None needed for basic extraction
4. LOOP STRUCTURE: Iterate through job cards, click each, extract details, mark done`,

    // RecipeGenerator response
    JSON.stringify({
      bindings: {
        LIST: '.job-list',
        LIST_ITEM: '.job-card',
        PAGE_LOADED: { exists: '.job-list' },
        LIST_LOADED: { exists: '.job-card' },
        DETAILS_LOADED: { exists: '.job-card' },
        CLICK_BEHAVIOR: 'inline',
      },
      recipe: {
        id: 'test_recipe',
        name: 'Job Extraction Recipe',
        commands: [
          { type: 'WAIT_FOR', target: 'page' },
          { type: 'WAIT_FOR', target: 'list' },
          { type: 'FOR_EACH_ITEM_IN_LIST', commands: [
            { type: 'EXTRACT_DETAILS' },
            { type: 'SAVE', as: 'job' },
            { type: 'MARK_DONE' },
          ]},
          { type: 'END' },
        ],
      },
    }),
  ];

  let callIndex = 0;
  return {
    invoke: vi.fn().mockImplementation(async () => {
      const response = responses[callIndex % responses.length];
      callIndex++;
      return { content: response };
    }),
    bindTools: vi.fn().mockReturnThis(),
  } as unknown as any;
}

describe('AgentOrchestrator', () => {
  let mockPage: Page;
  let mockLLM: ReturnType<typeof createMockLLM>;

  beforeEach(() => {
    mockPage = createMockPage();
    mockLLM = createMockLLM();
  });

  describe('run', () => {
    it('should complete the full agent flow', async () => {
      const orchestrator = new AgentOrchestrator({
        plannerLLM: mockLLM,
        maxToolCalls: 3,
      });

      const result = await orchestrator.run({
        page: mockPage,
        task: 'Extract 10 job listings',
        maxItems: 10,
      });

      expect(result.success).toBe(true);
      expect(result.recipe).toBeDefined();
      expect(result.bindings).toBeDefined();
      expect(result.phaseOutputs.length).toBeGreaterThan(0);
      expect(result.strategy).toBeDefined();
    });

    it('should capture phase outputs', async () => {
      const orchestrator = new AgentOrchestrator({
        plannerLLM: mockLLM,
        maxToolCalls: 3,
      });

      const result = await orchestrator.run({
        page: mockPage,
        task: 'Extract jobs',
        maxItems: 5,
      });

      // Should have at least strategy_planner and recipe_generator phases
      expect(result.phaseOutputs.some(p => p.phase === 'strategy_planner')).toBe(true);
      expect(result.phaseOutputs.some(p => p.phase === 'recipe_generator')).toBe(true);

      // Each phase should have timing info
      for (const phase of result.phaseOutputs) {
        expect(phase.timestamp).toBeGreaterThan(0);
        expect(typeof phase.duration).toBe('number');
        expect(typeof phase.success).toBe('boolean');
      }
    });

    it('should use provided strategy if given', async () => {
      const providedStrategy = `
## PAGE UNDERSTANDING
Pre-analyzed page structure.

## STRATEGY
1. Just scroll and extract
3. NEEDED GENERATORS: None
`;

      const orchestrator = new AgentOrchestrator({
        plannerLLM: mockLLM,
        providedStrategy,
        maxToolCalls: 0,
      });

      const result = await orchestrator.run({
        page: mockPage,
        task: 'Extract jobs',
        maxItems: 5,
      });

      // Should use provided strategy without running planner
      expect(result.strategy).toBe(providedStrategy);
      // Planner phase should still be recorded but with 0 duration
      const plannerPhase = result.phaseOutputs.find(p => p.phase === 'strategy_planner');
      expect(plannerPhase?.duration).toBe(0);
    });

    it('should run generators when strategy requests them', async () => {
      // Create LLM that requests FilterGenerator
      const llmWithFilter = {
        invoke: vi.fn()
          .mockResolvedValueOnce({
            content: `## PAGE UNDERSTANDING
Job page with filters.

## STRATEGY
1. NEEDED GENERATORS: FilterGenerator
2. Apply date filter first`,
          })
          // FilterGenerator response
          .mockResolvedValueOnce({
            content: JSON.stringify({
              filterSelector: '#date-filter',
              filterType: 'dropdown',
              commands: [{ type: 'SELECT', selector: '#date-filter', option: 'Past week' }],
            }),
          })
          // RecipeGenerator response
          .mockResolvedValueOnce({
            content: JSON.stringify({
              bindings: { LIST: '.jobs', LIST_ITEM: '.job' },
              recipe: { id: 'test', name: 'Test', commands: [{ type: 'END' }] },
            }),
          }),
        bindTools: vi.fn().mockReturnThis(),
      } as unknown as any;

      const orchestrator = new AgentOrchestrator({
        plannerLLM: llmWithFilter,
        maxToolCalls: 3,
      });

      const result = await orchestrator.run({
        page: mockPage,
        task: 'Extract jobs',
        maxItems: 5,
      });

      expect(result.success).toBe(true);
      // Should have filter_generator phase
      expect(result.phaseOutputs.some(p => p.phase === 'filter_generator')).toBe(true);
      // Should have fragments
      expect(result.fragments?.length).toBeGreaterThan(0);
      expect(result.fragments?.[0].type).toBe('filter');
    });

    it('should handle page state errors gracefully', async () => {
      const badPage = {
        url: () => 'https://example.com',
        title: () => Promise.resolve('Test'),
        getState: vi.fn().mockResolvedValue(null),
      } as unknown as Page;

      const orchestrator = new AgentOrchestrator({
        plannerLLM: mockLLM,
        maxToolCalls: 3,
      });

      const result = await orchestrator.run({
        page: badPage,
        task: 'Extract jobs',
        maxItems: 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('DOM tree');
    });
  });
});

