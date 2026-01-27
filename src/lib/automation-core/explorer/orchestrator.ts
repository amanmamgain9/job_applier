/**
 * Orchestrator
 * 
 * Main loop that coordinates agents:
 * - Explorer: Navigates and observes
 * - ChangeAnalyzer: Determines what changed after actions
 * - Consolidator: Groups observations into patterns (LLM-based)
 * - Summarizer: Compresses observations
 * 
 * Handles tool execution, handoffs, and memory updates.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Page } from '../browser/page';
import { MemoryStore, ExplorationResult } from './memory';
import { runExplorer, ExplorerAction } from './agents/explorer';
import { runSummarizer } from './agents/summarizer';
import { runChangeAnalyzer } from './agents/change-analyzer';
import { runConsolidator, consolidatorOutputToPatterns } from './agents/consolidator';
import { domTreeToString } from '../utils/dom-to-text';
import { ReportService } from '../reporting';
import { createLogger } from '../utils/logger';

const logger = createLogger('Orchestrator');

export interface OrchestratorOptions {
  page: Page;
  task: string;
  llm: BaseChatModel;
  report?: ReportService;
  maxSteps?: number;
}

interface ActionResult {
  success: boolean;
  urlChanged: boolean;
  newUrl?: string;
  oldUrl?: string;
  error?: string;
  dom?: string;
  beforeDom?: string;
  afterDom?: string;
  actionDescription?: string; // What action was taken (for differ)
}

export async function runOrchestrator(options: OrchestratorOptions): Promise<ExplorationResult> {
  const { page, task, llm, report, maxSteps = 20 } = options;
  
  const memory = new MemoryStore();
  let previousUrl: string = '';
  let stepCount = 0;
  const recentActions: string[] = []; // Track recent actions for context
  let lastActionResult: string | null = null; // Result of the most recent action - shown prominently to LLM

  logger.info('Starting orchestrator', { task, maxSteps });

  try {
    // Get initial state
    report?.startAction('Getting initial page state');
    const initialState = await page.getState();
    const initialDom = domTreeToString(initialState.elementTree, { includeSelectors: true });
    report?.endAction(true);

    previousUrl = initialState.url;

    // Initial page analysis
    report?.startAction('Analyzing initial page');
    const initialAnalysis = await runChangeAnalyzer({
      llm,
      action: 'Page loaded',
      beforeUrl: '',
      afterUrl: initialState.url,
      beforeDom: '',
      afterDom: initialDom,
      knownPageTypes: [],
      currentPageType: undefined,
    });
    
    // Initialize memory with initial page
    memory.updateFromClassification({
      pageId: initialAnalysis.pageType,
      isNewPage: true,
      isSamePage: false,
      understanding: initialAnalysis.pageUnderstanding,
    }, null);
    logger.info('Initial page analyzed', { pageType: initialAnalysis.pageType });
    report?.endAction(true);

    // Main exploration loop
    while (stepCount < maxSteps) {
      stepCount++;
      logger.info(`Exploration step ${stepCount}/${maxSteps}`);

      // Get current state  
      const currentState = await page.getState();
      let currentDom = domTreeToString(currentState.elementTree, { includeSelectors: true });

      // Check for action loop - if last 3 actions are identical, force variety
      const lastActions = recentActions.slice(-3);
      const isClickLoop = lastActions.length >= 3 && 
        lastActions.every(a => a === lastActions[0] && a.startsWith('Clicked'));
      
      // Check for scroll loop - if last 5 actions are all scrolls
      const last5Actions = recentActions.slice(-5);
      const isScrollLoop = last5Actions.length >= 5 &&
        last5Actions.every(a => a.startsWith('Scrolled'));
      
      const isLooping = isClickLoop || isScrollLoop;
      
      if (isClickLoop) {
        report?.log(`[LOOP DETECTED] Same click repeated 3x: "${lastActions[0]}"`);
        memory.enrichCurrentPage(`WARNING: Action "${lastActions[0]}" was tried 3 times with no effect - this element may not be working or is already selected`);
      }
      
      if (isScrollLoop) {
        report?.log(`[LOOP DETECTED] Scrolled 5 times in a row - time to try something else`);
        memory.enrichCurrentPage(`WARNING: You have scrolled 5 times in a row. Stop scrolling and try clicking on elements you can see, or dismiss any open dialogs.`);
      }

      // Run Consolidator if needed (LLM-based pattern recognition)
      if (memory.shouldConsolidate()) {
        report?.startAction('Consolidating patterns');
        const consolidationInput = memory.getConsolidationInput();
        
        try {
          const consolidationResult = await runConsolidator({
            llm,
            input: {
              rawObservations: consolidationInput.rawObservations,
              existingPatterns: consolidationInput.existingPatterns,
              truncatedDom: currentDom.slice(0, 3000),
            },
          });
          
          // Update memory with consolidated patterns
          const newPatterns = consolidatorOutputToPatterns(consolidationResult);
          memory.updatePatternsFromConsolidation(newPatterns);
          
          report?.log(`[Consolidation] ${newPatterns.length} patterns identified, ${newPatterns.filter(p => p.confirmed).length} confirmed`);
          report?.endAction(true);
        } catch (error) {
          report?.log(`[Consolidation Error] ${error}`);
          report?.endAction(false, String(error));
        }
      }

      // Run Explorer to decide next action
      const memorySummary = memory.getSummary();
      report?.log(`[Memory] Page: ${memory.getCurrentPageId()}, Observations: ${memory.getObservations(memory.getCurrentPageId() || '').length}`);
      report?.log(`[Memory Summary] ${memorySummary.slice(0, 500).replace(/\n/g, ' | ')}`);
      
      // Safety check for undefined DOM
      if (!currentDom) {
        report?.log(`[ERROR] currentDom is undefined! Attempting to refresh...`);
        const refreshedState = await page.getState();
        currentDom = domTreeToString(refreshedState.elementTree, { includeSelectors: true });
      }
      
      report?.log(`[DOM Length] ${currentDom?.length || 0} chars`);
      report?.log(`[DOM Preview] ${(currentDom || '').slice(0, 2000).replace(/\n/g, ' | ')}`);
      
      // Count confirmed patterns (robust behaviors we've learned)
      const confirmedPatterns = memory.getConfirmedPatternCount();
      
      // Log if we have a pattern warning for the LLM
      if (lastActionResult && lastActionResult.includes('PATTERN ALREADY CONFIRMED')) {
        report?.log(`[To LLM] Pattern warning included in prompt`);
      }
      
      report?.startAction('Asking LLM for next action');
      const decision = await runExplorer({
        llm,
        dom: currentDom,
        memorySummary,
        task,
        currentPageId: memory.getCurrentPageId(),
        lastActionResult, // Show the result of the previous action prominently
        discoveryCount: confirmedPatterns, // Use confirmed patterns, not raw observations
        loopWarning: isLooping ? lastActions[0] : undefined,
        report, // Pass report for prompt logging
      });
      report?.endAction(true);

      let action = decision.action;
      logger.info('Explorer decided', { actionType: action.type });

      // Hard circuit breaker: if same EXACT selector clicked 5+ times, force observe instead
      if (action.type === 'click') {
        const clickKey = `Clicked "${action.selector}"`;
        const sameClickCount = recentActions.filter(a => a.startsWith(clickKey)).length;
        if (sameClickCount >= 4) {
          report?.log(`[CIRCUIT BREAKER] Blocked repeat click on "${action.selector}" (${sameClickCount + 1}x). Forcing observe.`);
          action = { type: 'observe', what: 'page after blocked repeated click' };
        }
      }
      
      // Hard circuit breaker: if clicking a confirmed pattern too many times AND we have multiple confirmed patterns
      // Only force done() if we've explored multiple element types, not just one
      if (action.type === 'click') {
        const confirmedPattern = memory.getMatchingPattern('click');
        const confirmedCount = memory.getConfirmedPatternCount();
        
        // Only force done() if:
        // 1. We have at least 2 confirmed patterns (explored multiple element types)
        // 2. The current pattern has been clicked 4+ times (really overdoing it)
        if (confirmedPattern && confirmedPattern.confirmed && confirmedPattern.count >= 4 && confirmedCount >= 2) {
          report?.log(`[CIRCUIT BREAKER] Pattern "${confirmedPattern.targetDescription}" clicked ${confirmedPattern.count}x with ${confirmedCount} confirmed patterns. Forcing done().`);
          action = { 
            type: 'done', 
            understanding: `Exploration complete. Discovered ${confirmedCount} interaction patterns.`,
            pageType: memory.getCurrentPageId() || 'unknown',
            keyFindings: memory.getAllPatternDescriptions()
          };
        }
      }
      
      // Hard circuit breaker: if 8+ scrolls, force observe instead  
      if (action.type === 'scroll') {
        const scrollCount = recentActions.slice(-8).filter(a => a.startsWith('Scrolled')).length;
        if (scrollCount >= 7) {
          report?.log(`[CIRCUIT BREAKER] Too many scrolls (${scrollCount + 1}). Forcing observe to reassess.`);
          action = { type: 'observe', what: 'page after excessive scrolling - look for clickable elements or dialogs to interact with' };
        }
      }
      
      // Hard circuit breaker: if too many consecutive observes, force done()
      if (action.type === 'observe') {
        const last5 = recentActions.slice(-5);
        const observeCount = last5.filter(a => a.startsWith('Observed')).length;
        if (observeCount >= 4) {
          // 4+ observes in last 5 actions means we're hopelessly stuck - force done()
          report?.log(`[CIRCUIT BREAKER] ${observeCount + 1} observes in last 5 actions. Forcing done() - exploration is stuck.`);
          action = { 
            type: 'done', 
            understanding: `Exploration ended due to repeated observe loops. The page appears to be a job search with listings and apply functionality, but some interactions did not produce visible changes.`,
            pageType: memory.getCurrentPageId() || 'job_search',
            keyFindings: memory.getAllPatternDescriptions()
          };
        } else if (observeCount >= 2) {
          report?.log(`[CIRCUIT BREAKER] Too many consecutive observes (${observeCount + 1}). Injecting warning.`);
          memory.enrichCurrentPage(`WARNING: You have called observe() ${observeCount + 1} times in a row. The DOM is already visible above. Click on an element or scroll to explore further.`);
        }
      }

      // Handle the action
      if (action.type === 'done') {
        // Run final consolidation before finishing
        report?.startAction('Final consolidation');
        const consolidationInput = memory.getConsolidationInput();
        
        if (consolidationInput.rawObservations.length > 0 || consolidationInput.pendingObservations.length > 0) {
          try {
            const consolidationResult = await runConsolidator({
              llm,
              input: {
                rawObservations: consolidationInput.rawObservations,
                existingPatterns: consolidationInput.existingPatterns,
                truncatedDom: currentDom.slice(0, 3000),
              },
            });
            
            const newPatterns = consolidatorOutputToPatterns(consolidationResult);
            memory.updatePatternsFromConsolidation(newPatterns);
            report?.log(`[Final Consolidation] ${newPatterns.length} patterns, ${newPatterns.filter(p => p.confirmed).length} confirmed`);
            report?.endAction(true);
          } catch (error) {
            report?.log(`[Final Consolidation Error] ${error}`);
            report?.endAction(false, String(error));
          }
        } else {
          report?.endAction(true);
        }
        
        // Exploration complete - summarize all pages
        logger.info('Exploration complete, summarizing pages');
        
        for (const pageId of memory.getPageIds()) {
          const pageNode = memory.getPage(pageId);
          if (pageNode && pageNode.rawObservations.length > 0) {
            report?.startAction(`Summarizing page: ${pageId}`);
            const summary = await runSummarizer({
              llm,
              pageId,
              observations: pageNode.rawObservations,
              currentUnderstanding: pageNode.understanding,
            });
            memory.updatePageSummary(pageId, summary.summary);
            report?.endAction(true);
          }
        }

        // Add final understanding to current page
        memory.enrichCurrentPage(action.understanding);

        // Merge LLM-provided keyElements with memory-discovered selectors
        const discoveredSelectors = memory.getDiscoveredSelectors();
        const llmKeyElements = action.keyElements || {};
        
        // Merge: prefer LLM-provided values, fall back to discovered
        const mergedKeyElements = {
          ...discoveredSelectors,
          ...Object.fromEntries(
            Object.entries(llmKeyElements).filter(([_, v]) => v !== undefined)
          ),
        };

        const phaseOutput = JSON.stringify({
          understanding: action.understanding,
          pageType: action.pageType,
          keyFindings: action.keyFindings,
          keyElements: mergedKeyElements,
          pagesExplored: memory.getPageIds(),
        }, null, 2);
        report?.addPhaseOutput('exploration', phaseOutput, true, 0);

        return {
          success: true,
          pages: memory.getAllPages(),
          navigationPath: memory.getNavigationPath(),
          finalUnderstanding: memory.getFinalUnderstanding(),
          keyElements: mergedKeyElements,
        };
      }

      // Execute the action
      const result = await executeAction(page, action, report);
      
      // Analyze what changed using ChangeAnalyzer
      let actionDesc: string;
      let changeAnalysis: Awaited<ReturnType<typeof runChangeAnalyzer>> | null = null;
      
      if (result.success && result.beforeDom && result.afterDom) {
        report?.startAction('Analyzing change');
        changeAnalysis = await runChangeAnalyzer({
          llm,
          action: describeActionSimple(action, result),
          beforeUrl: result.oldUrl || previousUrl || '',
          afterUrl: result.newUrl || previousUrl || '',
          beforeDom: result.beforeDom,
          afterDom: result.afterDom,
          knownPageTypes: memory.getPageIds(),
          currentPageType: memory.getCurrentPageId() || undefined,
        });
        report?.endAction(true);
        
        // Build rich action description
        actionDesc = `${describeActionSimple(action, result)} → ${changeAnalysis.description} [${changeAnalysis.changeType}]`;
        
        // Only record observations for actions that actually did something
        // Skip no_change and minor_change - they don't teach us anything useful
        if (changeAnalysis.changeType !== 'no_change' && changeAnalysis.changeType !== 'minor_change') {
          memory.addRawObservation({
            action: action.type,
            selector: (action as { selector?: string }).selector,
            elementType: changeAnalysis.elementType,
            effect: changeAnalysis.description,
            changeType: changeAnalysis.changeType,
          });
          report?.log(`[Observation Added] ${action.type} ${changeAnalysis.elementType} → ${changeAnalysis.description}`);
        } else {
          report?.log(`[No Observation] ${action.type} produced ${changeAnalysis.changeType} - skipping`);
        }
        
        // If it's a new page type, update memory
        if (changeAnalysis.isNewPageType && changeAnalysis.urlChanged) {
          // Summarize old page first
          const oldPageId = memory.getCurrentPageId();
          if (oldPageId) {
            const oldPage = memory.getPage(oldPageId);
            if (oldPage && oldPage.rawObservations.length > 0) {
              const summary = await runSummarizer({
                llm,
                pageId: oldPageId,
                observations: oldPage.rawObservations,
                currentUnderstanding: oldPage.understanding,
              });
              memory.updatePageSummary(oldPageId, summary.summary);
            }
          }
          
          // Add new page to memory
          memory.updateFromClassification({
            pageId: changeAnalysis.pageType,
            isNewPage: true,
            isSamePage: false,
            understanding: changeAnalysis.pageUnderstanding,
            cameFrom: changeAnalysis.cameFrom,
            viaAction: changeAnalysis.viaAction,
          }, previousUrl);
          
          report?.log(`[New Page] ${changeAnalysis.pageType}: ${changeAnalysis.pageUnderstanding}`);
        }
        
        // Update tracking
        previousUrl = result.newUrl || previousUrl;
      } else if (!result.success && result.error) {
        actionDesc = `Failed: ${result.error}`;
        memory.enrichCurrentPage(`Failed: ${result.error}`);
      } else {
        actionDesc = describeActionSimple(action, result);
      }
      
      recentActions.push(actionDesc);
      
      // Store last action result for prominent display to LLM next iteration
      // CRITICAL: If this action matched a confirmed pattern (after enrichment), tell the LLM explicitly
      lastActionResult = actionDesc;
      
      if (result.success && action.type === 'click' && changeAnalysis) {
        const matchedPattern = memory.getMatchingPattern('click', changeAnalysis.elementType);
        if (matchedPattern && matchedPattern.confirmed) {
          lastActionResult = `${actionDesc}

⚠️ PATTERN ALREADY CONFIRMED: This action (click ${matchedPattern.targetDescription}) matches behavior you already understand.
   Pattern: "${matchedPattern.action} ${matchedPattern.targetDescription} → ${matchedPattern.effect}" (seen ${matchedPattern.count}x)
   
   You should now try a DIFFERENT element type (filters, apply button, scroll) or call done().`;
          report?.log(`[PATTERN WARNING] Warned LLM about confirmed pattern: ${matchedPattern.targetDescription}`);
        }
      }
    }

    // Max steps reached - run final consolidation
    report?.startAction('Final consolidation (max steps)');
    const consolidationInput = memory.getConsolidationInput();
    
    if (consolidationInput.rawObservations.length > 0) {
      try {
        const consolidationResult = await runConsolidator({
          llm,
          input: {
            rawObservations: consolidationInput.rawObservations,
            existingPatterns: consolidationInput.existingPatterns,
          },
        });
        
        const newPatterns = consolidatorOutputToPatterns(consolidationResult);
        memory.updatePatternsFromConsolidation(newPatterns);
        report?.endAction(true);
      } catch (error) {
        report?.endAction(false, String(error));
      }
    } else {
      report?.endAction(true);
    }
    
    logger.info('Max exploration steps reached');
    
    return {
      success: false,
      pages: memory.getAllPages(),
      navigationPath: memory.getNavigationPath(),
      finalUnderstanding: memory.getFinalUnderstanding(),
      error: 'Max exploration steps reached',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Orchestrator error', { error: errorMessage });
    
    return {
      success: false,
      pages: memory.getAllPages(),
      navigationPath: memory.getNavigationPath(),
      finalUnderstanding: memory.getFinalUnderstanding(),
      error: errorMessage,
    };
  }
}

async function executeAction(
  page: Page,
  action: ExplorerAction,
  report?: ReportService
): Promise<ActionResult> {
  const oldUrl = (await page.getState()).url;

  switch (action.type) {
    case 'click': {
      report?.startAction('Tool: click', JSON.stringify({ selector: action.selector, reason: action.reason }));
      try {
        // Capture DOM before click
        const beforeState = await page.getState();
        const beforeDom = domTreeToString(beforeState.elementTree, { includeSelectors: true });
        
        await page.clickSelector(action.selector);
        // Wait for any navigation or DOM updates
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Capture DOM after click
        const newState = await page.getState();
        const afterDom = domTreeToString(newState.elementTree, { includeSelectors: true });
        const urlChanged = newState.url !== oldUrl;
        
        report?.endAction(true);
        return { 
          success: true, 
          urlChanged, 
          newUrl: newState.url, 
          oldUrl,
          beforeDom,
          afterDom,
          actionDescription: `Clicked "${action.selector}"`,
        };
      } catch (error) {
        const msg = `Element not found or not clickable: ${action.selector}`;
        report?.endAction(false, msg);
        return { success: false, urlChanged: false, error: msg };
      }
    }

    case 'scroll': {
      report?.startAction('Tool: scroll', action.direction);
      try {
        if (action.direction === 'down') {
          await page.scrollToNextPage();
        } else {
          await page.scrollToPreviousPage();
        }
        report?.endAction(true);
        return { success: true, urlChanged: false };
      } catch (error) {
        const msg = 'Scroll failed';
        report?.endAction(false, msg);
        return { success: false, urlChanged: false, error: msg };
      }
    }

    case 'type_text': {
      report?.startAction('Tool: type_text', JSON.stringify({ selector: action.selector, text: action.text }));
      try {
        await page.typeSelector(action.selector, action.text);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for any autocomplete/validation
        report?.endAction(true);
        return { success: true, urlChanged: false };
      } catch (error) {
        const msg = `Input not found: ${action.selector}`;
        report?.endAction(false, msg);
        return { success: false, urlChanged: false, error: msg };
      }
    }

    case 'observe': {
      report?.startAction('Tool: observe', action.what);
      const state = await page.getState();
      const dom = domTreeToString(state.elementTree, { includeSelectors: true });
      report?.endAction(true);
      return { success: true, urlChanged: false, dom };
    }

    default:
      return { success: false, urlChanged: false, error: 'Unknown action' };
  }
}

function describeActionSimple(action: ExplorerAction, result: ActionResult): string {
  switch (action.type) {
    case 'click':
      if (result.urlChanged) {
        return `Clicked "${action.selector}" → navigated`;
      }
      return `Clicked "${action.selector}"`;
    case 'scroll':
      return `Scrolled ${action.direction}`;
    case 'type_text':
      return `Typed "${action.text}" into ${action.selector}`;
    case 'observe':
      // Include what was visible - the next LLM call will see the full DOM anyway
      return `Observed ${action.what} (DOM refreshed - see CURRENT DOM below for details)`;
    default:
      return 'Action performed';
  }
}
