/**
 * StrategyPlanner Agent Tests
 * 
 * Tests the exploration and planning flow with mock scenarios
 */

import { describe, it, expect, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StrategyPlanner, createMockTools, type PlannerTools } from './strategy-planner';

// ============================================================================
// Mock LLM Factory
// ============================================================================

interface MockLLMOptions {
  /** Sequence of responses the LLM should give */
  responses: Array<{
    content: string;
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>;
  }>;
}

function createMockLLM(options: MockLLMOptions): BaseChatModel {
  let callIndex = 0;

  const mockInvoke = vi.fn().mockImplementation(async () => {
    const response = options.responses[callIndex] || options.responses[options.responses.length - 1];
    callIndex++;

    return {
      content: response.content,
      tool_calls: response.toolCalls || [],
    };
  });

  return {
    invoke: mockInvoke,
    // Add minimal required properties for BaseChatModel
    _llmType: () => 'mock',
    _modelType: () => 'mock',
  } as unknown as BaseChatModel;
}

// ============================================================================
// Sample DOM Snippets
// ============================================================================

const LINKEDIN_DOM_SAMPLE = `
[0]<div class="scaffold-layout__list">
  [1]<ul class="jobs-search-results__list">
    [2]<li class="job-card-container" data-occludable-job-id="12345">
      [3]<a class="job-card-container__link" href="/jobs/view/12345">
        [4]<span>Senior Software Engineer</span>
        [5]<span>TechCorp</span>
        [6]<span>San Francisco, CA</span>
      </a>
    </li>
    [7]<li class="job-card-container" data-occludable-job-id="12346">
      [8]<a class="job-card-container__link" href="/jobs/view/12346">
        [9]<span>Frontend Developer</span>
        [10]<span>StartupXYZ</span>
        [11]<span>Remote</span>
      </a>
    </li>
  </ul>
</div>
[12]<div class="jobs-details">
  [13]<div class="jobs-details__main-content">
    [14]<h2>Job Title</h2>
    [15]<span>Company Name</span>
    [16]<div class="jobs-description">Full job description here...</div>
  </div>
</div>
`;

const INDEED_DOM_SAMPLE = `
[0]<div class="mosaic-provider-jobcards">
  [1]<ul class="jobsearch-ResultsList">
    [2]<li class="result" data-jk="abc123">
      [3]<a class="jcs-JobTitle" href="/viewjob?jk=abc123">
        [4]<span>Software Engineer</span>
      </a>
      [5]<span class="companyName">BigCorp</span>
      [6]<div class="companyLocation">New York, NY</div>
    </li>
    [7]<li class="result" data-jk="abc124">
      [8]<a class="jcs-JobTitle" href="/viewjob?jk=abc124">
        [9]<span>Data Scientist</span>
      </a>
      [10]<span class="companyName">DataCo</span>
      [11]<div class="companyLocation">Boston, MA</div>
    </li>
  </ul>
</div>
[12]<nav class="pagination" aria-label="pagination">
  [13]<a href="?start=0">1</a>
  [14]<a href="?start=10">2</a>
  [15]<a href="?start=20">3</a>
  [16]<a aria-label="Next" href="?start=10">Next</a>
</nav>
`;

// ============================================================================
// Tests
// ============================================================================

