/**
 * Agent-related types
 */

import type { BrowserContext } from '../browser/context';
import type { BrowserStateHistory } from '../browser/types';
import type { AgentOptions, ExecutionEvent, ExecutionEventType, StepRecord } from '../types';
import { ActionResult, DEFAULT_AGENT_OPTIONS } from '../types';
import type { MessageManager } from './messages/service';

// Reference re-exported values to satisfy linting
void ActionResult;
void DEFAULT_AGENT_OPTIONS;

export type ActionEventState = 'start' | 'ok' | 'fail';

/**
 * Event handler type for execution events
 */
export type ExecutionEventHandler = (event: ExecutionEvent) => void;

/**
 * AgentContext - Shared context for agent execution
 */
export class AgentContext {
  public readonly taskId: string;
  public readonly task: string;
  public readonly browserContext: BrowserContext;
  public readonly messageManager: MessageManager;
  public readonly options: AgentOptions;
  
  // Execution state
  public nSteps: number = 0;
  public consecutiveFailures: number = 0;
  public stopped: boolean = false;
  
  // History tracking
  public stepHistory: StepRecord[] = [];
  public stateHistory: BrowserStateHistory[] = [];
  
  // Event handling
  private eventHandlers: ExecutionEventHandler[] = [];
  
  constructor(params: {
    taskId: string;
    task: string;
    browserContext: BrowserContext;
    messageManager: MessageManager;
    options: AgentOptions;
  }) {
    this.taskId = params.taskId;
    this.task = params.task;
    this.browserContext = params.browserContext;
    this.messageManager = params.messageManager;
    this.options = params.options;
  }

  /**
   * Register an event handler
   */
  onEvent(handler: ExecutionEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit an execution event
   */
  emitEvent(type: ExecutionEventType, details?: string): void {
    const event: ExecutionEvent = {
      type,
      taskId: this.taskId,
      step: this.nSteps,
      maxSteps: this.options.maxSteps,
      details,
      timestamp: Date.now(),
    };
    
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    }
  }

  /**
   * Emit an action event
   */
  emitActionEvent(action: string, state: ActionEventState, details?: string): void {
    let type: ExecutionEventType;
    switch (state) {
      case 'start':
        type = 'action_start';
        break;
      case 'ok':
        type = 'action_ok';
        break;
      case 'fail':
        type = 'action_fail';
        break;
    }
    
    const event: ExecutionEvent = {
      type,
      taskId: this.taskId,
      step: this.nSteps,
      action,
      details,
      timestamp: Date.now(),
    };
    
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    }
  }

  /**
   * Check if execution should stop
   */
  shouldStop(): boolean {
    return this.stopped || this.nSteps >= this.options.maxSteps || this.consecutiveFailures >= this.options.maxFailures;
  }

  /**
   * Increment step counter
   */
  incrementStep(): void {
    this.nSteps += 1;
  }

  /**
   * Record a failure
   */
  recordFailure(): void {
    this.consecutiveFailures += 1;
  }

  /**
   * Reset failure counter on success
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.stopped = true;
  }
}

/**
 * Navigator output structure
 */
export interface NavigatorOutput {
  current_state: {
    evaluation_previous_goal: string;
    memory: string;
    next_goal: string;
  };
  action: Array<Record<string, unknown>>;
}

/**
 * Result from Navigator execution
 */
export interface NavigatorResult {
  done: boolean;
  output?: NavigatorOutput;
  actions?: Array<Record<string, unknown>>;
  actionResults?: ActionResult[];
  error?: string;
}

// Re-export from types
export type { AgentOutput, AgentOptions, ExecutionEvent, ExecutionEventType, StepRecord } from '../types';
export { ActionResult, DEFAULT_AGENT_OPTIONS } from '../types';

