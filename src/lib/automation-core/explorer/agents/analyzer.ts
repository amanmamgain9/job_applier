/**
 * Analyzer - Understands what changed after an action using VISUAL COMPARISON
 * 
 * Uses Google's native Generative AI SDK directly to bypass LangChain's
 * multimodal model detection bug (which doesn't recognize gemini-3-*).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Analyzer');

// ============================================================================
// Types
// ============================================================================

export interface AnalyzerInput {
  action: string;           // What was done: "click #ember123"
  beforeUrl: string;
  afterUrl: string;
  beforeScreenshot: string | null;  // Base64 JPEG
  afterScreenshot: string | null;   // Base64 JPEG
}

export interface AnalyzerOutput {
  summary: string;          // Human-readable: "Job details panel updated with new position"
  urlChanged: boolean;
  hasVisualChanges: boolean;
}

export interface AnalyzerOptions {
  apiKey: string;           // Gemini API key
  model?: string;           // Model name (default: gemini-3-flash-preview)
  input: AnalyzerInput;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runAnalyzer(options: AnalyzerOptions): Promise<AnalyzerOutput> {
  const { apiKey, model = 'gemini-3-flash-preview', input } = options;
  const { action, beforeUrl, afterUrl, beforeScreenshot, afterScreenshot } = input;
  
  const urlChanged = beforeUrl !== afterUrl;
  
  // If no screenshots, return minimal info
  if (!beforeScreenshot || !afterScreenshot) {
    logger.warning('Missing screenshots for visual analysis');
    return {
      summary: urlChanged ? `Navigated to ${afterUrl}` : 'No screenshots available',
      urlChanged,
      hasVisualChanges: false,
    };
  }
  
  logger.info('Running visual analysis', { 
    action, 
    urlChanged,
    model,
    beforeSize: Math.round(beforeScreenshot.length / 1024) + 'KB',
    afterSize: Math.round(afterScreenshot.length / 1024) + 'KB',
  });
  
  try {
    const summary = await analyzeWithVision(
      apiKey, model, action, urlChanged, beforeUrl, afterUrl, 
      beforeScreenshot, afterScreenshot
    );
    
    // Check if LLM says "no changes" or similar
    const hasVisualChanges = !/(no changes|no visible|unchanged|identical|same as before)/i.test(summary);
    
    return {
      summary,
      urlChanged,
      hasVisualChanges,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Visual analysis failed', { error: errorMsg });
    
    return {
      summary: urlChanged ? `Navigated to ${afterUrl}` : 'Analysis failed',
      urlChanged,
      hasVisualChanges: false,
    };
  }
}

// ============================================================================
// Vision LLM Call (using native Google SDK)
// ============================================================================

const SYSTEM_PROMPT = `You analyze what changed on a webpage after a user action.

You will see BEFORE and AFTER screenshots. Provide a thorough change report that is useful for next actions.

RESPONSE FORMAT (plain text):
1) What changed visually (1-2 sentences)
2) Newly visible interactive elements/options (bulleted list)

When new UI appears (panels, dropdowns, modals, menus):
- LIST the options/items visible inside
- Include labels, section names, and any selectable options you can read
- Mention buttons/links/inputs that are now visible

If nothing significant changed, say "No visible changes".

Be specific and factual. Your description should capture the data visible, not just that a panel opened.`;

async function analyzeWithVision(
  apiKey: string,
  model: string,
  action: string,
  urlChanged: boolean,
  beforeUrl: string,
  afterUrl: string,
  beforeScreenshot: string,
  afterScreenshot: string
): Promise<string> {
  // Initialize Google's native SDK
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
  textContent += '\nCompare the BEFORE and AFTER screenshots. What changed?';
  
  // Create content parts with images
  // Use low thinking level for faster responses (per Gemini 3 docs)
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
        thinkingLevel: 'low',  // Minimize latency for simple comparison
      },
    },
  });
  
  const response = result.response;
  const text = response.text();
  
  if (!text) {
    throw new Error('LLM returned no text content');
  }
  
  return text.trim();
}
