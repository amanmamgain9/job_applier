/**
 * AutomationAgent - High-level wrapper for browser automation
 *
 * This is the main entry point for the automation-core library.
 * It provides a simple API for executing browser automation tasks.
 */

import { BrowserContext } from './browser/context';
import { Executor } from './agent/executor';
import { createChatModel, validateLLMConfig } from './llm/factory';
import type { LLMConfig, TaskResult, ExecutionEvent, AgentOptions } from './types';
import { DEFAULT_AGENT_OPTIONS } from './types';
import type { BrowserContextConfig } from './browser/types';
import { createLogger } from './utils/logger';

const logger = createLogger('AutomationAgent');

/**
 * Configuration for AutomationAgent
 */
export interface AgentConfig {
  /**
   * Browser context to use for automation.
   * If not provided, will create one from the active tab.
   */
  context?: BrowserContext;

  /**
   * LLM configuration
   */
  llm: LLMConfig;

  /**
   * Agent options
   */
  options?: Partial<AgentOptions>;

  /**
   * Browser context configuration
   */
  browserConfig?: Partial<BrowserContextConfig>;
}

/**
 * Event handler function type
 */
export type EventHandler = (event: ExecutionEvent) => void;

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * AutomationAgent - Simple interface for browser automation
 *
 * @example
 * ```typescript
 * import { AutomationAgent, BrowserContext } from '@nanobrowser/automation-core';
 *
 * const context = await BrowserContext.fromActiveTab();
 * const agent = new AutomationAgent({
 *   context,
 *   llm: {
 *     provider: 'anthropic',
 *     apiKey: 'sk-...',
 *     model: 'claude-sonnet-4-20250514'
 *   }
 * });
 *
 * agent.on('step', (event) => console.log(event));
 *
 * const result = await agent.execute("Click the Jobs button");
 * console.log(result);
 * ```
 */
export class AutomationAgent {
  private config: AgentConfig;
  private context: BrowserContext | null = null;
  private executor: Executor | null = null;
  private eventHandlers: Map<string, EventHandler[]> = new Map();

  constructor(config: AgentConfig) {
    // Validate LLM config
    const validation = validateLLMConfig(config.llm);
    if (!validation.valid) {
      throw new Error(`Invalid LLM config: ${validation.errors.join(', ')}`);
    }

    this.config = config;
    this.context = config.context || null;
  }

  /**
   * Execute a task described in natural language
   *
   * @param task - The task to execute (e.g., "Click the Jobs button")
   * @returns TaskResult with success status, steps, and any extracted data
   */
  async execute(task: string): Promise<TaskResult> {
    logger.info(`Executing task: ${task}`);

    // Ensure we have a browser context
    if (!this.context) {
      this.context = await BrowserContext.fromActiveTab(this.config.browserConfig);
    }

    // Create LLM
    const llm = createChatModel(this.config.llm);

    // Merge options
    const options: AgentOptions = {
      ...DEFAULT_AGENT_OPTIONS,
      ...this.config.options,
    };

    // Create executor
    this.executor = new Executor({
      taskId: generateTaskId(),
      task,
      browserContext: this.context,
      llm,
      options,
      provider: this.config.llm.provider,
    });

    // Wire up event forwarding
    this.setupEventForwarding();

    try {
      const result = await this.executor.execute();
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Execution failed:', errorMsg);
      return {
        success: false,
        error: errorMsg,
        steps: [],
        finalUrl: '',
      };
    }
  }

  /**
   * Subscribe to execution events
   *
   * @param event - Event type to subscribe to
   * @param handler - Handler function
   */
  on(event: 'step' | 'action' | 'error' | 'complete' | 'all', handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Stop the current execution
   */
  async stop(): Promise<void> {
    if (this.executor) {
      this.executor.stop();
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.context) {
      await this.context.cleanup();
      this.context = null;
    }
    this.executor = null;
  }

  /**
   * Get the browser context
   */
  getBrowserContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * Set up event forwarding from executor to our handlers
   */
  private setupEventForwarding(): void {
    if (!this.executor) return;

    this.executor.onEvent((event) => {
      // Map internal event types to our simplified types
      let eventType: string;
      switch (event.type) {
        case 'step_start':
        case 'step_ok':
        case 'step_fail':
          eventType = 'step';
          break;
        case 'action_start':
        case 'action_ok':
        case 'action_fail':
          eventType = 'action';
          break;
        case 'llm_start':
        case 'llm_ok':
        case 'llm_fail':
          eventType = 'llm';
          break;
        case 'task_fail':
          eventType = 'error';
          break;
        case 'task_ok':
          eventType = 'complete';
          break;
        default:
          eventType = 'all';
      }

      // Notify handlers
      const handlers = this.eventHandlers.get(eventType) || [];
      const allHandlers = this.eventHandlers.get('all') || [];

      for (const handler of [...handlers, ...allHandlers]) {
        try {
          handler(event);
        } catch (error) {
          logger.error('Error in event handler:', error);
        }
      }
    });
  }
}

