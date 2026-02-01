/**
 * Discovery Agent
 * 
 * Per-step decision maker for the Discovery Loop.
 * Decides: explore (click/scroll) or done (finish exploration).
 * 
 * Uses Gemini's function calling with minimal thinking for speed.
 */

import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  SchemaType,
  type EnumStringSchema,
  type SimpleStringSchema,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type FunctionDeclarationsTool,
} from '@google/generative-ai';
import { createLogger } from '../../utils/logger';
import { HandoffInput, HandoffOutput } from './types/handoff';

const logger = createLogger('DiscoveryAgent');

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are exploring a webpage to understand how it works and how to complete the task on this page thoroughly, if possible.

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

// ============================================================================
// Types
// ============================================================================

export type DiscoveryAction =
  | { type: 'explore'; action: 'click' | 'scroll_down' | 'scroll_up'; target?: string; reason: string }
  | { type: 'done'; understanding: string; keyElements: Record<string, string | string[]> };

export interface DiscoveryDecision {
  action: DiscoveryAction;
}

export interface DiscoveryAgentContext {
  apiKey: string;
  model?: string;
  task: string;
  goals?: string[];
  currentDom: string;
  memorySummary: string;
  actionHistory: string[];
  confirmedPatternCount: number;
}

// ============================================================================
// Tool Schemas
// ============================================================================

const actionSchema = {
  type: SchemaType.STRING,
  format: 'enum',
  enum: ['click', 'scroll_down', 'scroll_up'],
  description: 'What action to take. Use click for interactive elements, scroll to see more content.',
} satisfies EnumStringSchema;

const targetSchema = {
  type: SchemaType.STRING,
  description: 'CSS selector for click - copy EXACTLY from [CLICK: "..."] in the DOM. Not needed for scroll.',
} satisfies SimpleStringSchema;

const reasonSchema = {
  type: SchemaType.STRING,
  description: 'Why you are taking this action',
} satisfies SimpleStringSchema;

const exploreParameters: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    action: actionSchema,
    target: targetSchema,
    reason: reasonSchema,
  },
  required: ['action', 'reason'],
};

const understandingSchema = {
  type: SchemaType.STRING,
  description: 'How the page works and how to complete the task',
} satisfies SimpleStringSchema;

const keyElementsSchema = {
  type: SchemaType.OBJECT,
  description: 'Important selectors discovered (use meaningful keys)',
  properties: {
    example_key: {
      type: SchemaType.STRING,
      description: 'Example key for a discovered selector',
    },
  },
} satisfies FunctionDeclarationSchema['properties'][string];

const doneParameters: FunctionDeclarationSchema = {
  type: SchemaType.OBJECT,
  properties: {
    understanding: understandingSchema,
    key_elements: keyElementsSchema,
  },
  required: ['understanding', 'key_elements'],
};

const exploreDeclaration: FunctionDeclaration = {
  name: 'explore',
  description: 'Take an action on the page. After this, the system automatically analyzes what changed.',
  parameters: exploreParameters,
};

const doneDeclaration: FunctionDeclaration = {
  name: 'done',
  description: 'Finish exploration. Call when you understand the page workflows needed for the task.',
  parameters: doneParameters,
};

const discoveryTools: FunctionDeclarationsTool[] = [{
  functionDeclarations: [exploreDeclaration, doneDeclaration],
}];

// ============================================================================
// Helper: Build Context Summary (inlined from old discoverer)
// ============================================================================

