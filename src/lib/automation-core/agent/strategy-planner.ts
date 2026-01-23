/**
 * StrategyPlanner Agent - Explores pages and plans automation strategies
 * 
 * This is Phase 1 of the agent flow:
 * - Takes DOM + Task as input
 * - Has tools to interactively explore the page
 * - Outputs English understanding + strategy + which generators are needed
 */

import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Page } from '../browser/page';
import { createLogger } from '../utils/logger';

const logger = createLogger('StrategyPlanner');

// ============================================================================
// Types
// ============================================================================

export interface PlannerContext {
  /** DOM snapshot of the page */
  dom: string;
  /** URL of the page */
  url: string;
  /** Page title */
  title: string;
  /** Task description */
  task: string;
}

export interface PlannerResult {
  /** English understanding + strategy (combined output) */
  strategy: string;
  /** Tool calls made during exploration */
  toolCalls: ToolCallLog[];
  /** Any errors encountered */
  errors: string[];
}

export interface ToolCallLog {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface PlannerTools {
  probeClick: (selector: string) => Promise<string>;
  describeElement: (selector: string) => Promise<string>;
  scrollAndObserve: (target: string) => Promise<string>;
}

// ============================================================================
// Tool Definitions (for LLM)
// ============================================================================

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'probeClick',
      description: 'Click an element and describe what happens. Use this to understand navigation behavior - does clicking open a panel, navigate to a new page, expand content inline, etc.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element to click (e.g. ".job-card:first-child", "button.apply")',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'describeElement',
      description: 'Get a detailed description of what an element contains. Use this to understand what data is available in a section.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector for the element to describe',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'scrollAndObserve',
      description: 'Scroll within a target and describe what happens. Use this to understand infinite scroll vs pagination behavior.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Either "page" to scroll the whole page, or a CSS selector for a scrollable container',
          },
        },
        required: ['target'],
      },
    },
  },
];

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a Strategy Planner for web automation. Your job is to explore a page, understand how it works, and plan the automation strategy.

You have tools to interactively explore the page:
- probeClick(selector): Click something and see what happens
- describeElement(selector): Look at what's inside an element  
- scrollAndObserve(target): Scroll and see if more content loads. Pass "page" OR a container selector.

EXPLORATION STRATEGY:
1. Look at the DOM to identify CLICKABLE items (links, buttons that represent individual list items)
2. Use probeClick on a SPECIFIC clickable element to see what happens
3. If clicking opened a details panel - that's your LIST_ITEM!
4. Use describeElement on the DETAILS_PANEL to find content selectors inside it
5. Use scrollAndObserve("page") to check if scrolling loads more items

CRITICAL - FINDING THE RIGHT SELECTOR:
- You need to find the selector that, when CLICKED, opens the details
- If probeClick("X") opened a details panel → X is your LIST_ITEM ✓
- If probeClick("X") navigated to a different page → X is WRONG, try a different selector ✗
- The clickable item is usually an <a> tag or a specific card element
- Do NOT use parent containers like "div:has(...)" - use the actual clickable element!

YOUR OUTPUT must include TWO sections:

## PAGE UNDERSTANDING
- What type of page this is
- The layout (list-detail? cards? single list?)
- What happens when you click items (opens panel? navigates? inline expansion?)
- Does scrolling load more items, or is there pagination?

## STRATEGY

### VERIFIED SELECTORS
CRITICAL: LIST_ITEM must be the selector that OPENED THE DETAILS PANEL when clicked!

Based on your probeClick results:
- LIST_ITEM: [the EXACT selector from probeClick that opened the details panel - NOT a parent container!]
- DETAILS_PANEL: [the selector that appeared after the successful probeClick]
- DETAILS_CONTENT: [CSS selectors INSIDE the details panel for extracting text content]
- PAGINATION_BUTTON: [only if you tested it, otherwise "none"]

EXAMPLE:
- If probeClick("div:has(a[href*='/item'])") navigated away → WRONG, don't use it
- If probeClick("a[href*='/item/']") opened a panel → USE THIS as LIST_ITEM

After finding DETAILS_PANEL, use describeElement on it to discover content selectors.
Look for headings (h1, h2, h3), paragraphs, links, or elements with semantic class names.

### AUTOMATION PLAN
1. How to load more items (scroll or pagination)
2. How to extract data from each item  
3. NEEDED GENERATORS: None (unless task explicitly requires filtering/sorting/searching)
4. Loop structure

