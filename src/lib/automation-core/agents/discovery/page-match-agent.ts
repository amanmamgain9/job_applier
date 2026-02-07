/**
 * Page Match Agent
 *
 * Compares two page states (screenshots + URLs) and decides if they are the same page.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { HandoffInput, HandoffOutput } from './types/handoff';

export interface PageMatchContext {
  apiKey: string;
  model?: string;
  beforeUrl: string;
  afterUrl: string;
  beforeScreenshot: string;
  afterScreenshot: string;
}

export interface PageMatchResult {
  isSamePage: boolean;
  reason: string;
}

export async function runPageMatch(
  input: HandoffInput<PageMatchContext>
): Promise<HandoffOutput<PageMatchResult>> {
  const { context, goal } = input;
  if (!context) {
    return { goalCompleted: false, reason: 'No context provided' };
  }

  const { apiKey, model = 'gemini-3-flash-preview', beforeUrl, afterUrl, beforeScreenshot, afterScreenshot } = context;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const genModel = genAI.getGenerativeModel({ model });

    const prompt = [
      'Decide if these two screenshots represent the SAME page VIEW (layout), not identical content.',
      'Treat pages as the same if the overall layout/structure is the same even if the content changes.',
      'Examples of SAME page: selecting different items in a list, changing a details pane, new job card selected, SPA content swap within same layout.',
      'Examples of DIFFERENT page: full page navigation, new full-screen flow, modal takeover, different primary layout regions.',
      'Return JSON only: { "isSamePage": true|false, "reason": "short reason" }',
      `Goal: ${goal}`,
      `Before URL: ${beforeUrl}`,
      `After URL: ${afterUrl}`,
    ].join('\n');

    const result = await genModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: beforeScreenshot } },
          { inlineData: { mimeType: 'image/jpeg', data: afterScreenshot } },
        ],
      }],
      generationConfig: {
        // @ts-expect-error - thinkingConfig is a Gemini 3 feature not yet in types
        thinkingConfig: { thinkingLevel: 'low' },
      },
    } as unknown as any);

    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { goalCompleted: true, result: { isSamePage: false, reason: text } };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { isSamePage?: boolean; reason?: string };
    return {
      goalCompleted: true,
      result: {
        isSamePage: Boolean(parsed.isSamePage),
        reason: parsed.reason || 'no reason',
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { goalCompleted: false, reason: msg };
  }
}

