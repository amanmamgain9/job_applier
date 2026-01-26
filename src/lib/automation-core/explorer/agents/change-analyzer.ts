/**
 * Change Analyzer Agent
 * 
 * Unified agent that analyzes all DOM changes:
 * - URL changes: Is this a new page type? What kind?
 * - Same-page changes: What opened/closed/changed?
 * 
 * Provides rich feedback to Explorer so it can make informed decisions.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

const SYSTEM_PROMPT = `You analyze what happened after a user action on a web page.

IMPORTANT: I will tell you if the URL changed. Trust that information.
- If URL is "(unchanged)", do NOT say navigation happened.
- If URL actually changed, it IS navigation.

Compare the BEFORE and AFTER DOM states and determine what specifically changed:
- Modal/dialog opened or closed
- Panel expanded or collapsed  
- Content loaded in existing area
- Selection changed (e.g., different item highlighted)
- Nothing visible changed

Be specific and actionable. Your analysis helps decide what to do next.`;

export interface ChangeAnalyzerOptions {
  llm: BaseChatModel;
  action: string;
  beforeUrl: string;
  afterUrl: string;
  beforeDom: string;
  afterDom: string;
  knownPageTypes: string[];
  currentPageType?: string;
}

export interface ChangeAnalysis {
  // What changed
  description: string;
  
  // What element was interacted with (LLM-classified)
  elementType: string;
  
  // URL/navigation analysis
  urlChanged: boolean;
  isNewPageType: boolean;
  pageType: string;
  pageUnderstanding: string;
  
  // Change classification
  changeType: 'navigation' | 'modal_opened' | 'modal_closed' | 'content_loaded' | 'content_removed' | 'selection_changed' | 'no_change' | 'minor_change';
  
  // For navigation
  cameFrom?: string;
  viaAction?: string;
}

const analyzeChangeTool = {
  type: 'function' as const,
  function: {
    name: 'analyze_change',
    description: 'Report what changed after the action',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Human-readable description of what changed (1-2 sentences)',
        },
        element_type: {
          type: 'string',
          description: 'Short label for what element was interacted with (e.g., "job listing", "apply button", "filter dropdown", "close button", "save button", "form field", "navigation link")',
        },
        change_type: {
          type: 'string',
          enum: ['navigation', 'modal_opened', 'modal_closed', 'content_loaded', 'content_removed', 'selection_changed', 'no_change', 'minor_change'],
          description: 'Category of change',
        },
        page_type: {
          type: 'string',
          description: 'Semantic name for this page type (e.g., "job_search", "job_details", "application_form")',
        },
        is_new_page_type: {
          type: 'boolean',
          description: 'True only if URL changed AND this is a fundamentally different page type',
        },
        page_understanding: {
          type: 'string',
          description: 'What this page/state offers and what actions are possible',
        },
      },
      required: ['description', 'element_type', 'change_type', 'page_type', 'is_new_page_type', 'page_understanding'],
    },
  },
};

function buildPrompt(options: ChangeAnalyzerOptions): string {
  const { action, beforeUrl, afterUrl, beforeDom, afterDom, knownPageTypes, currentPageType } = options;
  
  const urlChanged = beforeUrl !== afterUrl;
  const knownTypesStr = knownPageTypes.length > 0 ? knownPageTypes.join(', ') : '(none yet)';
  
  return `ACTION: ${action}

URL: ${beforeUrl}${urlChanged ? ` → ${afterUrl}` : ' (unchanged)'}
Current page type: ${currentPageType || 'unknown'}
Known page types: [${knownTypesStr}]

BEFORE DOM:
${beforeDom}

AFTER DOM:
${afterDom}

Analyze what changed and call analyze_change() with your findings.`;
}

export async function runChangeAnalyzer(options: ChangeAnalyzerOptions): Promise<ChangeAnalysis> {
  const { llm, beforeUrl, afterUrl, currentPageType } = options;
  const urlChanged = beforeUrl !== afterUrl;

  const messages = [
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(buildPrompt(options)),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelWithTools = (llm as any).bindTools([analyzeChangeTool]);
  const response = await modelWithTools.invoke(messages) as AIMessage;

  // Extract tool call
  const toolCall = response.tool_calls?.[0];
  if (!toolCall || toolCall.name !== 'analyze_change') {
    // Fallback based on simple heuristics
    const sizeDiff = options.afterDom.length - options.beforeDom.length;
    return {
      description: urlChanged ? `Navigated to ${afterUrl}` : 'Action completed',
      elementType: 'unknown element',
      urlChanged,
      isNewPageType: urlChanged,
      pageType: currentPageType || 'unknown',
      pageUnderstanding: 'Unable to analyze',
      changeType: urlChanged ? 'navigation' : (Math.abs(sizeDiff) > 1000 ? 'content_loaded' : 'no_change'),
    };
  }

  const args = toolCall.args as {
    description: string;
    element_type: string;
    change_type: string;
    page_type: string;
    is_new_page_type: boolean;
    page_understanding: string;
  };

  // HARD OVERRIDE: LLM cannot claim navigation if URL didn't change
  let changeType = args.change_type as ChangeAnalysis['changeType'];
  let isNewPageType = args.is_new_page_type;
  let description = args.description;
  
  if (!urlChanged) {
    // URL didn't change - cannot be navigation or new page
    const sizeDiff = Math.abs(options.afterDom.length - options.beforeDom.length);
    
    if (changeType === 'navigation') {
      // Downgrade to content_loaded or no_change based on DOM diff
      changeType = sizeDiff > 500 ? 'content_loaded' : 'no_change';
    }
    isNewPageType = false;
    
    // If no_change, make the description honest
    if (changeType === 'no_change') {
      description = 'No visible change to the page';
    }
  }

  return {
    description,
    elementType: args.element_type || 'unknown element',
    urlChanged,
    isNewPageType,
    pageType: args.page_type,
    pageUnderstanding: args.page_understanding,
    changeType,
    cameFrom: urlChanged ? currentPageType : undefined,
    viaAction: options.action,
  };
}

