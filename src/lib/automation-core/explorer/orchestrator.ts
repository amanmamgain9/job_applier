/**
 * Orchestrator (Simplified)
 * 
 * A simple loop that:
 * 1. Asks Manager what to do
 * 2. Executes the action
 * 3. Automatically analyzes what changed
 * 4. Updates context
 * 5. Repeats until done
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Page } from '../browser/page';
import { MemoryStore, ExplorationResult } from './memory';
import { runManager, ManagerAction, ManagerDecision } from './agents/manager';
import { runAnalyzer } from './agents/analyzer';
import { runSummarizer } from './agents/summarizer';
import { domTreeToString } from '../utils/dom-to-text';
import { ReportService } from '../reporting';
import { createLogger, setReportSink } from '../utils/logger';

const logger = createLogger('Orchestrator');

// LLM call timeout - disabled (no timeout, let it run)
// const LLM_TIMEOUT_MS = 60000;

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorOptions {
  page: Page;
  task: string;
  goals?: string[];
  llm: BaseChatModel;
  apiKey: string;           // For direct Gemini API calls (visual analyzer)
  model?: string;           // Model name for analyzer
  report?: ReportService;
  maxSteps?: number;
}

interface ActionResult {
  success: boolean;
  description: string;
  newDom: string;
  newUrl: string;
}

// ============================================================================b
// Main Entry Point
// ============================================================================

export async function runOrchestrator(options: OrchestratorOptions): Promise<ExplorationResult> {
  const { page, task, goals, llm, apiKey, model, report, maxSteps = 20 } = options;
  
  const memory = new MemoryStore();
  const actionHistory: string[] = [];
  let stepCount = 0;

  // Pipe all logger output to report so it appears in downloadable reports
  if (report) {
    setReportSink((msg) => report.logRaw(msg));
  }

  logger.info('Starting orchestrator', { task, maxSteps });

  try {
    // Initialize
    const initialState = await page.getState();
    let currentDom = domTreeToString(initialState.elementTree, { includeSelectors: true });
    let currentUrl = initialState.url;
    
    // Use URL hostname as initial page identifier
    const pageId = new URL(currentUrl).hostname.replace(/\./g, '_');
    memory.initializePage(pageId, task, currentUrl);
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
        return makeErrorResult(memory, 'Browser connection lost - Puppeteer disconnected');
      }

      // Get Manager's decision
      const decision = await getManagerDecision(
      apiKey, model, task, goals, currentDom, memory, actionHistory, report
      );
      
      if (!decision) {
        return makeErrorResult(memory, 'Manager failed to make a decision');
      }

      // Handle done
      if (decision.action.type === 'done') {
        report?.log(`[Done] Finishing exploration`);
        return finishExploration(decision.action, memory, llm, report);
      }

      // Execute action and analyze
      const result = await executeAndAnalyze(
        page, decision.action, currentDom, currentUrl, memory, apiKey, model, actionHistory, report
      );
      
      currentDom = result.newDom;
      currentUrl = result.newUrl;
    }

    // Max steps reached
    logger.info('Max exploration steps reached');
    report?.log(`[Timeout] Max steps reached`);
    return makeErrorResult(memory, 'Max exploration steps reached');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Orchestrator error', { error: errorMessage, stack: errorStack });
    report?.log(`[FATAL ERROR] ${errorMessage}`);
    if (errorStack) {
      report?.log(`[Stack] ${errorStack.split('\n').slice(0, 3).join(' | ')}`);
    }
    return makeErrorResult(memory, errorMessage);
  } finally {
    // Clear the report sink to prevent memory leaks
    setReportSink(null);
  }
}

// ============================================================================
// Helper: Get Manager Decision
// ============================================================================

async function getManagerDecision(
  apiKey: string,
  model: string | undefined,
  task: string,
  goals: string[] | undefined,
  currentDom: string,
  memory: MemoryStore,
  actionHistory: string[],
  report?: ReportService
): Promise<ManagerDecision | null> {
  try {
    report?.log(`[Thinking...]`);
    // No timeout - let the LLM take as long as it needs
    return await runManager({
      apiKey,
      model,
      task,
      goals,
      currentDom,
      memorySummary: memory.getSummary(),
      actionHistory,
      confirmedPatternCount: memory.getConfirmedPatternCount(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    report?.log(`[Manager Error] ${errorMsg}`);
    actionHistory.push(`MANAGER FAILED: ${errorMsg}`);
    return null;
  }
}

// ============================================================================
// Helper: Execute Action and Analyze
// ============================================================================

async function executeAndAnalyze(
  page: Page,
  action: ManagerAction & { type: 'explore' },
  _beforeDom: string,  // Kept for future use
  beforeUrl: string,
  memory: MemoryStore,
  apiKey: string,
  model: string | undefined,
  actionHistory: string[],
  report?: ReportService
): Promise<ActionResult> {
  // Log action with reason so we know WHY the LLM chose this
  report?.log(`[Action] ${action.action}${action.target ? ` → ${action.target}` : ''}`);
  if (action.reason) {
    report?.log(`[Reason] ${action.reason}`);
  }
  
  // Find context around the selector in the DOM to understand what element this is
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

  // Analyze what changed (using visual comparison with native Gemini SDK)
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
// Helper: Analyze Changes (Visual using native Gemini SDK)
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
    // No timeout - let the analyzer take as long as it needs
    const analysis = await runAnalyzer({
      apiKey,
      model,
      input: {
        action: actionDesc,
        beforeUrl,
        afterUrl,
        beforeScreenshot,
        afterScreenshot,
      },
    });
    
    // Simple history entry with the summary
    const historyEntry = `${actionDesc} → ${analysis.summary}`;
    actionHistory.push(historyEntry);
    report?.log(`[Result] ${analysis.summary}`);

    // Persist analysis to memory so it shows in final summaries
    memory.addObservation(historyEntry);
    
    if (analysis.urlChanged) {
      report?.log(`[Navigation] URL changed`);
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
      const summary = await runSummarizer({
        llm,
        pageId,
        observations: pageNode.rawObservations,
        currentUnderstanding: pageNode.understanding,
      });
      memory.updatePageSummary(pageId, summary.summary);
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
