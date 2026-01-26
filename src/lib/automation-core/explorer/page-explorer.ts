/**
 * Page Explorer - LLM explores pages using tools
 * 
 * Flow:
 * 1. Give LLM the initial page state and tools
 * 2. LLM calls a tool (click, observe, scroll, etc.)
 * 3. We execute the tool and return the result
 * 4. Repeat until LLM calls 'done' with its understanding
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { Page } from '../browser/page';
import type { ReportService } from '../reporting';
import { ToolExecutor } from './tool-executor';
import { domTreeToString } from '../utils/dom-to-text';
import { createLogger } from '../utils/logger';
import type { 
  ExplorerResult, 
  ExplorationStep, 
  ToolCall,
  DoneArgs,
} from './types';

const logger = createLogger('PageExplorer');

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You explore web pages by clicking and observing. Be thorough.`;

function buildUserMessage(url: string, _title: string, dom: string, task: string): string {
  return `You are exploring a website to understand how to accomplish this task:
"${task}"

Starting URL: ${url}

${dom}

TOOLS:
- click(selector, reason) - selector MUST be copied exactly from [CLICK: "..."]
- observe(what) - refresh DOM to see current page state
- scroll(direction, reason) - see more content
- done(understanding, page_type, key_findings) - when you've explored enough

RULES:
1. ONLY use selectors from the LATEST DOM - copy exactly from [CLICK: "..."]
2. If click fails: call observe() to get fresh selectors, then try again
3. After clicking, call observe() to see what changed

EXPLORATION STRATEGY:
- You can click anything - navigate freely to understand the site
- If you navigate to a new page, explore it, then use browser back or click links to return
- When something opens (modal, panel, sidebar), observe() to see its contents
- Keep your task in mind - look for paths that help accomplish it

WHAT TO DISCOVER:
- How to reach the functionality needed for the task
- What filters, search, or navigation options exist
- What happens when you interact with list items, buttons, forms
- The overall site structure and navigation patterns

When you feel you understand enough to accomplish the task, call done() with:
- Your understanding of how the site works
- The page type and key features
- How someone would accomplish the task`;
}

// ============================================================================
// Types
// ============================================================================

export interface ExplorePageOptions {
  page: Page;
  task: string;
  llm: BaseChatModel;
  report?: ReportService;
  maxSteps?: number;
}

// ============================================================================
// Main Function
// ============================================================================

export async function explorePage(options: ExplorePageOptions): Promise<ExplorerResult> {
  const { page, task, llm, report, maxSteps = 10 } = options;
  
  logger.info('Starting page exploration for task:', task);
  // Note: caller (discovery.ts) already starts the step, we just add actions
  
  const toolExecutor = new ToolExecutor(page, report);
  const explorationLog: ExplorationStep[] = [];
  const messages: (SystemMessage | HumanMessage | AIMessage)[] = [];
  
  try {
    // Get initial page state
    report?.startAction('Getting initial page state');
    const initialState = await page.getState();
    if (!initialState.elementTree) {
      report?.endAction(false, 'Failed to get DOM');
      return {
        success: false,
        understanding: '',
        pageType: 'unknown',
        keyFindings: '',
        explorationLog,
        error: 'Failed to get initial page state',
      };
    }
    report?.endAction(true);
    
    const initialDom = domTreeToString(initialState.elementTree, { includeSelectors: true });
    
    // Start conversation with LLM
    messages.push(new SystemMessage(SYSTEM_PROMPT));
    messages.push(new HumanMessage(buildUserMessage(
      initialState.url,
      initialState.title,
      initialDom.slice(0, 80000),
      task
    )));
    
    // Exploration loop
    for (let step = 0; step < maxSteps; step++) {
      logger.info(`Exploration step ${step + 1}/${maxSteps}`);
      
      // Call LLM with tool definitions
      report?.startAction('Asking LLM for next action');
      // Use bind to attach tools to the model
      const modelWithTools = llm.bind({ tools: getToolDefinitions() } as Record<string, unknown>);
      const response = await modelWithTools.invoke(messages);
      report?.endAction(true);
      
      // Check if LLM made tool calls
      const toolCalls = extractToolCalls(response);
      
      if (toolCalls.length === 0) {
        // No tool calls - LLM responded with text
        const content = typeof response.content === 'string' ? response.content : '';
        logger.info('LLM responded without tool call:', content.slice(0, 100));
        messages.push(new AIMessage(content));
        messages.push(new HumanMessage('Please use one of the available tools to explore the page or call "done" if you have a complete understanding.'));
        continue;
      }
      
      // Process each tool call
      for (const toolCall of toolCalls) {
        logger.info(`Tool call: ${toolCall.name}`, toolCall.arguments);
        
        // Check if done
        if (toolCall.name === 'done') {
          const args = toolCall.arguments as unknown as DoneArgs;
          
          report?.addPhaseOutput('exploration', args.understanding, true, 0);
          
          return {
            success: true,
            understanding: args.understanding,
            pageType: args.page_type,
            keyFindings: args.key_findings,
            explorationLog,
          };
        }
        
        // Execute the tool
        const result = await toolExecutor.execute(toolCall);
        
        // Log the step
        explorationLog.push({
          action: toolCall.name,
          reason: String(toolCall.arguments.reason || toolCall.arguments.what || ''),
          result: result.observation,
          timestamp: Date.now(),
        });
        
        // Add to conversation
        messages.push(new AIMessage({
          content: '',
          tool_calls: [{
            id: `call_${step}_${toolCall.name}`,
            name: toolCall.name,
            args: toolCall.arguments,
          }],
        }));
        
        // Add tool result
        const toolResultContent = result.success 
          ? `${result.observation}\n\nUpdated page structure:\n${result.dom || '(no DOM returned)'}`
          : `Error: ${result.error}`;
        
        messages.push(new HumanMessage({
          content: toolResultContent,
        }));
      }
    }
    
    // Max steps reached
    logger.info('Max exploration steps reached');
    
    return {
      success: false,
      understanding: 'Exploration incomplete - max steps reached',
      pageType: 'unknown',
      keyFindings: explorationLog.map(s => s.result).join('\n'),
      explorationLog,
      error: 'Max exploration steps reached',
    };
    
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Exploration failed:', error);
    
    return {
      success: false,
      understanding: '',
      pageType: 'unknown',
      keyFindings: '',
      explorationLog,
      error,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getToolDefinitions() {
  // Return tool definitions in the format expected by LangChain
  return [
    {
      type: 'function' as const,
      function: {
        name: 'click',
        description: 'Click on an element to see what happens. After clicking, you will receive the updated page state.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector for the element to click' },
            reason: { type: 'string', description: 'Why you are clicking this - what do you expect to learn?' },
          },
          required: ['selector', 'reason'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'observe',
        description: 'Get the current state of the page or a specific section.',
        parameters: {
          type: 'object',
          properties: {
            what: { type: 'string', description: 'What are you trying to observe or understand?' },
            selector: { type: 'string', description: 'Optional CSS selector to focus on a specific part' },
          },
          required: ['what'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'scroll',
        description: 'Scroll the page or a container to see more content.',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['up', 'down'], description: 'Direction to scroll' },
            reason: { type: 'string', description: 'Why you are scrolling' },
            selector: { type: 'string', description: 'Optional CSS selector for a scrollable container' },
          },
          required: ['direction', 'reason'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'type_text',
        description: 'Type text into an input field.',
        parameters: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector for the input element' },
            text: { type: 'string', description: 'Text to type' },
            reason: { type: 'string', description: 'Why you are typing this' },
          },
          required: ['selector', 'text', 'reason'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'done',
        description: 'Call this when you have fully understood the page.',
        parameters: {
          type: 'object',
          properties: {
            understanding: { type: 'string', description: 'Your complete understanding of how the page works' },
            page_type: { type: 'string', description: 'Type of page (job_listings, search_results, login, form, etc.)' },
            key_findings: { type: 'string', description: 'Most important discoveries (e.g., "clicking job shows details panel")' },
          },
          required: ['understanding', 'page_type', 'key_findings'],
        },
      },
    },
  ];
}

function extractToolCalls(response: { content: unknown; tool_calls?: unknown[] }): ToolCall[] {
  // Handle different response formats from LangChain
  if (response.tool_calls && Array.isArray(response.tool_calls)) {
    return response.tool_calls.map((tc: unknown) => {
      const toolCall = tc as { name?: string; args?: Record<string, unknown> };
      return {
        name: toolCall.name || '',
        arguments: toolCall.args || {},
      };
    });
  }
  
  // Try to extract from content if it's a function call format
  if (typeof response.content === 'string') {
    // Try to parse tool calls from text (some models output JSON)
    try {
      const match = response.content.match(/\{[\s\S]*"name"[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.name) {
          return [{ name: parsed.name, arguments: parsed.arguments || parsed.args || {} }];
        }
      }
    } catch {
      // Not JSON, ignore
    }
  }
  
  return [];
}

