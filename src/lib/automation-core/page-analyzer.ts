/**
 * PageAnalyzer - Understands page structure using LLM
 * 
 * Flow:
 * 1. Takes a Page object (already connected to browser)
 * 2. Gets DOM state via buildDomTree
 * 3. Serializes DOM to text
 * 4. Sends to LLM with understanding prompt
 * 5. Returns structured understanding
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage } from '@langchain/core/messages';
import type { Page } from './browser/page';
import { createLogger } from './utils/logger';
import { domTreeToString } from './utils/dom-to-text';
import type { ReportService } from './reporting';

const logger = createLogger('PageAnalyzer');

// ============================================================================
// Types
// ============================================================================

export interface AnalyzePageOptions {
  /** The page to analyze (must be attached to browser) */
  page: Page;
  /** User's task/goal (e.g., "Find software engineer jobs") */
  task: string;
  /** LLM to use for analysis */
  llm: BaseChatModel;
  /** Optional report service for streaming updates */
  report?: ReportService;
}

export interface PageUnderstanding {
  /** Full text understanding from LLM */
  understanding: string;
  /** Page URL analyzed */
  url: string;
  /** Page title */
  title: string;
  /** Whether analysis succeeded */
  success: boolean;
  /** Error if failed */
  error?: string;
}

// ============================================================================
// System Prompt
// ============================================================================

// System prompt built with page content
function buildSystemPrompt(url: string, _title: string, dom: string): string {
  return `Describe this web page structure.

${url}

${dom}

What is this page? What content does it show? What can users do here?`;
}

// ============================================================================
// Main Function
// ============================================================================

export async function analyzePage(options: AnalyzePageOptions): Promise<PageUnderstanding> {
  const { page, llm, report } = options;
  
  logger.info('Analyzing page...');
  
  try {
    // 1. Get DOM state (this injects buildDomTree)
    report?.startAction('Getting DOM state');
    const state = await page.getState();
    
    if (!state.elementTree) {
      report?.endAction(false, 'Failed to get DOM tree');
      return {
        understanding: '',
        url: state.url,
        title: state.title,
        success: false,
        error: 'Failed to get DOM tree',
      };
    }
    report?.endAction(true);
    
    // 2. Serialize DOM to text
    report?.startAction('Serializing DOM tree');
    const domString = domTreeToString(state.elementTree);
    logger.info('DOM string length:', domString.length);
    report?.endAction(true);
    
    // 3. Send to LLM
    report?.startAction('Sending to LLM for analysis');
    const llmStart = Date.now();
    
    const systemPrompt = buildSystemPrompt(
      state.url,
      state.title,
      domString.slice(0, 80000)
    );
    
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
    ]);
    
    const content = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);
    
    const llmDuration = Date.now() - llmStart;
    logger.info('LLM response received, length:', content.length);
    report?.endAction(true);
    
    // Add phase output for debugging
    report?.addPhaseOutput('page_analysis', content, true, llmDuration);
    
    return {
      understanding: content,
      url: state.url,
      title: state.title,
      success: true,
    };
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error('Page analysis failed:', errorMessage);
    report?.endAction(false, errorMessage);
    
    return {
      understanding: '',
      url: '',
      title: '',
      success: false,
      error: errorMessage,
    };
  }
}
