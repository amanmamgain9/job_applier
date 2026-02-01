/**
 * Discoverer Agent (using native Google SDK)
 *
 * Produces a human-readable, goal-by-goal understanding of how to
 * achieve the task based on observed actions and analyses.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Discoverer');

const SYSTEM_PROMPT = `You are a discovery writer. Convert observed actions and analysis summaries into a human-readable explanation of how to achieve the goals on this page.

Requirements:
- Write goal-by-goal, matching the provided goals list.
- Keep it concise and practical, like instructions to another human.
- Use only what was observed in the action history and memory summary.
- If a goal is not yet supported by evidence, say "Unknown so far".
- Do NOT output selectors or code.`;

export interface DiscovererOptions {
  apiKey: string;
  model?: string;
  task: string;
  goals?: string[];
  memorySummary: string;
  actionHistory: string[];
}

export async function runDiscoverer(options: DiscovererOptions): Promise<string> {
  const { apiKey, model = 'gemini-3-flash-preview', task, goals, memorySummary, actionHistory } = options;

  logger.info('runDiscoverer called', {
    model,
    hasTask: !!task,
    hasGoals: !!goals?.length,
    actionHistoryLength: actionHistory?.length ?? 0,
  });

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

Write the discovery explanation now.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_PROMPT,
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
  if (!text) {
    throw new Error('Discoverer returned empty response');
  }

  return text.trim();
}

