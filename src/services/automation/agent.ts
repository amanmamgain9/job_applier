/**
 * Automation Agent Service
 * 
 * Wrapper around @riruru/automation-core for Chrome Extension context.
 * Provides job discovery and application automation.
 */

import { AutomationAgent, BrowserContext } from '@riruru/automation-core';
import type { TaskResult, ExecutionEvent } from '@riruru/automation-core';
import { getLLMConfig } from './config';
import type { DiscoveryEvent, DiscoveryEventHandler } from './types';

let agent: AutomationAgent | null = null;
let context: BrowserContext | null = null;
const eventHandlers: Set<DiscoveryEventHandler> = new Set();

/**
 * Initialize the automation agent
 * Must be called from background script context
 */
export async function initAgent(tabId?: number): Promise<void> {
  console.log('[Agent] Initializing...', { tabId });
  
  // Cleanup existing agent if any
  await cleanupAgent();

  console.log('[Agent] Getting LLM config...');
  const llmConfig = getLLMConfig();
  console.log('[Agent] LLM config:', { provider: llmConfig.provider, model: llmConfig.model, hasKey: !!llmConfig.apiKey });

  // Create browser context - open a NEW tab for automation, don't use existing tab
  console.log('[Agent] Creating new tab for automation...');
  try {
    if (tabId) {
      // Use specified tab
      context = await BrowserContext.fromTab(tabId);
    } else {
      // Create a new tab and attach to it
      const newTab = await chrome.tabs.create({ 
        url: 'about:blank',
        active: true  // Focus the new tab so user can see highlights
      });
      
      if (!newTab.id) {
        throw new Error('Failed to create new tab');
      }
      
      console.log('[Agent] New tab created:', newTab.id);
      context = await BrowserContext.fromTab(newTab.id);
    }
    console.log('[Agent] Browser context created');
  } catch (err) {
    console.error('[Agent] Failed to create browser context:', err);
    throw err;
  }

  console.log('[Agent] Creating AutomationAgent...');
  agent = new AutomationAgent({
    context,
    llm: llmConfig,
    options: {
      maxSteps: 50,
      maxActionsPerStep: 5,
      maxFailures: 3,
      useVision: false,
    },
  });
  console.log('[Agent] AutomationAgent created');

  // Forward events to our handlers
  agent.on('all', (event: ExecutionEvent) => {
    console.log('[Agent] Event:', event.type, event.details);
    const discoveryEvent = mapExecutionEvent(event);
    if (discoveryEvent) {
      notifyHandlers(discoveryEvent);
    }
  });
}

/**
 * Execute a natural language task
 */
export async function executeTask(task: string): Promise<TaskResult> {
  if (!agent) {
    throw new Error('Agent not initialized. Call initAgent() first.');
  }

  return agent.execute(task);
}

/**
 * Stop current execution
 */
export async function stopAgent(): Promise<void> {
  if (agent) {
    await agent.stop();
  }
}

/**
 * Cleanup agent resources
 */
export async function cleanupAgent(): Promise<void> {
  if (agent) {
    await agent.cleanup();
    agent = null;
  }
  if (context) {
    await context.cleanup();
    context = null;
  }
}

/**
 * Check if agent is initialized and ready
 */
export function isAgentReady(): boolean {
  return agent !== null;
}

/**
 * Get current browser context
 */
export function getBrowserContext(): BrowserContext | null {
  return context;
}

/**
 * Subscribe to discovery events
 */
export function onDiscoveryEvent(handler: DiscoveryEventHandler): () => void {
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

/**
 * Map automation-core events to our discovery events
 */
function mapExecutionEvent(event: ExecutionEvent): DiscoveryEvent | null {
  switch (event.type) {
    case 'step_start':
    case 'step_ok':
      return {
        type: 'step',
        payload: {
          step: event.step,
          maxSteps: event.maxSteps,
          details: event.details,
        },
      };

    case 'step_fail':
    case 'action_fail':
    case 'task_fail':
      return {
        type: 'error',
        payload: {
          error: event.details,
        },
      };

    case 'task_ok':
      return {
        type: 'status_change',
        payload: {
          status: 'idle',
          details: 'Task completed',
        },
      };

    case 'task_cancel':
      return {
        type: 'status_change',
        payload: {
          status: 'idle',
          details: 'Task cancelled',
        },
      };

    default:
      return null;
  }
}

function notifyHandlers(event: DiscoveryEvent): void {
  eventHandlers.forEach((handler) => {
    try {
      handler(event);
    } catch (err) {
      console.error('Discovery event handler error:', err);
    }
  });
}

