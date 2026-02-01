/**
 * Discovery Loop
 * 
 * Phase 1 of the Recipe Generation System.
 * Explores a webpage to learn how to complete a task.
 * 
 * Called by Manager, returns ExplorationResult via handoff contract.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Page } from '../browser/page';
import { MemoryStore, ExplorationResult } from './memory';
import { runDiscoveryAgent, DiscoveryAction, DiscoveryDecision } from './agents/discovery-agent';
import { runDiscoveryAnalyzer } from './agents/discovery-analyzer';
import { runDiscoverySummarizer } from './agents/discovery-summarizer';
import { domTreeToString } from '../utils/dom-to-text';
import { ReportService } from '../reporting';
import { createLogger, setReportSink } from '../utils/logger';
import { ClassifierResult } from './memory/types';
import { HandoffInput, HandoffOutput } from './types/handoff';

const logger = createLogger('DiscoveryLoop');

function buildPageId(url: string): string {
  try {
    const parsed = new URL(url);
    const normalized = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    return normalized.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  } catch {
    return url.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
}

// ============================================================================
// Types
// ============================================================================

export interface DiscoveryContext {
  page: Page;
  goals?: string[];
  llm: BaseChatModel;
  apiKey: string;
  model?: string;
  report?: ReportService;
  maxSteps?: number;
}

interface ActionResult {
  success: boolean;
  description: string;
  newDom: string;
  newUrl: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runDiscoveryLoop(
  input: HandoffInput<DiscoveryContext>
): Promise<HandoffOutput<ExplorationResult>> {
  const { goal, context } = input;
  
  if (!context) {
    return {
      goalCompleted: false,
      reason: 'No context provided to discovery loop',
    };
  }
  
  const { page, goals, llm, apiKey, model, report, maxSteps = 20 } = context;
  
  const memory = new MemoryStore();
  const actionHistory: string[] = [];
  let stepCount = 0;

  // Pipe all logger output to report so it appears in downloadable reports
  if (report) {
    setReportSink((msg) => report.logRaw(msg));
  }

  logger.info('Starting discovery loop', { goal, maxSteps });

  try {
    // Initialize
    const initialState = await page.getState();
    let currentDom = domTreeToString(initialState.elementTree, { includeSelectors: true });
    let currentUrl = initialState.url;
    
    // Use URL hostname as initial page identifier
    const pageId = new URL(currentUrl).hostname.replace(/\./g, '_');
    memory.initializePage(pageId, goal, currentUrl);
    report?.log(`[Start] ${currentUrl}`);
    
    // Log sample of DOM text so we can see what the LLM sees
    logger.info('Initial DOM sample (first 2000 chars)', { 
      domSample: currentDom.slice(0, 2000) 
    });

    // Main loop
    while (stepCount < maxSteps) {
      stepCount++;
      report?.log(`\n[Step ${stepCount}/${maxSteps}]`);

      // Check browser connection
      if (!page.attached) {
        report?.log(`[FATAL] Browser connection lost`);
        return {
          goalCompleted: false,
          result: makeErrorResult(memory, 'Browser connection lost - Puppeteer disconnected'),
          reason: 'Browser connection lost',
        };
      }

      // Get Discovery Agent's decision
      const decision = await getDiscoveryDecision(
        apiKey, model, goal, goals, currentDom, memory, actionHistory, report
      );
      
      if (!decision) {
        return {
          goalCompleted: false,
          result: makeErrorResult(memory, 'Discovery agent failed to make a decision'),
          reason: 'Discovery agent failed',
        };
      }

      // Handle done
      if (decision.action.type === 'done') {
        report?.log(`[Done] Finishing exploration`);
        const result = await finishExploration(decision.action, memory, llm, report);
        return {
          goalCompleted: true,
          result,
        };
      }

      // Execute action and analyze
      const actionResult = await executeAndAnalyze(
        page, decision.action, currentDom, currentUrl, memory, apiKey, model, actionHistory, report
      );
      
      currentDom = actionResult.newDom;
      currentUrl = actionResult.newUrl;
    }

    // Max steps reached
    logger.info('Max exploration steps reached');
    report?.log(`[Timeout] Max steps reached`);
    return {
      goalCompleted: false,
      result: makeErrorResult(memory, 'Max exploration steps reached'),
      reason: 'Max steps reached',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Discovery loop error', { error: errorMessage, stack: errorStack });
    report?.log(`[FATAL ERROR] ${errorMessage}`);
    if (errorStack) {
      report?.log(`[Stack] ${errorStack.split('\n').slice(0, 3).join(' | ')}`);
    }
    return {
      goalCompleted: false,
      result: makeErrorResult(memory, errorMessage),
      reason: errorMessage,
    };
  } finally {
    // Clear the report sink to prevent memory leaks
    setReportSink(null);
  }
}

// ============================================================================
// Helper: Get Discovery Agent Decision
// ============================================================================

async function getDiscoveryDecision(
  apiKey: string,
  model: string | undefined,
  task: string,
  goals: string[] | undefined,
  currentDom: string,
  memory: MemoryStore,
  actionHistory: string[],
  report?: ReportService
): Promise<DiscoveryDecision | null> {
  try {
    report?.log(`[Thinking...]`);
    const result = await runDiscoveryAgent({
      goal: `Decide next action to: ${task}`,
      context: {
        apiKey,
        model,
        task,
        goals,
        currentDom,
        memorySummary: memory.getSummary(),
        actionHistory,
        confirmedPatternCount: memory.getConfirmedPatternCount(),
      },
    });
    
    if (!result.goalCompleted || !result.result) {
      report?.log(`[Discovery Agent Error] ${result.reason || 'No decision'}`);
      actionHistory.push(`DISCOVERY AGENT FAILED: ${result.reason || 'unknown'}`);
      return null;
    }
    
    return result.result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    report?.log(`[Discovery Agent Error] ${errorMsg}`);
    actionHistory.push(`DISCOVERY AGENT FAILED: ${errorMsg}`);
    return null;
  }
}

// ============================================================================
// Helper: Execute Action and Analyze
// ============================================================================

async function executeAndAnalyze(
  page: Page,
  action: DiscoveryAction & { type: 'explore' },
  _beforeDom: string,
  beforeUrl: string,
  memory: MemoryStore,
  apiKey: string,
  model: string | undefined,
  actionHistory: string[],
  report?: ReportService
): Promise<ActionResult> {
  // Log action with reason
  report?.log(`[Action] ${action.action}${action.target ? ` → ${action.target}` : ''}`);
  if (action.reason) {
    report?.log(`[Reason] ${action.reason}`);
  }
  
  // Find context around the selector in the DOM
  if (action.target && _beforeDom) {
    const selectorPattern = action.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const contextMatch = _beforeDom.match(new RegExp(`.{0,100}${selectorPattern}.{0,200}`, 's'));
    if (contextMatch) {
      logger.info('Element context from DOM', { context: contextMatch[0].replace(/\s+/g, ' ').trim() });
    }
  }

  // Capture screenshot BEFORE the action
  let beforeScreenshot: string | null = null;
  try {
    beforeScreenshot = await page.takeScreenshot();
  } catch {
    logger.warning('Failed to capture before screenshot');
  }

  // Execute the action
  const execResult = await executeAction(page, action, report);
  
  // Capture screenshot AFTER the action
  let afterScreenshot: string | null = null;
  try {
    afterScreenshot = await page.takeScreenshot();
  } catch {
    logger.warning('Failed to capture after screenshot');
  }
  
  // Get new state
  const afterState = await page.getState();
  const afterDom = domTreeToString(afterState.elementTree, { includeSelectors: true });
  const afterUrl = afterState.url;

  // If action failed, just record and return
  if (!execResult.success) {
    actionHistory.push(`${execResult.description} → FAILED`);
    return { success: false, description: execResult.description, newDom: afterDom, newUrl: afterUrl };
  }

  // Analyze what changed
  await analyzeChanges(
    memory, apiKey, model, execResult.description, beforeUrl, afterUrl,
    beforeScreenshot, afterScreenshot, actionHistory, report
  );

  return { success: true, description: execResult.description, newDom: afterDom, newUrl: afterUrl };
}

// ============================================================================
// Helper: Execute Single Action
// ============================================================================

async function executeAction(
  page: Page,
  action: { action: 'click' | 'scroll_down' | 'scroll_up'; target?: string },
  report?: ReportService
): Promise<{ success: boolean; description: string }> {
  try {
    let description = '';
    
    switch (action.action) {
      case 'click':
        if (!action.target) {
          report?.log(`[Error] Click requires target`);
          return { success: false, description: 'click (no target)' };
        }
        await page.clickSelector(action.target);
        description = `click "${action.target}"`;
        break;
        
      case 'scroll_down':
        await page.scrollToNextPage();
        description = 'scroll down';
        break;
        
      case 'scroll_up':
        await page.scrollToPreviousPage();
        description = 'scroll up';
        break;
    }
    
    // Wait for page updates
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return { success: true, description };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    report?.log(`[Error] ${errorMsg}`);
    return { success: false, description: action.action };
  }
}

// ============================================================================
// Helper: Analyze Changes
// ============================================================================

async function analyzeChanges(
  memory: MemoryStore,
  apiKey: string,
  model: string | undefined,
  actionDesc: string,
  beforeUrl: string,
  afterUrl: string,
  beforeScreenshot: string | null,
  afterScreenshot: string | null,
  actionHistory: string[],
  report?: ReportService
): Promise<void> {
  try {
    report?.log(`[Analyzing...]`);
    
    const analyzerResult = await runDiscoveryAnalyzer({
      goal: `Describe what changed after: ${actionDesc}`,
      context: {
        apiKey,
        model,
        action: actionDesc,
        beforeUrl,
        afterUrl,
        beforeScreenshot,
        afterScreenshot,
      },
    });
    
    if (!analyzerResult.goalCompleted || !analyzerResult.result) {
      const errorMsg = analyzerResult.reason || 'Analysis failed';
      report?.log(`[Analyzer Error] ${errorMsg}`);
      actionHistory.push(`${actionDesc} → ANALYSIS FAILED: ${errorMsg}`);
      return;
    }
    
    const analysis = analyzerResult.result;
    
    // Simple history entry with the summary
    const historyEntry = `${actionDesc} → ${analysis.summary}`;
    actionHistory.push(historyEntry);
    report?.log(`[Result] ${analysis.summary}`);

    // Persist analysis to memory
    memory.addObservation(historyEntry);
    
    if (analysis.urlChanged) {
      report?.log(`[Navigation] URL changed`);
      const previousPageId = memory.getNavigationPath().slice(-1)[0];
      const newPageId = buildPageId(afterUrl);
      const classification: ClassifierResult = {
        pageId: newPageId,
        isNewPage: !memory.getPage(newPageId),
        isSamePage: false,
        understanding: analysis.summary,
        cameFrom: previousPageId,
        viaAction: actionDesc,
      };
      memory.updateFromClassification(classification, afterUrl);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    report?.log(`[Analyzer Error] ${errorMsg}`);
    actionHistory.push(`${actionDesc} → ANALYSIS FAILED: ${errorMsg}`);
  }
}

// ============================================================================
// Helper: Finish Exploration
// ============================================================================

async function finishExploration(
  action: { understanding: string; keyElements: Record<string, string | string[]> },
  memory: MemoryStore,
  llm: BaseChatModel,
  report?: ReportService
): Promise<ExplorationResult> {
  // Final summarization for all pages
  for (const pageId of memory.getPageIds()) {
    const pageNode = memory.getPage(pageId);
    if (pageNode && pageNode.rawObservations.length > 0) {
      const summarizerResult = await runDiscoverySummarizer({
        goal: `Consolidate observations for page: ${pageId}`,
        context: {
          llm,
          pageId,
          observations: pageNode.rawObservations,
          currentUnderstanding: pageNode.understanding,
        },
      });
      
      if (summarizerResult.goalCompleted && summarizerResult.result) {
        memory.updatePageSummary(pageId, summarizerResult.result.summary);
      }
    }
  }
  
  const discoveredSelectors = memory.getDiscoveredSelectors();
  const mergedKeyElements = { ...discoveredSelectors, ...action.keyElements };
  
  const result: ExplorationResult = {
    success: true,
    pages: memory.getAllPages(),
    navigationPath: memory.getNavigationPath(),
    finalUnderstanding: action.understanding,
    keyElements: mergedKeyElements,
  };
  
  const phaseOutput = JSON.stringify({
    understanding: action.understanding,
    keyElements: mergedKeyElements,
    pagesExplored: memory.getPageIds(),
  }, null, 2);
  report?.addPhaseOutput('exploration', phaseOutput, true, 0);
  
  return result;
}

// ============================================================================
// Helper: Make Error Result
// ============================================================================

function makeErrorResult(memory: MemoryStore, error: string): ExplorationResult {
  return {
    success: false,
    pages: memory.getAllPages(),
    navigationPath: memory.getNavigationPath(),
    finalUnderstanding: memory.getFinalUnderstanding(),
    keyElements: memory.getDiscoveredSelectors(),
    error,
  };
}


