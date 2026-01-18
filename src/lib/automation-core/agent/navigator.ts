/**
 * NavigatorAgent - Handles browser navigation and action execution
 */

import { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseAgent, type BaseAgentOptions } from './base';
import { NavigatorPrompt } from './prompts/navigator';
import { ActionBuilder, buildDynamicActionSchema, type Action } from './actions/builder';
import type { AgentContext, NavigatorOutput, NavigatorResult } from './types';
import { ActionResult, type AgentOutput } from '../types';
import { createLogger } from '../utils/logger';
import { capTextLength } from '../browser/util';

const logger = createLogger('NavigatorAgent');

const currentStateSchema = z.object({
  evaluation_previous_goal: z.string().describe('Evaluation of the previous goal'),
  memory: z.string().describe('Memory of the agent'),
  next_goal: z.string().describe('Next goal to achieve'),
});

function buildNavigatorOutputSchema(actions: Action[]): z.ZodType<NavigatorOutput> {
  const actionSchema = buildDynamicActionSchema(actions);
  return z.object({
    current_state: currentStateSchema,
    action: z.array(actionSchema).describe('List of actions to execute'),
  }) as z.ZodType<NavigatorOutput>;
}

export class NavigatorAgent extends BaseAgent<z.ZodType<NavigatorOutput>, NavigatorResult> {
  private actionRegistry: Map<string, Action> = new Map();

  constructor(
    chatLLM: BaseChatModel,
    context: AgentContext,
    provider?: string,
  ) {
    const actionBuilder = new ActionBuilder(context);
    const navigatorActions = actionBuilder.buildDefaultActions();
    const outputSchema = buildNavigatorOutputSchema(navigatorActions);

    const prompt = new NavigatorPrompt(context.options.maxActionsPerStep);
    const options: BaseAgentOptions = {
      chatLLM,
      context,
      prompt,
      provider,
    };

    super(outputSchema, options, { id: 'navigator' });

    for (const action of navigatorActions) {
      this.actionRegistry.set(action.name(), action);
    }
  }

  /**
   * Execute a step of navigation
   */
  async execute(): Promise<AgentOutput<NavigatorResult>> {
    try {
      console.log('[Navigator] Building browser state message...');
      // Build browser state message
      const stateMessage = await this.prompt.getUserMessage(this.context);
      console.log('[Navigator] State message length:', typeof stateMessage.content === 'string' ? stateMessage.content.length : stateMessage.content.length);
      this.context.messageManager.addStateMessage(stateMessage);

      // Get messages and invoke LLM
      const inputMessages = this.context.messageManager.getMessages();
      console.log('[Navigator] Invoking LLM with', inputMessages.length, 'messages...');
      this.context.messageManager.cutMessages();

      const modelOutput = await this.invoke(inputMessages);
      console.log('[Navigator] LLM response:', {
        currentState: modelOutput.current_state,
        actionsCount: modelOutput.action?.length || 0,
      });

      // Fix actions to ensure they're valid
      const actions = this.fixActions(modelOutput);
      console.log('[Navigator] Fixed actions:', actions.map(a => Object.keys(a)[0]));

      // Execute the actions
      console.log('[Navigator] Executing', actions.length, 'actions...');
      const actionResults = await this.doMultiAction(actions);
      console.log('[Navigator] Action results:', actionResults.map(r => ({ 
        done: r.isDone, 
        success: r.success, 
        error: r.error,
        content: r.extractedContent?.substring(0, 100),
      })));

      // Check if we're done
      const isDone = actionResults.some(result => result.isDone);

      // Update message history with the model output
      this.context.messageManager.removeLastStateMessage();
      this.context.messageManager.addModelOutput(modelOutput as unknown as Record<string, unknown>);

      return {
        id: this.id,
        result: {
          done: isDone,
          output: modelOutput,
          actions,
          actionResults,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Navigator] Execution failed:', errorMsg);
      logger.error('Navigator execution failed:', errorMsg);

      return {
        id: this.id,
        error: errorMsg,
        result: {
          done: false,
          error: capTextLength(errorMsg, this.context.options.maxErrorLength),
        },
      };
    }
  }

  /**
   * Fix actions - ensure they're in proper format
   */
  private fixActions(modelOutput: NavigatorOutput): Array<Record<string, unknown>> {
    if (!modelOutput.action || !Array.isArray(modelOutput.action)) {
      return [];
    }

    const actions: Array<Record<string, unknown>> = [];

    for (const action of modelOutput.action) {
      if (!action || typeof action !== 'object') {
        continue;
      }

      // Find the action name (first key that's not null)
      for (const [key, value] of Object.entries(action)) {
        if (value !== null && value !== undefined) {
          actions.push({ [key]: value });
          break;
        }
      }
    }

    // Limit to max actions per step
    return actions.slice(0, this.context.options.maxActionsPerStep);
  }

  /**
   * Execute multiple actions in sequence
   */
  private async doMultiAction(actions: Array<Record<string, unknown>>): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const actionObj of actions) {
      const actionName = Object.keys(actionObj)[0];
      const actionInput = actionObj[actionName];

      const action = this.actionRegistry.get(actionName);
      if (!action) {
        logger.warning(`Unknown action: ${actionName}`);
        results.push(new ActionResult({
          error: `Unknown action: ${actionName}`,
        }));
        continue;
      }

      try {
        logger.info(`Executing action: ${actionName}`);
        const result = await action.call(actionInput);
        results.push(result);

        // If action is done or has error, stop executing more actions
        if (result.isDone || result.error) {
          break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Action ${actionName} failed:`, errorMsg);
        results.push(new ActionResult({
          error: capTextLength(errorMsg, this.context.options.maxErrorLength),
        }));
        break;
      }
    }

    return results;
  }
}

