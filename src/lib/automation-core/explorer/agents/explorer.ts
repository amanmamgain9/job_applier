/**
 * Explorer Agent
 * 
 * Purpose: Navigate and understand the page by clicking, scrolling, and observing.
 * Tools: click, scroll, type_text, observe, done
 * Handoff: 
 *   - click() with url_changed → Classifier
 *   - done() → Summarizer (for each page) → Finish
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';

const SYSTEM_PROMPT = `You are exploring a website to learn how it works.

Interact with the page: click things, scroll around, see what changes. Build understanding through experimentation.

The DOM shows elements in a tree. Clickable elements have [CLICK: "selector"] - use that exact selector.

EXPLORATION STRATEGY:
1. Explore DIFFERENT element types - don't just click job listings repeatedly
2. Try filters, apply buttons, pagination, modals, dropdowns
3. If you've confirmed a pattern (e.g., clicking job listings), move on to other elements
4. Understand the FULL workflow: filtering → selecting → applying

RULES:
1. ONLY use selectors from [CLICK: "..."]. Never invent selectors.
2. Use observe() to refresh the DOM after interactions.
3. Call done() only when you understand multiple interaction types, not just one.`;

function buildExplorerPrompt(
  dom: string,
  memorySummary: string,
  task: string,
  _currentPageId: string | null,
  lastActionResult: string | null,
  discoveryCount: number = 0
): string {
  // Build warning section - put it at the END so LLM sees it right before deciding
  let warningSection = '';
  
  if (lastActionResult && lastActionResult.includes('PATTERN ALREADY CONFIRMED')) {
    // Extract just the warning part
    warningSection += `\n🚨 STOP! You already understand this behavior. Try these DIFFERENT elements:
   - Filter buttons (Date posted, Experience level, etc.)
   - Apply button (see what happens when you apply)
   - Pagination (next page, page numbers)
   - Save/bookmark button
   - Close/dismiss buttons for any open modals\n`;
  }
  
  if (discoveryCount >= 1 && discoveryCount < 3) {
    warningSection += `\n⚠️ You have ${discoveryCount} confirmed pattern(s). Explore MORE element types before calling done().\n`;
  } else if (discoveryCount >= 3) {
    warningSection += `\n✅ You have ${discoveryCount} confirmed patterns. You can call done() if you understand the page workflow.\n`;
  }

  // Simpler prompt structure:
  // 1. Task
  // 2. Memory (what you've learned)
  // 3. DOM (current page state)  
  // 4. Tools
  // 5. Last action result + warnings (MOST RECENT, RIGHT BEFORE DECISION)
  
  const lastActionSection = lastActionResult 
    ? `LAST ACTION:\n${lastActionResult}\n`
    : '';

  return `TASK: ${task}

${memorySummary}

CURRENT DOM:
${dom}

TOOLS:
- click(selector, reason) - click element with [CLICK: "selector"]
- scroll(direction, reason) - "down" or "up"  
- type_text(selector, text, reason) - type into input
- observe(what) - refresh DOM
- done(understanding, page_type, key_findings) - finish exploration

${lastActionSection}${warningSection}
What action will you take next?`;
}

// Tool definitions
const explorerTools = [
  {
    type: 'function' as const,
    function: {
      name: 'click',
      description: 'Click an element. May open modals, navigate, toggle state, or load content.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector - copy exactly from [CLICK: "..."] in the DOM',
          },
          reason: {
            type: 'string',
            description: 'What you expect to learn or happen',
          },
        },
        required: ['selector', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'scroll',
      description: 'Scroll to reveal more content, pagination, or hidden elements below/above the fold.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['down', 'up'],
            description: 'Direction to scroll',
          },
          reason: {
            type: 'string',
            description: 'What you hope to find',
          },
        },
        required: ['direction', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'type_text',
      description: 'Type text into an input field',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector of the input',
          },
          text: {
            type: 'string',
            description: 'Text to type',
          },
          reason: {
            type: 'string',
            description: 'Why you are typing this',
          },
        },
        required: ['selector', 'text', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'observe',
      description: 'Get a fresh snapshot of the DOM. Use after actions that might have changed content without navigation.',
      parameters: {
        type: 'object',
        properties: {
          what: {
            type: 'string',
            description: 'What changed you want to see (e.g., "modal contents", "updated list", "new panel")',
          },
        },
        required: ['what'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'done',
      description: 'Call when you understand enough to explain how to accomplish the task on this site.',
      parameters: {
        type: 'object',
        properties: {
          understanding: {
            type: 'string',
            description: 'Full explanation of how the site works and how to accomplish the task',
          },
          page_type: {
            type: 'string',
            description: 'What kind of page this is (e.g., search results, listing, form)',
          },
          key_findings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific discoveries: what buttons do, how navigation works, what filters exist, etc.',
          },
          key_elements: {
            type: 'object',
            description: 'Important selectors discovered during exploration. Include any you found for: filter_button, apply_button, job_listings (array), search_input, pagination, close_button',
            properties: {
              filter_button: { type: 'string', description: 'Selector that opens the filter modal/dropdown' },
              apply_button: { type: 'string', description: 'Selector for the apply/submit button' },
              job_listings: { 
                type: 'array', 
                items: { type: 'string' },
                description: 'Selectors for individual job listing items (first few examples)' 
              },
              search_input: { type: 'string', description: 'Selector for the search input field' },
              pagination: { type: 'string', description: 'Selector for pagination controls' },
            },
          },
        },
        required: ['understanding', 'page_type', 'key_findings'],
      },
    },
  },
];

export interface KeyElements {
  filter_button?: string;
  apply_button?: string;
  job_listings?: string[];
  search_input?: string;
  pagination?: string;
  [key: string]: string | string[] | undefined;  // Allow additional elements
}

export type ExplorerAction = 
  | { type: 'click'; selector: string; reason: string }
  | { type: 'scroll'; direction: 'down' | 'up'; reason: string }
  | { type: 'type_text'; selector: string; text: string; reason: string }
  | { type: 'observe'; what: string }
  | { type: 'done'; understanding: string; pageType: string; keyFindings: string[]; keyElements?: KeyElements };

export interface ExplorerOptions {
  llm: BaseChatModel;
  dom: string;
  memorySummary: string;
  task: string;
  currentPageId: string | null;
  lastActionResult?: string | null; // Result of the previous action - shown prominently
  discoveryCount?: number; // Number of discoveries made so far - used to encourage synthesis
  conversationHistory?: BaseMessage[];
  loopWarning?: string; // Set if same action was repeated 3+ times
  report?: { log: (msg: string) => void }; // Optional report for logging prompts
}

export interface ExplorerDecision {
  action: ExplorerAction;
  rawResponse: AIMessage;
}

export async function runExplorer(options: ExplorerOptions): Promise<ExplorerDecision> {
  const { llm, dom, memorySummary, task, currentPageId, lastActionResult = null, discoveryCount = 0, conversationHistory = [], loopWarning, report } = options;

  // Defensive check for undefined dom
  const safeDom = dom || '';
  
  // Build the prompt with last action result prominently displayed
  let prompt = buildExplorerPrompt(safeDom.slice(0, 60000), memorySummary, task, currentPageId, lastActionResult, discoveryCount);
  
  // If loop detected, add a strong warning
  if (loopWarning) {
    prompt += `\n\n⚠️ LOOP DETECTED: You have tried "${loopWarning}" multiple times with no visible effect. This element may already be selected, broken, or require a different approach. PICK A DIFFERENT ELEMENT OR ACTION.`;
  }

  // Log the full prompt for debugging - show beginning AND end to see warnings
  const promptStart = prompt.slice(0, 2000);
  const promptEnd = prompt.slice(-1500);
  report?.log(`[EXPLORER PROMPT START]\n${promptStart}\n...[MIDDLE TRUNCATED]...\n${promptEnd}\n[EXPLORER PROMPT END]`);

  // Build messages - start fresh each time with memory summary
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_PROMPT),
    ...conversationHistory,
    new HumanMessage(prompt),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelWithTools = (llm as any).bindTools(explorerTools);
  
  report?.log(`[EXPLORER] About to invoke LLM with ${messages.length} messages`);
  
  let response: AIMessage;
  try {
    response = await modelWithTools.invoke(messages) as AIMessage;
  } catch (invokeError) {
    report?.log(`[EXPLORER ERROR] LLM invoke failed: ${invokeError}`);
    return {
      action: { type: 'observe', what: 'page after LLM error' },
      rawResponse: new AIMessage(''),
    };
  }

  // Defensive check for undefined response
  if (!response) {
    report?.log(`[EXPLORER ERROR] LLM returned undefined response`);
    return {
      action: { type: 'observe', what: 'page after empty LLM response' },
      rawResponse: new AIMessage(''),
    };
  }

  report?.log(`[EXPLORER] LLM response received. tool_calls: ${JSON.stringify(response.tool_calls?.map(tc => tc.name) || 'none')}`);

  // Extract tool call
  const toolCalls = response.tool_calls;
  const toolCall = toolCalls && toolCalls.length > 0 ? toolCalls[0] : null;
  if (!toolCall) {
    report?.log(`[EXPLORER] No tool call in response, defaulting to observe`);
    // No tool call - treat as observe request
    return {
      action: { type: 'observe', what: 'page' },
      rawResponse: response,
    };
  }

  // Parse the tool call into an action
  const action = parseToolCall(toolCall);
  
  return {
    action,
    rawResponse: response,
  };
}

function parseToolCall(toolCall: { name: string; args: Record<string, unknown> }): ExplorerAction {
  switch (toolCall.name) {
    case 'click':
      return {
        type: 'click',
        selector: toolCall.args.selector as string,
        reason: toolCall.args.reason as string,
      };
    case 'scroll':
      return {
        type: 'scroll',
        direction: toolCall.args.direction as 'down' | 'up',
        reason: toolCall.args.reason as string,
      };
    case 'type_text':
      return {
        type: 'type_text',
        selector: toolCall.args.selector as string,
        text: toolCall.args.text as string,
        reason: toolCall.args.reason as string,
      };
    case 'observe':
      return {
        type: 'observe',
        what: toolCall.args.what as string,
      };
    case 'done':
      return {
        type: 'done',
        understanding: toolCall.args.understanding as string,
        pageType: toolCall.args.page_type as string,
        keyFindings: (toolCall.args.key_findings as string[]) || [],
        keyElements: (toolCall.args.key_elements as KeyElements) || undefined,
      };
    default:
      return { type: 'observe', what: 'page' };
  }
}