The LIST_ITEM selector will be clicked to open details for each item.`;

// ============================================================================
// StrategyPlanner Agent
// ============================================================================

export class StrategyPlanner {
  private llm: BaseChatModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private llmWithTools: any;
  private maxToolCalls: number;

  constructor(llm: BaseChatModel, options?: { maxToolCalls?: number }) {
    this.llm = llm;
    // Bind tools to the model for tool calling
    // Using 'any' because bindTools returns a Runnable type that's incompatible with BaseChatModel
    this.llmWithTools = (llm as any).bindTools?.(TOOLS) ?? llm;
    this.maxToolCalls = options?.maxToolCalls ?? 10;
  }

  /**
   * Explore a page and plan automation strategy
   */
  async plan(
    context: PlannerContext,
    tools: PlannerTools
  ): Promise<PlannerResult> {
    logger.info(`Starting strategy planning: ${context.url}`);
    logger.info(`Task: ${context.task}`);

    const toolCallLog: ToolCallLog[] = [];
    const errors: string[] = [];

    // Build initial message
    const userMessage = `TASK: ${context.task}

URL: ${context.url}
TITLE: ${context.title}

DOM SNAPSHOT:
${context.dom.slice(0, 50000)}

Explore this page to understand how to accomplish the task. Use the tools to probe interactions and understand the page behavior.`;

    const messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userMessage),
    ];

    // Tool calling loop
    let iterations = 0;
    while (iterations < this.maxToolCalls) {
      iterations++;
      logger.info(`Exploration iteration ${iterations}`);

      // Call LLM with tools bound
      const response = await this.llmWithTools.invoke(messages);

      // Check for tool calls
      const toolCalls = response.tool_calls;
      
      if (!toolCalls || toolCalls.length === 0) {
        // No more tool calls - LLM is done planning
        const content = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);
        
        logger.info('Strategy planning complete');
        return {
          strategy: content,
          toolCalls: toolCallLog,
          errors,
        };
      }

      // Add AI message to history
      messages.push(new AIMessage({
        content: response.content,
        tool_calls: toolCalls,
      }));

      // Execute each tool call
      for (const toolCall of toolCalls) {
        const { name, args, id } = toolCall;
        logger.info(`Tool call: ${name}(${JSON.stringify(args)})`);

        let result: string;
        try {
          switch (name) {
            case 'probeClick':
              result = await tools.probeClick(args.selector as string);
              break;
            case 'describeElement':
              result = await tools.describeElement(args.selector as string);
              break;
            case 'scrollAndObserve':
              result = await tools.scrollAndObserve(args.target as string);
              break;
            default:
              result = `Unknown tool: ${name}`;
              errors.push(result);
          }
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(result);
        }

        logger.info(`Tool result: ${result.slice(0, 200)}...`);

        toolCallLog.push({
          tool: name,
          args: args as Record<string, unknown>,
          result,
        });

        // Add tool result to messages
        messages.push(new ToolMessage({
          content: result,
          tool_call_id: id ?? `call_${iterations}_${name}`,
        }));
      }
    }

    // Max iterations reached
    logger.warning(`Max tool calls (${this.maxToolCalls}) reached`);
    errors.push(`Planning stopped after ${this.maxToolCalls} tool calls`);

    // Get final response
    const finalResponse = await this.llm.invoke(messages);
    const content = typeof finalResponse.content === 'string'
      ? finalResponse.content
      : JSON.stringify(finalResponse.content);

    return {
      strategy: content,
      toolCalls: toolCallLog,
      errors,
    };
  }
}

// ============================================================================
// Tool Implementations (for real browser)
// ============================================================================

/**
 * Create real tool implementations that interact with a browser page
 */
export function createBrowserTools(page: Page): PlannerTools {
  return {
    async probeClick(selector: string): Promise<string> {
      try {
        // Store current state
        const beforeUrl = page.url();
        
        // Check if element exists
        const exists = await page.selectorExists(selector);
        if (!exists) {
          return `Element "${selector}" not found on the page.`;
        }

        // Count items before click (for list detection)
        const listSelectors = ['.job-card', '.job-list-item', 'li[data-job-id]', '.search-result'];
        let listSelector = '';
        for (const ls of listSelectors) {
          const count = await page.countSelector(ls);
          if (count > 0) {
            listSelector = ls;
            break;
          }
        }

        // Click the element
        await page.clickSelector(selector);
        
        // Wait a moment for any transitions
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Observe what changed
        const afterUrl = page.url();
        const urlChanged = afterUrl !== beforeUrl;
        
        // Check if list is still present
        let listStillPresent = false;
        if (listSelector) {
          const afterCount = await page.countSelector(listSelector);
          listStillPresent = afterCount > 0;
        }

        // Check for common panel selectors
        const panelSelectors = [
          '.job-details', '.details-panel', '.job-view', 
          '[role="dialog"]', '.modal', '.sidebar-content',
          '.jobs-details', '.job-description'
        ];
        let panelAppeared = '';
        for (const ps of panelSelectors) {
          if (await page.selectorExists(ps)) {
            panelAppeared = ps;
            break;
          }
        }

        // Build description
        const observations: string[] = [];
        observations.push(`Clicked "${selector}".`);
        
        if (urlChanged) {
          observations.push(`URL changed from "${beforeUrl}" to "${afterUrl}".`);
        } else {
          observations.push('URL did not change.');
        }

        if (listStillPresent) {
          observations.push(`The list (${listSelector}) is still visible with items.`);
        } else if (listSelector) {
          observations.push(`The list (${listSelector}) is no longer visible - appears to have navigated away.`);
        }

        if (panelAppeared) {
          observations.push(`A details panel appeared (${panelAppeared}).`);
        }

        // Try to restore state (go back if navigated)
        if (urlChanged && !listStillPresent) {
          await page.goBack();
          await new Promise(resolve => setTimeout(resolve, 500));
          observations.push('Navigated back to restore page state.');
        }

        return observations.join(' ');
      } catch (error) {
        return `Failed to probe click: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    async describeElement(selector: string): Promise<string> {
      try {
        const exists = await page.selectorExists(selector);
        if (!exists) {
          return `Element "${selector}" not found on the page.`;
        }

        // Get text content
        const texts = await page.getTextFromSelector(selector);
        const textPreview = texts.slice(0, 3).join(' | ').slice(0, 500);

        // Count children
        const count = await page.countSelector(`${selector} > *`);

        // Find actual selectors for content elements INSIDE this element
        const contentSelectors: string[] = [];
        const selectorsToCheck = [
          `${selector} h1`, `${selector} h2`, `${selector} h3`,
          `${selector} [class*="title"]`, `${selector} [class*="name"]`,
          `${selector} [class*="company"]`, `${selector} [class*="location"]`,
          `${selector} [class*="description"]`, `${selector} p`,
          `${selector} a`, `${selector} span`
        ];
        
        for (const sel of selectorsToCheck) {
          const elCount = await page.countSelector(sel);
          if (elCount > 0) {
            // Verify there's actual text
            const selTexts = await page.getTextFromSelector(sel);
            if (selTexts.some(t => t.trim().length > 0)) {
              contentSelectors.push(sel);
            }
          }
        }

        let result = `Element "${selector}" contains: "${textPreview}". Has approximately ${count} direct children.`;
        if (contentSelectors.length > 0) {
          result += `\n\nVERIFIED CONTENT SELECTORS (use these for DETAILS_CONTENT):\n${contentSelectors.slice(0, 6).map(s => `  - "${s}"`).join('\n')}`;
        }
        
        return result;
      } catch (error) {
        return `Failed to describe element: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    async scrollAndObserve(target: string): Promise<string> {
      try {
        // Get initial state
        const initialScrollInfo = await page.getScrollInfo();
        const [initialScrollY, , scrollHeight] = initialScrollInfo;

        // Count items before scroll - use more LinkedIn-specific selectors
        const listSelectors = [
          '.job-card-container', '.jobs-search-results__list-item', 
          '.job-card', '.job-list-item', 'li[data-job-id]', '.search-result'
        ];
        let itemCount = 0;
        let itemSelector = '';
        for (const ls of listSelectors) {
          const count = await page.countSelector(ls);
          if (count > 3) { // More than 3 to be considered a list
            itemCount = count;
            itemSelector = ls;
            break;
          }
        }

        // Scroll - handle container vs page
        let scrolledContainer = false;
        if (target !== 'page') {
          // Try to scroll the container element
          try {
            await page.evaluate(`
              const container = document.querySelector('${target.replace(/'/g, "\\'")}');
              if (container) {
                container.scrollBy(0, 500);
              }
            `);
            scrolledContainer = true;
          } catch {
            // Fall back to page scroll
            await page.scrollToNextPage();
          }
        } else {
          await page.scrollToNextPage();
        }

        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Get new state
        const newScrollInfo = await page.getScrollInfo();
        const [newScrollY] = newScrollInfo;
        const scrolled = scrolledContainer || newScrollY > initialScrollY;

        // Count items after scroll
        let newItemCount = 0;
        if (itemSelector) {
          newItemCount = await page.countSelector(itemSelector);
        }

        // Check for pagination
        const paginationSelectors = [
          '.pagination', 'nav[aria-label*="page"]', '.page-numbers',
          'button[aria-label*="next"]', 'a[aria-label*="next"]',
          '.artdeco-pagination', '[data-test-pagination]'  // LinkedIn-specific
        ];
        let hasPagination = false;
        for (const ps of paginationSelectors) {
          if (await page.selectorExists(ps)) {
            hasPagination = true;
            break;
          }
        }

        // Build description
        const observations: string[] = [];
        
        if (scrolled) {
          observations.push(`Scrolled ${target === 'page' ? 'the page' : `within container "${target}"`}.`);
        } else {
          observations.push('Could not scroll further - may be at the end.');
        }

        if (itemSelector) {
          if (newItemCount > itemCount) {
            observations.push(`New items loaded: ${itemCount} → ${newItemCount} items (${newItemCount - itemCount} new).`);
            observations.push('This appears to be infinite scroll behavior.');
          } else {
            observations.push(`Item count unchanged: ${newItemCount} items.`);
          }
        }

        if (hasPagination) {
          observations.push('Pagination controls are present on the page.');
        }

        observations.push(`Scroll position: ${initialScrollY} → ${newScrollY}, total height: ${scrollHeight}.`);

        return observations.join(' ');
      } catch (error) {
        return `Failed to scroll: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

// ============================================================================
// Mock Tool Implementations (for testing)
// ============================================================================

/**
 * Create mock tools that simulate page behavior for testing
 */
export function createMockTools(scenario: 'linkedin' | 'indeed' | 'simple-list'): PlannerTools {
  const scenarios = {
    linkedin: {
      probeClick: async (selector: string) => {
        if (selector.includes('job-card') || selector.includes('job-list-item')) {
          return 'Clicked the first job card. A detail panel slid in from the right side showing full job title, company name, location, and job description. The job list remains visible on the left. URL changed to include ?currentJobId=12345.';
        }
        if (selector.includes('filter') || selector.includes('dropdown')) {
          return 'Clicked the filter button. A dropdown menu appeared with options: Date Posted, Experience Level, Company, Job Type, Remote.';
        }
        return `Clicked "${selector}". Nothing notable happened.`;
      },
      describeElement: async (selector: string) => {
        if (selector.includes('job-card') || selector.includes('list-item')) {
          return 'Element contains: job title "Senior Software Engineer", company "TechCorp", location "San Francisco, CA", posted "2 days ago". Has a small preview but not the full description.';
        }
        if (selector.includes('details') || selector.includes('panel')) {
          return 'Element contains: full job title, company name with logo, location, job type (Full-time), salary range, detailed job description with requirements, skills, and benefits. Has "Apply" and "Save" buttons.';
        }
        return `Element "${selector}" contains generic content.`;
      },
      scrollAndObserve: async () => {
        return 'Scrolled the jobs list. 10 more job cards loaded at the bottom. Total now 35 cards visible (was 25). This is infinite scroll behavior. Scroll position: 0 → 800, total height: 5000.';
      },
    },
    indeed: {
      probeClick: async (selector: string) => {
        if (selector.includes('job') || selector.includes('result')) {
          return 'Clicked the job card. The page navigated to a full job details page. The job list is no longer visible. Only the job details and a "Back to search" link are shown. URL changed to /viewjob?jk=abc123.';
        }
        return `Clicked "${selector}". Nothing notable happened.`;
      },
      describeElement: async (selector: string) => {
        if (selector.includes('job') || selector.includes('card')) {
          return 'Element contains: job title, company name, location, salary (if shown), short snippet of description.';
        }
        return `Element "${selector}" contains generic content.`;
      },
      scrollAndObserve: async (_target: string) => {
        return 'Scrolled the page. No new items loaded. Item count unchanged: 15 items. Pagination controls are present at the bottom of the page with "1 2 3 4 5 ... Next" links.';
      },
    },
    'simple-list': {
      probeClick: async (selector: string) => {
        if (selector.includes('item') || selector.includes('card')) {
          return 'Clicked the item. The card expanded inline to show more details. The list is still visible with the expanded item highlighted.';
        }
        return `Clicked "${selector}". Nothing notable happened.`;
      },
      describeElement: async (selector: string) => {
        return `Element "${selector}" contains simple text content.`;
      },
      scrollAndObserve: async (_target: string) => {
        return 'Scrolled the page. This is a static list with all items already loaded. No new items appeared. 20 total items.';
      },
    },
  };

  return scenarios[scenario];
}

