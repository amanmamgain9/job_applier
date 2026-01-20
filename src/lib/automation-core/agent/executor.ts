/**
 * Executor - Orchestrates the execution of browser automation tasks
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { NavigatorAgent } from './navigator';
import { AgentContext, type NavigatorResult } from './types';
import { MessageManager, MessageManagerSettings } from './messages/service';
import { NavigatorPrompt } from './prompts/navigator';
import type { BrowserContext } from '../browser/context';
import type { AgentOptions, TaskResult, StepRecord, AgentOutput } from '../types';
import { DEFAULT_AGENT_OPTIONS, ActionResult } from '../types';
import { createLogger } from '../utils/logger';
import { MaxStepsReachedError, MaxFailuresReachedError } from './errors';

const logger = createLogger('Executor');

export interface ExecutorConfig {
  taskId: string;
  task: string;
  browserContext: BrowserContext;
  llm: BaseChatModel;
  options?: Partial<AgentOptions>;
  provider?: string;
}

export class Executor {
  private context: AgentContext;
  private navigator: NavigatorAgent;
  private config: ExecutorConfig;
  private isDone: boolean = false;
  private finalAnswer: string = '';
  private success: boolean = false;

  constructor(config: ExecutorConfig) {
    this.config = config;

    // Merge options with defaults
    const options: AgentOptions = {
      ...DEFAULT_AGENT_OPTIONS,
      ...config.options,
    };

    // Create message manager with sliding window for history pruning
    const messageManagerSettings = new MessageManagerSettings({
      maxInputTokens: options.maxInputTokens,
      includeAttributes: options.includeAttributes,
      maxHistoryMessages: options.maxHistoryMessages,
    });
    const messageManager = new MessageManager(messageManagerSettings);

    // Create agent context
    this.context = new AgentContext({
      taskId: config.taskId,
      task: config.task,
      browserContext: config.browserContext,
      messageManager,
      options,
    });

    // Initialize message manager with system prompt
    const prompt = new NavigatorPrompt(options.maxActionsPerStep);
    messageManager.initTaskMessages(prompt.getSystemMessage(), config.task);

    // Create navigator agent
    this.navigator = new NavigatorAgent(
      config.llm,
      this.context,
      config.provider,
    );
  }

  /**
   * Register an event handler
   */
  onEvent(handler: (event: import('../types').ExecutionEvent) => void): void {
    this.context.onEvent(handler);
  }

  /**
   * Execute the task
   */
  async execute(): Promise<TaskResult> {
    console.log('[Executor] ========== STARTING TASK ==========');
    console.log('[Executor] Task:', this.config.task.substring(0, 200) + '...');
    logger.info(`Starting execution of task: ${this.config.task}`);
    this.context.emitEvent('task_start', `Starting task: ${this.config.task}`);

    try {
      while (!this.context.shouldStop() && !this.isDone) {
        console.log(`[Executor] --- Starting step ${this.context.nSteps + 1} ---`);
        await this.executeStep();
        console.log(`[Executor] --- Step ${this.context.nSteps} finished. isDone=${this.isDone}, failures=${this.context.consecutiveFailures} ---`);
      }

      console.log('[Executor] Loop exited. stopped=', this.context.stopped, 'isDone=', this.isDone);

      if (this.context.stopped) {
        console.log('[Executor] Task was cancelled');
        this.context.emitEvent('task_cancel', 'Task was cancelled');
        return this.buildResult(false, 'Task was cancelled');
      }

      if (this.context.nSteps >= this.context.options.maxSteps && !this.isDone) {
        console.log('[Executor] Max steps reached!');
        throw new MaxStepsReachedError(`Maximum steps reached: ${this.context.options.maxSteps}`);
      }

      if (this.context.consecutiveFailures >= this.context.options.maxFailures) {
        console.log('[Executor] Max failures reached!');
        throw new MaxFailuresReachedError(`Maximum failures reached: ${this.context.options.maxFailures}`);
      }

      console.log('[Executor] ========== TASK COMPLETED ==========');
      console.log('[Executor] Final answer:', this.finalAnswer?.substring(0, 500));
      this.context.emitEvent('task_ok', this.finalAnswer || 'Task completed');
      return this.buildResult(this.success, undefined, this.finalAnswer);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Executor] ========== TASK FAILED ==========');
      console.error('[Executor] Error:', errorMsg);
      logger.error('Execution failed:', errorMsg);
      this.context.emitEvent('task_fail', errorMsg);
      return this.buildResult(false, errorMsg);
    }
  }

  /**
   * Execute a single step
   */
  private async executeStep(): Promise<void> {
    this.context.incrementStep();
    const step = this.context.nSteps;

    console.log(`[Executor] Step ${step}/${this.context.options.maxSteps} - calling navigator.execute()`);
    logger.info(`Executing step ${step}/${this.context.options.maxSteps}`);
    this.context.emitEvent('step_start', `Step ${step}`);

    try {
      console.log(`[Executor] Step ${step} - waiting for navigator response...`);
      const result = await this.navigator.execute();
      console.log(`[Executor] Step ${step} - navigator returned:`, {
        hasError: !!result.error,
        error: result.error,
        done: result.result?.done,
        actionsCount: result.result?.actions?.length || 0,
      });

      if (result.error) {
        console.log(`[Executor] Step ${step} - FAILED:`, result.error);
        this.context.recordFailure();
        this.context.emitEvent('step_fail', result.error);

        // Add retry delay
        if (this.context.consecutiveFailures < this.context.options.maxFailures) {
          console.log(`[Executor] Waiting ${this.context.options.retryDelay}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, this.context.options.retryDelay * 1000));
        }
        return;
      }

      this.context.recordSuccess();

      // Check if task is done
      if (result.result?.done) {
        this.isDone = true;
        this.finalAnswer = this.extractFinalAnswer(result);
        this.success = this.extractSuccess(result);
        console.log(`[Executor] Step ${step} - TASK DONE! Final answer:`, this.finalAnswer?.substring(0, 200));
        logger.info('Task completed:', this.finalAnswer);
      } else {
        // Log what actions were taken
        const actions = result.result?.actions || [];
        for (const action of actions) {
          const actionName = Object.keys(action)[0];
          console.log(`[Executor] Step ${step} - Action: ${actionName}`, action[actionName]);
        }
      }

      // Record step in history
      this.recordStep(step, result);

      this.context.emitEvent('step_ok', `Step ${step} completed`);
    } catch (error) {
      this.context.recordFailure();
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Executor] Step ${step} - EXCEPTION:`, errorMsg);
      this.context.emitEvent('step_fail', errorMsg);

      if (this.context.consecutiveFailures < this.context.options.maxFailures) {
        console.log(`[Executor] Waiting ${this.context.options.retryDelay}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, this.context.options.retryDelay * 1000));
      }
    }
  }

  /**
   * Extract final answer from result
   */
  private extractFinalAnswer(result: AgentOutput<NavigatorResult>): string {
    if (result.result?.actionResults) {
      for (const actionResult of result.result.actionResults) {
        if (actionResult.isDone && actionResult.extractedContent) {
          return actionResult.extractedContent;
        }
      }
    }
    return result.result?.output?.current_state?.memory || '';
  }

  /**
   * Extract success status from result
   */
  private extractSuccess(result: AgentOutput<NavigatorResult>): boolean {
    if (result.result?.actionResults) {
      for (const actionResult of result.result.actionResults) {
        if (actionResult.isDone) {
          return actionResult.success;
        }
      }
    }
    return true;
  }

  /**
   * Record step in history
   */
  private recordStep(step: number, result: AgentOutput<NavigatorResult>): void {
    const actions = result.result?.actions || [];
    const actionResults = result.result?.actionResults || [];

    const stepRecord: StepRecord = {
      step,
      goal: result.result?.output?.current_state?.next_goal || '',
      actions: actions.map((action, i) => ({
        name: Object.keys(action)[0],
        args: action[Object.keys(action)[0]] as Record<string, unknown>,
        result: actionResults[i] || new ActionResult(),
      })),
      url: '', // Will be populated from browser state
      timestamp: Date.now(),
    };

    this.context.stepHistory.push(stepRecord);
  }

  /**
   * Build the final result
   */
  private buildResult(success: boolean, error?: string, finalAnswer?: string): TaskResult {
    // If no final answer but we have cached content from steps, collect it
    // This helps recover partial data when task fails prematurely
    let answer = finalAnswer;
    if (!answer) {
      const cachedContent = this.collectCachedContent();
      if (cachedContent) {
        console.log('[Executor] No final answer, using cached content:', cachedContent.substring(0, 200));
        answer = cachedContent;
      }
    }
    
    return {
      success,
      error,
      steps: this.context.stepHistory,
      finalUrl: '', // Will be populated from browser state
      finalAnswer: answer,
    };
  }

  /**
   * Collect cached content from step history
   * This extracts content from cache_content actions for recovery when task fails
   */
  private collectCachedContent(): string | null {
    const cachedItems: string[] = [];
    
    for (const step of this.context.stepHistory) {
      for (const action of step.actions) {
        // Look for cache_content actions
        if (action.name === 'cache_content' && action.result?.extractedContent) {
          // Extract the content - it's wrapped in <content> tags
          const content = action.result.extractedContent;
          const match = content.match(/<content>([\s\S]*?)<\/content>/);
          if (match) {
            cachedItems.push(match[1].trim());
          } else {
            cachedItems.push(content);
          }
        }
      }
    }
    
    if (cachedItems.length === 0) {
      return null;
    }
    
    // Try to extract job objects from cached content and format as JSON array
    const jobObjects: unknown[] = [];
    for (const item of cachedItems) {
      // Look for JSON objects in the cached content
      const jsonMatch = item.match(/\{[\s\S]*?"title"[\s\S]*?\}/g);
      if (jsonMatch) {
        for (const jsonStr of jsonMatch) {
          try {
            const obj = JSON.parse(jsonStr);
            jobObjects.push(obj);
          } catch {
            // Not valid JSON, skip
          }
        }
      }
    }
    
    if (jobObjects.length > 0) {
      console.log(`[Executor] Recovered ${jobObjects.length} job objects from cached content`);
      return JSON.stringify(jobObjects);
    }
    
    // Return raw cached items if no JSON found
    return cachedItems.join('\n');
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.context.stop();
  }
}

