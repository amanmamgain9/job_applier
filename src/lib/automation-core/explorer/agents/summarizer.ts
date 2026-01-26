/**
 * Summarizer Agent
 * 
 * Purpose: Compress raw observations into concise page understanding.
 * Tool: summarize()
 * Handoff: Returns to orchestrator after summarization
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

const SYSTEM_PROMPT = `You are a page summarizer. Your job is to condense observations about a web page into a clear, concise summary.

Focus on:
- What the page is for
- Key interactive elements (buttons, forms, lists)
- What happens when you interact with things
- How to navigate to/from this page

Be concise but complete. Call summarize() with your summary.`;

function buildSummarizerPrompt(
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

export interface SummarizerOptions {
  llm: BaseChatModel;
  pageId: string;
  observations: string[];
  currentUnderstanding: string;
}

export interface SummarizerResult {
  pageId: string;
  summary: string;
}

export async function runSummarizer(options: SummarizerOptions): Promise<SummarizerResult> {
  const { llm, pageId, observations, currentUnderstanding } = options;

  // If no observations, just return current understanding
  if (observations.length === 0) {
    return { pageId, summary: currentUnderstanding };
  }

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(buildSummarizerPrompt(pageId, observations, currentUnderstanding)),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelWithTools = (llm as any).bindTools([summarizeTool]);
  const response = await modelWithTools.invoke(messages) as AIMessage;

  // Extract tool call
  const toolCall = response.tool_calls?.[0];
  if (!toolCall || toolCall.name !== 'summarize') {
    // Fallback: use current understanding + first observation
    return {
      pageId,
      summary: currentUnderstanding + (observations[0] ? ` ${observations[0]}` : ''),
    };
  }

  const args = toolCall.args as {
    page_id: string;
    summary: string;
  };

  return {
    pageId: args.page_id,
    summary: args.summary,
  };
}

