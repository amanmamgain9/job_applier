/**
 * Discovery Summarizer
 * 
 * Compresses raw observations into concise page understanding.
 * Called at the end of discovery to consolidate what was learned.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { HandoffInput, HandoffOutput } from './types/handoff';

// ============================================================================
// Types
// ============================================================================

export interface DiscoverySummarizerContext {
  llm: BaseChatModel;
  pageId: string;
  observations: string[];
  currentUnderstanding: string;
}

export interface DiscoverySummarizerResult {
  pageId: string;
  summary: string;
}

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a page summarizer. Your job is to condense observations about a web page into a clear, concise summary.

Focus on:
- What the page is for
- Key interactive elements (buttons, forms, lists)
- What happens when you interact with things
- How to navigate to/from this page

Be concise but complete. Call summarize() with your summary.`;

// ============================================================================
// Tool Definition
// ============================================================================

const summarizeTool = {
  type: 'function' as const,
  function: {
    name: 'summarize',
    description: 'Provide the final summary for this page.',
    parameters: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'The page ID being summarized',
        },
        summary: {
          type: 'string',
          description: 'Condensed understanding of the page',
        },
      },
      required: ['page_id', 'summary'],
    },
  },
};

// ============================================================================
// Helper: Build Prompt
// ============================================================================

function buildPrompt(
  pageId: string,
  observations: string[],
  currentUnderstanding: string
): string {
  const observationsStr = observations.length > 0
    ? observations.map((o, i) => `${i + 1}. ${o}`).join('\n')
    : '(no additional observations)';

  return `Page: ${pageId}

Current understanding:
${currentUnderstanding}

Additional observations:
${observationsStr}

Provide a condensed summary that incorporates all observations into a coherent understanding of this page.`;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runSummarizer(
  input: HandoffInput<DiscoverySummarizerContext>
): Promise<HandoffOutput<DiscoverySummarizerResult>> {
  const { context } = input;
  
  if (!context) {
    return {
      goalCompleted: false,
      reason: 'No context provided to summarizer',
    };
  }
  
  const { llm, pageId, observations, currentUnderstanding } = context;

  // If no observations, just return current understanding
  if (observations.length === 0) {
    return {
      goalCompleted: true,
      result: { pageId, summary: currentUnderstanding },
    };
  }

  try {
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(buildPrompt(pageId, observations, currentUnderstanding)),
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelWithTools = (llm as any).bindTools([summarizeTool]);
    const response = await modelWithTools.invoke(messages) as AIMessage;

    // Extract tool call
    const toolCall = response.tool_calls?.[0];
    if (!toolCall || toolCall.name !== 'summarize') {
      // Fallback: use current understanding + first observation
      return {
        goalCompleted: true,
        result: {
          pageId,
          summary: currentUnderstanding + (observations[0] ? ` ${observations[0]}` : ''),
        },
      };
    }

    const args = toolCall.args as {
      page_id: string;
      summary: string;
    };

    return {
      goalCompleted: true,
      result: {
        pageId: args.page_id,
        summary: args.summary,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      goalCompleted: false,
      result: {
        pageId,
        summary: currentUnderstanding,
      },
      reason: errorMsg,
    };
  }
}


