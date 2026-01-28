/**
 * Manager Agent (using native Google SDK)
 * 
 * Hierarchical coordinator that dispatches workers.
 * Uses Gemini's function calling with minimal thinking for speed.
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Manager');

const SYSTEM_PROMPT = `You are exploring a webpage to understand how it works and how to complete the task on this page throughly, if possible.

YOUR TOOLS:
1. explore(action, target?, reason) - Take an action on the page
   - action: "click", "scroll_down", "scroll_up"
   - target: CSS selector (required for click, copy exactly from [CLICK: "..."] in DOM)
   - reason: Why you're doing this
   - NOTE: After explore(), the system automatically analyzes what changed

2. done(understanding, key_elements) - Finish exploration
  - understanding: How the page works and what workflows are possible
  - key_elements: Important selectors you discovered

EXPLORATION PRINCIPLES:
- Focus on the TASK. Once you have enough evidence to answer it, stop.
- Use GOALS as a checklist, and use action history + analysis summaries to decide when they're answered.
- Avoid repetitive scrolling when analysis reports "No visible changes".
- If you repeat the same action twice with no new information, choose a different action or call done().

OUTPUT RULE:
- Your final understanding MUST be structured goal-by-goal (one concise finding per goal).

STOP CONDITIONS:
- The action history already contains evidence for the task
- You have identified the key interactive elements needed for the task.
- Recent actions produced no new information.

CRITICAL RULES:
- ALWAYS call a tool - never respond without calling explore() or done()
- Only use selectors from [CLICK: "..."] in the DOM
- Avoid paths of duplicate information.
`;


export type ManagerAction =
  | { type: 'explore'; action: 'click' | 'scroll_down' | 'scroll_up'; target?: string; reason: string }
  | { type: 'done'; understanding: string; keyElements: Record<string, string | string[]> };

// Tool definitions for Gemini native SDK
const managerTools = [{
  functionDeclarations: [
    {
      name: 'explore',
      description: 'Take an action on the page. After this, the system automatically analyzes what changed.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          action: {
            type: SchemaType.STRING,
            enum: ['click', 'scroll_down', 'scroll_up'],
            description: 'What action to take. Use click for interactive elements, scroll to see more content.',
          },
          target: {
            type: SchemaType.STRING,
            description: 'CSS selector for click - copy EXACTLY from [CLICK: "..."] in the DOM. Not needed for scroll.',
          },
          reason: {
            type: SchemaType.STRING,
            description: 'Why you are taking this action',
          },
        },
        required: ['action', 'reason'],
      },
    },
    {
      name: 'done',
      description: 'Finish exploration. Call when you understand the page workflows needed for the task.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          understanding: {
            type: SchemaType.STRING,
            description: 'How the page works and how to complete the task',
          },
          key_elements: {
            type: SchemaType.OBJECT,
            description: 'Important selectors discovered (use meaningful keys)',
          },
        },
        required: ['understanding', 'key_elements'],
      },
    },
  ],
}];

export interface ManagerOptions {
  apiKey: string;
  model?: string;
  task: string;
  goals?: string[];
  currentDom: string;
  memorySummary: string;
  actionHistory: string[];
  confirmedPatternCount: number;
}

export interface ManagerDecision {
  action: ManagerAction;
}

function buildPrompt(options: ManagerOptions): string {
  const { task, goals, currentDom, memorySummary, actionHistory, confirmedPatternCount } = options;
  
  logger.info('buildPrompt inputs', {
    hasTask: !!task,
    hasDom: !!currentDom,
    domLength: currentDom?.length,
    hasActionHistory: !!actionHistory,
    actionHistoryLength: actionHistory?.length,
  });
  
  const historyStr = actionHistory && actionHistory.length > 0
    ? actionHistory.slice(-10).map((a, i) => `${i + 1}. ${a}`).join('\n')
    : '(no actions yet)';
  
  let statusNote = '';
  if (confirmedPatternCount >= 3) {
    statusNote = `\n✅ You have ${confirmedPatternCount} confirmed patterns. You can call done() if you understand the workflow.`;
  } else if (confirmedPatternCount >= 1) {
    statusNote = `\n⚠️ You have ${confirmedPatternCount} confirmed pattern(s). Explore more element types before calling done().`;
  }

  const domSlice = currentDom ? currentDom.slice(0, 50000) : '(no DOM available)';

  const goalsStr = goals && goals.length > 0
    ? goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')
    : '(no explicit goals)';

  return `TASK: ${task}

GOALS:
${goalsStr}

${memorySummary || '(no memory yet)'}

RECENT ACTIONS:
${historyStr}
${statusNote}

CURRENT DOM:
${domSlice}

What's your next move? Call explore() or done().`;
}

export async function runManager(options: ManagerOptions): Promise<ManagerDecision> {
  const { apiKey, model = 'gemini-3-flash-preview', task, currentDom, actionHistory } = options;
  
  logger.info('runManager called', {
    hasApiKey: !!apiKey,
    model,
    hasTask: !!task,
    hasDom: !!currentDom,
    domLength: currentDom?.length,
    hasActionHistory: !!actionHistory,
    actionHistoryLength: actionHistory?.length,
  });
  
  // Initialize Google's native SDK
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ 
    model,
    systemInstruction: SYSTEM_PROMPT,
    tools: managerTools,
    toolConfig: {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: ['explore', 'done'],
      },
    },
  });
  
  const prompt = buildPrompt(options);
  logger.info('Prompt built', { promptLength: prompt.length });
  
  logger.info('Invoking Gemini with function calling...');
  
  // Use minimal thinking for speed (Gemini 3 feature)
  const result = await genModel.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
    generationConfig: {
      // @ts-expect-error - thinkingConfig is a Gemini 3 feature not yet in types
      thinkingConfig: {
        thinkingLevel: 'minimal',  // No deep thinking, just respond
      },
    },
  });
  
  const response = result.response;
  logger.info('Gemini response received');
  
  // Check for function call
  const functionCall = response.functionCalls()?.[0];
  
  if (!functionCall) {
    // No function call - check if there's text content
    const text = response.text();
    logger.error('No function call in response', { text: text?.slice(0, 500) });
    throw new Error('Manager did not call a tool - invalid response');
  }
  
  logger.info('Function call received', { 
    name: functionCall.name, 
    args: functionCall.args 
  });
  
  const action = parseToolCall(functionCall);
  return { action };
}

function parseToolCall(functionCall: { name: string; args: Record<string, unknown> }): ManagerAction {
  logger.info('parseToolCall', { name: functionCall.name, args: functionCall.args });
  
  switch (functionCall.name) {
    case 'explore': {
      const action = functionCall.args.action as string;
      if (!['click', 'scroll_down', 'scroll_up'].includes(action)) {
        throw new Error(`Invalid action "${action}" - must be click, scroll_down, or scroll_up`);
      }
      return {
        type: 'explore',
        action: action as 'click' | 'scroll_down' | 'scroll_up',
        target: functionCall.args.target as string | undefined,
        reason: (functionCall.args.reason as string) || 'No reason provided',
      };
    }
    case 'done':
      return {
        type: 'done',
        understanding: (functionCall.args.understanding as string) || 'No understanding provided',
        keyElements: (functionCall.args.key_elements as Record<string, string | string[]>) || {},
      };
    default:
      throw new Error(`Unknown tool "${functionCall.name}"`);
  }
}