describe('StrategyPlanner', () => {
  describe('with LinkedIn-style page (list-detail panel)', () => {
    it('should explore and plan strategy for panel-based navigation', async () => {
      // LLM will: 1) probe click a job card, 2) scroll to check loading, 3) output strategy
      const mockLLM = createMockLLM({
        responses: [
          // First call: LLM decides to probe click
          {
            content: 'I see job cards. Let me probe what happens when I click one.',
            toolCalls: [
              { name: 'probeClick', args: { selector: '.job-card-container:first-child' }, id: 'call_1' }
            ],
          },
          // Second call: After seeing panel result, scroll to check loading
          {
            content: 'A panel appeared. Let me check scroll behavior.',
            toolCalls: [
              { name: 'scrollAndObserve', args: { target: '.jobs-search-results__list' }, id: 'call_2' }
            ],
          },
          // Third call: Final strategy
          {
            content: `## PAGE UNDERSTANDING
This is a LinkedIn job search page with a list-detail layout.
- Left side: scrollable list of job cards in .jobs-search-results__list
- Right side: details panel (.jobs-details) that shows full job info
- Clicking a job card opens the detail panel on the right
- The list remains visible - no page navigation
- The job list uses infinite scroll

## STRATEGY
1. SCROLL/PAGINATION STRATEGY: Infinite scroll on .jobs-list container. 
   Scroll until we have 50+ items or hit the end.

2. EXTRACTION STRATEGY: For each job card, click to open detail 
   panel, extract fields from panel, then click next card.

3. NEEDED GENERATORS: None needed for basic extraction

4. LOOP STRUCTURE: 
   - Checkpoint item count
   - Scroll list
   - Wait for new items
   - Repeat until 50 items
   - For each item: click → extract → next`,
            toolCalls: [], // No more tool calls - done
          },
        ],
      });

      const planner = new StrategyPlanner(mockLLM, { maxToolCalls: 10 });
      const tools = createMockTools('linkedin');

      const result = await planner.plan({
        dom: LINKEDIN_DOM_SAMPLE,
        url: 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer',
        title: 'Jobs | LinkedIn',
        task: 'Extract 50 software engineer job listings',
      }, tools);

      // Check that tools were called
      expect(result.toolCalls.length).toBe(2);
      expect(result.toolCalls[0].tool).toBe('probeClick');
      expect(result.toolCalls[1].tool).toBe('scrollAndObserve');

      // Check strategy mentions key concepts
      expect(result.strategy).toContain('PAGE UNDERSTANDING');
      expect(result.strategy).toContain('STRATEGY');
      expect(result.strategy).toContain('list-detail');
      expect(result.strategy).toContain('infinite scroll');
      
      // No errors
      expect(result.errors.length).toBe(0);
    });
  });

  describe('with Indeed-style page (full page navigation)', () => {
    it('should explore and plan strategy for full-page navigation', async () => {
      const mockLLM = createMockLLM({
        responses: [
          // First call: probe click
          {
            content: 'Let me see what happens when I click a job.',
            toolCalls: [
              { name: 'probeClick', args: { selector: '.result:first-child' }, id: 'call_1' }
            ],
          },
          // Second call: check scroll
          {
            content: 'It navigated away! Let me check pagination.',
            toolCalls: [
              { name: 'scrollAndObserve', args: { target: 'page' }, id: 'call_2' }
            ],
          },
          // Final strategy
          {
            content: `## PAGE UNDERSTANDING
This is an Indeed job search page with traditional navigation.
- Single list of job cards
- No persistent details panel
- Clicking a job navigates to a full job details page
- Must navigate back to return to the list
- Static list - scrolling does not load more items
- Pagination controls at the bottom

## STRATEGY
1. SCROLL/PAGINATION STRATEGY: Use pagination. Click "Next" to go to subsequent pages.

2. EXTRACTION STRATEGY: For each job on current page, click to view details, 
   extract data, go back to list.

3. NEEDED GENERATORS: None needed for basic extraction

4. LOOP STRUCTURE:
   - For each job on page: click → extract → go back
   - Click "Next" to go to next page
   - Repeat for all pages`,
            toolCalls: [],
          },
        ],
      });

      const planner = new StrategyPlanner(mockLLM, { maxToolCalls: 10 });
      const tools = createMockTools('indeed');

      const result = await planner.plan({
        dom: INDEED_DOM_SAMPLE,
        url: 'https://www.indeed.com/jobs?q=software+engineer',
        title: 'Software Engineer Jobs | Indeed',
        task: 'Extract 50 software engineer job listings',
      }, tools);

      expect(result.toolCalls.length).toBe(2);
      expect(result.strategy).toContain('navigat');
      expect(result.strategy).toContain('Pagination');
      expect(result.errors.length).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle tool errors gracefully', async () => {
      const mockLLM = createMockLLM({
        responses: [
          {
            content: 'Let me try clicking.',
            toolCalls: [
              { name: 'probeClick', args: { selector: '.nonexistent' }, id: 'call_1' }
            ],
          },
          {
            content: 'The element was not found. The page might be different than expected.',
            toolCalls: [],
          },
        ],
      });

      const planner = new StrategyPlanner(mockLLM, { maxToolCalls: 10 });
      
      // Create tools that will fail
      const failingTools: PlannerTools = {
        probeClick: async () => 'Element ".nonexistent" not found on the page.',
        describeElement: async () => 'Element not found.',
        scrollAndObserve: async () => 'Scroll failed.',
      };

      const result = await planner.plan({
        dom: '<div>Empty page</div>',
        url: 'https://example.com',
        title: 'Empty',
        task: 'Test error handling',
      }, failingTools);

      expect(result.toolCalls.length).toBe(1);
      expect(result.toolCalls[0].result).toContain('not found');
      // LLM should still provide strategy despite errors
      expect(result.strategy).toBeTruthy();
    });

    it('should respect maxToolCalls limit', async () => {
      // LLM that always wants to make more tool calls
      const infiniteLLM = createMockLLM({
        responses: [
          {
            content: 'Let me keep exploring...',
            toolCalls: [
              { name: 'probeClick', args: { selector: '.something' }, id: 'call_1' }
            ],
          },
        ],
      });

      const planner = new StrategyPlanner(infiniteLLM, { maxToolCalls: 3 });
      const tools = createMockTools('simple-list');

      const result = await planner.plan({
        dom: '<div>Test</div>',
        url: 'https://example.com',
        title: 'Test',
        task: 'Test max calls',
      }, tools);

      // Should have stopped at 3 tool calls
      expect(result.toolCalls.length).toBeLessThanOrEqual(3);
      expect(result.errors.some(e => e.includes('stopped'))).toBe(true);
    });
  });

  describe('tool results flow through correctly', () => {
    it('should pass tool results back to LLM', async () => {
      const invokeCalls: unknown[] = [];
      
      const trackingLLM = {
        invoke: vi.fn().mockImplementation(async (messages: unknown[]) => {
          invokeCalls.push([...messages as unknown[]]);
          
          // First call: make a tool call
          if (invokeCalls.length === 1) {
            return {
              content: 'Probing...',
              tool_calls: [
                { name: 'probeClick', args: { selector: '.test' }, id: 'call_1' }
              ],
            };
          }
          // Second call: should have tool result, give final answer
          return {
            content: 'Got it! ' + JSON.stringify(messages),
            tool_calls: [],
          };
        }),
        _llmType: () => 'tracking',
        _modelType: () => 'tracking',
      } as unknown as BaseChatModel;

      const planner = new StrategyPlanner(trackingLLM, { maxToolCalls: 5 });
      const tools = createMockTools('linkedin');

      await planner.plan({
        dom: '<div>Test</div>',
        url: 'https://example.com',
        title: 'Test',
        task: 'Test flow',
      }, tools);

      // Should have been called twice
      expect(invokeCalls.length).toBe(2);
      
      // Second call should have 4 messages: system, human, AI with tool call, tool result
      const secondCallMessages = invokeCalls[1] as unknown[];
      expect(secondCallMessages.length).toBe(4);
    });
  });
});
