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
import { HandoffInput, HandoffOutput } from './types/handoff';

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
  
  // If no screenshots, return minimal info
  if (!beforeScreenshot || !afterScreenshot) {
    logger.warning('Missing screenshots for visual analysis');
    return {
      goalCompleted: true,
      result: {
        summary: urlChanged ? `Navigated to ${afterUrl}` : 'No screenshots available',
        urlChanged,
        significantChange: urlChanged, // URL change is significant by default
      },
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


