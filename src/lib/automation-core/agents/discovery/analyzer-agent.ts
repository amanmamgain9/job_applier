/**
 * Discovery Analyzer
 * 
 * Analyzes what changed after an action using visual comparison.
 * Returns whether the page/state fundamentally changed (significantChange).
 * 
 * Uses Google's native Generative AI SDK for multimodal analysis.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from '../../utils/logger';
import type { ReportService } from '../../reporting';
import { HandoffInput, HandoffOutput } from './types/handoff';
import { runPageMatch } from './page-match-agent';

const logger = createLogger('DiscoveryAnalyzer');

// ============================================================================
// Types
// ============================================================================

export interface DiscoveryAnalyzerContext {
  apiKey: string;
  model?: string;
  action: string;
  beforeUrl: string;
  afterUrl: string;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
}

export interface DiscoveryAnalyzerResult {
  summary: string;           // Human-readable change description
  urlChanged: boolean;       // Did URL change?
  significantChange: boolean; // Did page/state fundamentally change?
}

export interface PageChangeContext {
  apiKey: string;
  model?: string;
  action: string;
  beforeUrl: string;
  afterUrl: string;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  domSample: string;
  existingPages: Array<{
    pageKey: string;
    lastUrl: string;
    screenshot: string;
    snapshotId: string;
  }>;
  onLlmCall?: (event: PageChangeLlmCallEvent) => void;
}

export interface PageChangeResult {
  analysis: DiscoveryAnalyzerResult;
  pageKey?: string;
  matchedPageKey?: string;
  newPageKey?: string;
}

export interface PageChangeLogEvent {
  kind: string;
  meta?: {
    beforeUrl?: string;
    afterUrl?: string;
  };
}

export interface PageChangeEventLog {
  getPageKeys(): string[];
  getEventsForPage(pageKey: string): PageChangeLogEvent[];
  getCurrentPageKey(): string | null;
  setCurrent(pageKey: string): void;
  getSnapshots(): Array<{ pageKey: string; lastUrl: string; screenshot: string; snapshotId: string }>;
  setSnapshot(pageKey: string, url: string, screenshot: string | null): string | null;
  addLlmCallEvent(
    output: HandoffOutput<unknown>,
    meta: {
      agent: 'analyzer' | 'page_match' | 'page_id';
      goal: string;
      model?: string;
      durationMs?: number;
    }
  ): void;
  addAnalyzerEvent(
    output: HandoffOutput<DiscoveryAnalyzerResult>,
    meta: {
      beforeUrl: string;
      afterUrl: string;
      beforeSnapshotId?: string;
      afterSnapshotId?: string;
    }
  ): void;
  addPageChangeEvent(
    output: HandoffOutput<PageChangeResult>,
    meta: {
      beforeUrl: string;
      afterUrl: string;
      fromPageKey?: string;
      toPageKey?: string;
      beforeSnapshotId?: string;
      afterSnapshotId?: string;
    }
  ): void;
}

type PageChangeLlmCallEvent = {
  agent: 'analyzer' | 'page_match' | 'page_id';
  goal: string;
  model?: string;
  durationMs?: number;
  output: HandoffOutput<unknown>;
};


// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You analyze what changed on a webpage after a user action.

You will see BEFORE and AFTER screenshots. Provide a thorough change report.

RESPONSE FORMAT (JSON):
{
  "summary": "1-2 sentence description of what changed",
  "newElements": ["list", "of", "new", "interactive", "elements"],
  "significantChange": true/false
}

SIGNIFICANT CHANGE means the page's functional state changed enough that it's a new step:
- New screen/page loaded (not just content update)
- Modal became full page or vice versa
- Panel completely replaced the main content
- Major navigation occurred (different section of app)

NOT significant:
- Dropdown opened/closed
- Panel slid in but main content still visible
- Content loaded into existing container
- Tooltip or hover effect
- Pagination within same view

Be specific and factual. Describe what you see, not assumptions.`;

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runAnalyzer(
  input: HandoffInput<DiscoveryAnalyzerContext>
): Promise<HandoffOutput<DiscoveryAnalyzerResult>> {
  const { goal, context } = input;
  
  if (!context) {
    return {
      goalCompleted: false,
      reason: 'No context provided to analyzer',
    };
  }
  
  const { 
    apiKey, 
    model = 'gemini-3-flash-preview', 
    action, 
    beforeUrl, 
    afterUrl, 
    beforeScreenshot, 
    afterScreenshot 
  } = context;
  
  const urlChanged = beforeUrl !== afterUrl;
  
  // If no screenshots, fail fast
  if (!beforeScreenshot || !afterScreenshot) {
    logger.warning('Missing screenshots for visual analysis');
    return {
      goalCompleted: false,
      reason: 'Missing screenshots for visual analysis',
    };
  }
  
  logger.info('Running visual analysis', { 
    goal,
    action, 
    urlChanged,
    model,
    beforeSize: Math.round(beforeScreenshot.length / 1024) + 'KB',
    afterSize: Math.round(afterScreenshot.length / 1024) + 'KB',
  });
  
  try {
    const result = await analyzeWithVision(
      apiKey, model, action, urlChanged, beforeUrl, afterUrl, 
      beforeScreenshot, afterScreenshot
    );
    
    return {
      goalCompleted: true,
      result,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Visual analysis failed', { error: errorMsg });
    
    return {
      goalCompleted: false,
      result: {
        summary: urlChanged ? `Navigated to ${afterUrl}` : 'Analysis failed',
        urlChanged,
        significantChange: urlChanged,
      },
      reason: errorMsg,
    };
  }
}

// ============================================================================
// Page Change Analysis (Analyzer + Page Match + ID)
// ============================================================================

export async function runPageChangeAnalysis(
  input: HandoffInput<PageChangeContext>
): Promise<HandoffOutput<PageChangeResult>> {
  const { goal, context } = input;
  if (!context) {
    return { goalCompleted: false, reason: 'No context provided' };
  }

  const {
    apiKey,
    model,
    action,
    beforeUrl,
    afterUrl,
    beforeScreenshot,
    afterScreenshot,
    domSample,
    existingPages,
    onLlmCall,
  } = context;

  const analyzerStart = Date.now();
  const analysisResult = await runAnalyzer({
    goal,
    context: { apiKey, model, action, beforeUrl, afterUrl, beforeScreenshot, afterScreenshot },
  });
  onLlmCall?.({
    agent: 'analyzer',
    goal,
    model: model ?? 'gemini-3-flash-preview',
    durationMs: Date.now() - analyzerStart,
    output: analysisResult,
  });

  if (!analysisResult.goalCompleted || !analysisResult.result) {
    return {
      goalCompleted: false,
      reason: analysisResult.reason || 'Analyzer failed',
    };
  }

  const analysis = analysisResult.result;
  if (!analysis.urlChanged) {
    return { goalCompleted: true, result: { analysis } };
  }

  if (!afterScreenshot) {
    const fallbackKey = buildPageIdFallback(afterUrl);
    return {
      goalCompleted: true,
      result: {
        analysis,
        pageKey: fallbackKey,
        newPageKey: fallbackKey,
      },
    };
  }

  for (const candidate of existingPages) {
    const matchStart = Date.now();
    const match = await runPageMatch({
      goal: `Is this the same page as ${candidate.pageKey}?`,
      context: {
        apiKey,
        model,
        beforeUrl: candidate.lastUrl,
        afterUrl,
        beforeScreenshot: candidate.screenshot,
        afterScreenshot,
      },
    });
    onLlmCall?.({
      agent: 'page_match',
      goal: `Is this the same page as ${candidate.pageKey}?`,
      model: model ?? 'gemini-3-flash-preview',
      durationMs: Date.now() - matchStart,
      output: match,
    });

    if (match.goalCompleted && match.result?.isSamePage) {
      return {
        goalCompleted: true,
        result: {
          analysis,
          pageKey: candidate.pageKey,
          matchedPageKey: candidate.pageKey,
        },
      };
    }
  }

  const pageIdStart = Date.now();
  const newPageId = await buildPageIdWithLlm({
    apiKey,
    model,
    url: afterUrl,
    domSample: domSample.slice(0, 2000),
    summary: analysis.summary,
    beforeScreenshot,
    afterScreenshot,
  });
  onLlmCall?.({
    agent: 'page_id',
    goal: 'Generate stable page id',
    model: model ?? 'gemini-3-flash-preview',
    durationMs: Date.now() - pageIdStart,
    output: { goalCompleted: true, result: newPageId },
  });

  return {
    goalCompleted: true,
    result: {
      analysis,
      pageKey: newPageId,
      newPageKey: newPageId,
    },
  };
}

export async function analyzeAndRecordPageChange(input: {
  eventLog: PageChangeEventLog;
  apiKey: string;
  model: string | undefined;
  actionDesc: string;
  beforeUrl: string;
  afterUrl: string;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  afterDom: string;
  report?: ReportService;
}): Promise<void> {
  const {
    eventLog,
    apiKey,
    model,
    actionDesc,
    beforeUrl,
    afterUrl,
    beforeScreenshot,
    afterScreenshot,
    afterDom,
    report,
  } = input;

  try {
    report?.log(`[Analyzing...]`);

    const existingPages = eventLog.getSnapshots();

    const fromPageKey = eventLog.getCurrentPageKey();
    const result = await runPageChangeAnalysis({
      goal: `Describe what changed after: ${actionDesc}`,
      context: {
        apiKey,
        model,
        action: actionDesc,
        beforeUrl,
        afterUrl,
        beforeScreenshot,
        afterScreenshot,
        domSample: afterDom,
        existingPages,
        onLlmCall: (event) => {
          eventLog.addLlmCallEvent(event.output, {
            agent: event.agent,
            goal: event.goal,
            model: event.model,
            durationMs: event.durationMs,
          });
        },
      },
    });

    if (!result.goalCompleted || !result.result) {
      const msg = result.reason || 'Analysis failed';
      report?.log(`[Error] ${msg}`);
      eventLog.addPageChangeEvent(result, {
        beforeUrl,
        afterUrl,
      });
      return;
    }

    const pageChange = result.result;
    const analysis = pageChange.analysis;
    const matchedPageKey = pageChange.matchedPageKey;
    const resolvedPageKey = analysis.urlChanged
      ? (matchedPageKey || pageChange.pageKey || afterUrl.replace(/[^a-zA-Z0-9]+/g, '_'))
      : undefined;

    const beforeSnapshotId = fromPageKey
      ? eventLog.setSnapshot(fromPageKey, beforeUrl, beforeScreenshot) ?? undefined
      : undefined;
    let afterSnapshotId: string | undefined;
    if (analysis.urlChanged) {
      const nextKey = resolvedPageKey || afterUrl.replace(/[^a-zA-Z0-9]+/g, '_');
      afterSnapshotId = eventLog.setSnapshot(nextKey, afterUrl, afterScreenshot) ?? undefined;
    } else if (fromPageKey) {
      afterSnapshotId = eventLog.setSnapshot(fromPageKey, afterUrl, afterScreenshot) ?? undefined;
    }

    eventLog.addPageChangeEvent(result, {
      beforeUrl,
      afterUrl,
      fromPageKey: fromPageKey ?? undefined,
      toPageKey: resolvedPageKey,
      beforeSnapshotId,
      afterSnapshotId,
    });

    report?.log(`[Result] ${analysis.summary}`);

    if (analysis.urlChanged) {
      const nextKey = resolvedPageKey || afterUrl.replace(/[^a-zA-Z0-9]+/g, '_');
      if (matchedPageKey) {
        report?.log(`[Navigation] URL changed (matched page ${matchedPageKey})`);
      } else {
        report?.log(`[Navigation] URL changed`);
      }
      eventLog.setCurrent(nextKey);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    report?.log(`[Error] ${msg}`);
    eventLog.addAnalyzerEvent({ goalCompleted: false, reason: msg }, {
      beforeUrl,
      afterUrl,
    });
  }
}


// ============================================================================
// Page Match (Same Page Detection)
// ============================================================================


// ============================================================================
// Vision LLM Call
// ============================================================================

async function analyzeWithVision(
  apiKey: string,
  model: string,
  action: string,
  urlChanged: boolean,
  beforeUrl: string,
  afterUrl: string,
  beforeScreenshot: string,
  afterScreenshot: string
): Promise<DiscoveryAnalyzerResult> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ 
    model,
    systemInstruction: SYSTEM_PROMPT,
  });
  
  // Build the prompt
  let textContent = `ACTION TAKEN: ${action}\n`;
  if (urlChanged) {
    textContent += `URL CHANGED: ${beforeUrl} → ${afterUrl}\n`;
  }
  textContent += '\nCompare the BEFORE and AFTER screenshots. Respond with JSON only.';
  
  const result = await genModel.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: textContent },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: beforeScreenshot,
          },
        },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: afterScreenshot,
          },
        },
      ],
    }],
    generationConfig: {
      // @ts-expect-error - thinkingConfig is a Gemini 3 feature not yet in types
      thinkingConfig: {
        thinkingLevel: 'low',
      },
    },
  });
  
  const response = result.response;
  const text = response.text();
  
  if (!text) {
    throw new Error('LLM returned no text content');
  }
  
  // Parse JSON response
  try {
    // Extract JSON from response (might have markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: treat as plain text summary
      return {
        summary: text.trim(),
        urlChanged,
        significantChange: urlChanged || !/(no changes|no visible|unchanged|identical|same as before)/i.test(text),
      };
    }
    
    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      newElements?: string[];
      significantChange?: boolean;
    };
    
    const summary = parsed.summary || text.trim();
    const newElements = parsed.newElements || [];
    const significantChange = parsed.significantChange ?? urlChanged;
    
    // Build enhanced summary if we have new elements
    let enhancedSummary = summary;
    if (newElements.length > 0) {
      enhancedSummary += ` New elements: ${newElements.join(', ')}.`;
    }
    
    return {
      summary: enhancedSummary,
      urlChanged,
      significantChange,
    };
  } catch {
    // JSON parse failed, use text as summary
    logger.warning('Failed to parse analyzer JSON response, using text');
    return {
      summary: text.trim(),
      urlChanged,
      significantChange: urlChanged || !/(no changes|no visible|unchanged|identical|same as before)/i.test(text),
    };
  }
}

function buildPageIdFallback(url: string): string {
  try {
    const parsed = new URL(url);
    const normalized = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    return normalized.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  } catch {
    return url.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
}

async function buildPageIdWithLlm(params: {
  apiKey: string;
  model: string | undefined;
  url: string;
  domSample: string;
  summary?: string;
  beforeScreenshot?: string | null;
  afterScreenshot?: string | null;
}): Promise<string> {
  const { apiKey, model = 'gemini-3-flash-preview', url, domSample, summary, beforeScreenshot, afterScreenshot } = params;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const genModel = genAI.getGenerativeModel({ model });
    const prompt = [
      'Create a stable page id for a SPA view.',
      'Return ONLY a short lowercase id with letters/numbers/underscores.',
      '',
      `URL: ${url}`,
      summary ? `Summary: ${summary}` : '',
      `DOM sample: ${domSample}`.trim(),
    ].filter(Boolean).join('\n');
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];
    if (beforeScreenshot) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: beforeScreenshot } });
    }
    if (afterScreenshot) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: afterScreenshot } });
    }
    const result = await genModel.generateContent({
      contents: [{ role: 'user', parts }],
    } as unknown as any);
    const text = result.response.text().trim();
    const normalized = text.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized || buildPageIdFallback(url);
  } catch {
    return buildPageIdFallback(url);
  }
}