async function buildContextSummary(
  apiKey: string,
  model: string,
  task: string,
  goals: string[] | undefined,
  memorySummary: string,
  actionHistory: string[]
): Promise<string> {
  const goalsStr = goals && goals.length > 0
    ? goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')
    : '(no explicit goals)';

  const historyStr = actionHistory && actionHistory.length > 0
    ? actionHistory.slice(-15).map((a, i) => `${i + 1}. ${a}`).join('\n')
    : '(no actions yet)';

  const prompt = `TASK: ${task}

GOALS:
${goalsStr}

MEMORY SUMMARY:
${memorySummary || '(no memory yet)'}

ACTION HISTORY:
${historyStr}

Write a brief discovery summary: what we've learned so far about achieving each goal.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: `You are a discovery writer. Convert observed actions and analysis summaries into a human-readable explanation of how to achieve the goals on this page.

Requirements:
- Write goal-by-goal, matching the provided goals list.
- Keep it concise and practical, like instructions to another human.
- Use only what was observed in the action history and memory summary.
- If a goal is not yet supported by evidence, say "Unknown so far".
- Do NOT output selectors or code.`,
  });

  const result = await genModel.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
    generationConfig: {
      // @ts-expect-error - thinkingConfig is a Gemini 3 feature not yet in types
      thinkingConfig: {
        thinkingLevel: 'minimal',
      },
    },
  });

  const text = result.response.text();
  return text?.trim() || '';
}

// ============================================================================
// Helper: Build Prompt
// ============================================================================

function buildPrompt(
  task: string,
  goals: string[] | undefined,
  discoverySummary: string,
  currentDom: string,
  memorySummary: string,
  actionHistory: string[],
  confirmedPatternCount: number
): string {
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

DISCOVERY SUMMARY:
${discoverySummary || '(no discovery yet)'}

${memorySummary || '(no memory yet)'}

RECENT ACTIONS:
${historyStr}
${statusNote}

CURRENT DOM:
${domSlice}

What's your next move? Call explore() or done().`;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runStepDecider(
  input: HandoffInput<DiscoveryAgentContext>
): Promise<HandoffOutput<DiscoveryDecision>> {
  const { goal, context } = input;
  
  if (!context) {
    return {
      goalCompleted: false,
      reason: 'No context provided to discovery agent',
    };
  }
  
  const { 
    apiKey, 
    model = 'gemini-3-flash-preview', 
    task, 
    goals, 
    currentDom, 
    memorySummary, 
    actionHistory, 
    confirmedPatternCount 
  } = context;
  
  logger.info('runDiscoveryAgent called', {
    goal,
    hasApiKey: !!apiKey,
    model,
    hasTask: !!task,
    hasDom: !!currentDom,
    domLength: currentDom?.length,
    hasActionHistory: !!actionHistory,
    actionHistoryLength: actionHistory?.length,
  });
  
  try {
    // Initialize Google's native SDK
    const genAI = new GoogleGenerativeAI(apiKey);
    const genModel = genAI.getGenerativeModel({ 
      model,
      systemInstruction: SYSTEM_PROMPT,
      tools: discoveryTools,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          allowedFunctionNames: ['explore', 'done'],
        },
      },
    });
    
    // Build context summary (inlined from old discoverer)
    const discoverySummary = await buildContextSummary(
      apiKey, model, task, goals, memorySummary, actionHistory
    );

    const prompt = buildPrompt(
      task, goals, discoverySummary, currentDom, memorySummary, actionHistory, confirmedPatternCount
    );
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
          thinkingLevel: 'minimal',
        },
      },
    });
    
    const response = result.response;
    logger.info('Gemini response received');
    
    // Check for function call
    const functionCall = response.functionCalls()?.[0];
    
    if (!functionCall) {
      const text = response.text();
      logger.error('No function call in response', { text: text?.slice(0, 500) });
      return {
        goalCompleted: false,
        reason: 'Discovery agent did not call a tool - invalid response',
      };
    }
    
    logger.info('Function call received', { 
      name: functionCall.name, 
      args: functionCall.args 
    });
    
    const action = parseToolCall(functionCall);
    return {
      goalCompleted: true,
      result: { action },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Discovery agent error', { error: errorMsg });
    return {
      goalCompleted: false,
      reason: errorMsg,
    };
  }
}

// ============================================================================
// Helper: Parse Tool Call
// ============================================================================

function parseToolCall(functionCall: { name: string; args: object }): DiscoveryAction {
  logger.info('parseToolCall', { name: functionCall.name, args: functionCall.args });
  
  switch (functionCall.name) {
    case 'explore': {
      const args = functionCall.args as Record<string, unknown>;
      const action = args.action as string;
      if (!['click', 'scroll_down', 'scroll_up'].includes(action)) {
        throw new Error(`Invalid action "${action}" - must be click, scroll_down, or scroll_up`);
      }
      return {
        type: 'explore',
        action: action as 'click' | 'scroll_down' | 'scroll_up',
        target: args.target as string | undefined,
        reason: (args.reason as string) || 'No reason provided',
      };
    }
    case 'done':
      return {
        type: 'done',
        understanding: (functionCall.args as Record<string, unknown>).understanding as string || 'No understanding provided',
        keyElements: ((functionCall.args as Record<string, unknown>).key_elements as Record<string, string | string[]>) || {},
      };
    default:
      throw new Error(`Unknown tool "${functionCall.name}"`);
  }
}


