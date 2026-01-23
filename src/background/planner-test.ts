/**
 * StrategyPlanner Test - Run StrategyPlanner on the active tab
 * 
 * DEV TOOL: This file is for testing the new agent architecture.
 * Remove before production.
 */

import { BrowserContext, createChatModel, StrategyPlanner, createBrowserTools } from '@/lib/automation-core';
import { logger } from '@shared/utils';

export interface PlannerTestResult {
  success: boolean;
  strategy?: string;
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  errors?: string[];
  error?: string;
  duration?: number;
  url?: string;
}

/**
 * Run StrategyPlanner on the currently active tab
 */
export async function testStrategyPlannerOnActiveTab(
  task?: string
): Promise<PlannerTestResult> {
  const startTime = Date.now();
  
  // Check for API key
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'VITE_GEMINI_API_KEY not configured. Add it to your .env file.',
    };
  }

  try {
    logger.info('[PlannerTest] Starting StrategyPlanner test...');
    
    // Get browser context and current page
    const context = await BrowserContext.fromActiveTab();
    const page = await context.getCurrentPage();
    
    if (!page) {
      return { success: false, error: 'No active page found' };
    }

    const url = page.url();
    logger.info('[PlannerTest] Page URL:', url);

    // Attach puppeteer if not already
    if (!page.attached) {
      logger.info('[PlannerTest] Attaching Puppeteer...');
      await page.attachPuppeteer();
    }

    // Get DOM snapshot
    logger.info('[PlannerTest] Getting DOM state...');
    const state = await page.getState();
    if (!state?.elementTree) {
      return { success: false, error: 'Could not get page state - DOM tree is empty' };
    }

    const domString = state.elementTree.clickableElementsToString();
    logger.info('[PlannerTest] DOM elements:', `${domString.length} chars`);

    if (domString.length < 100) {
      return { 
        success: false, 
        error: 'DOM snapshot too small - page may not be fully loaded',
        url,
      };
    }

    // Create LLM
    logger.info('[PlannerTest] Creating LLM...');
    const llm = createChatModel({
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey,
    });

    // Create planner with limited tool calls for testing
    const planner = new StrategyPlanner(llm, { maxToolCalls: 5 });

    // Create browser tools (real browser interaction)
    const tools = createBrowserTools(page);

    // Run planning
    const taskDescription = task || 'Understand this page and explain how to extract all items from it.';
    logger.info('[PlannerTest] Starting strategy planning...');
    logger.info('[PlannerTest] Task:', taskDescription);

    const result = await planner.plan({
      dom: domString,
      url,
      title: (await page.title()) || 'Unknown',
      task: taskDescription,
    }, tools);

    const duration = Date.now() - startTime;

    logger.info('[PlannerTest] Strategy planning complete');
    logger.info('[PlannerTest] Tool calls:', `${result.toolCalls.length}`);
    logger.info('[PlannerTest] Duration:', `${duration}ms`);

    return {
      success: true,
      strategy: result.strategy,
      toolCalls: result.toolCalls,
      errors: result.errors,
      duration,
      url,
    };

  } catch (error) {
    logger.error('[PlannerTest] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}
