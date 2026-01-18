/**
 * BaseAgent - Abstract base class for all agents
 */

import type { z } from 'zod';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AgentOutput } from '../types';
import type { AgentContext } from './types';
import type { BasePrompt } from './prompts/base';
import type { BaseMessage } from '@langchain/core/messages';
import { createLogger } from '../utils/logger';
import type { Action } from './actions/builder';
import { convertInputMessages, extractJsonFromModelOutput, removeThinkTags } from './messages/utils';
import { isAbortedError, ResponseParseError } from './errors';

const logger = createLogger('BaseAgent');

export type CallOptions = Record<string, unknown>;

export interface BaseAgentOptions {
  chatLLM: BaseChatModel;
  context: AgentContext;
  prompt: BasePrompt;
  provider?: string;
}

export interface ExtraAgentOptions {
  id?: string;
  toolCallingMethod?: string;
  callOptions?: CallOptions;
}

/**
 * Base class for all agents
 */
export abstract class BaseAgent<T extends z.ZodType, M = unknown> {
  protected id: string;
  protected chatLLM: BaseChatModel;
  protected prompt: BasePrompt;
  protected context: AgentContext;
  protected actions: Record<string, Action> = {};
  protected modelOutputSchema: T;
  protected toolCallingMethod: string | null;
  protected chatModelLibrary: string;
  protected modelName: string;
  protected provider: string;
  protected withStructuredOutput: boolean;
  protected callOptions?: CallOptions;
  protected modelOutputToolName: string;
  protected controller: AbortController;
  declare ModelOutput: z.infer<T>;

  constructor(modelOutputSchema: T, options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    this.modelOutputSchema = modelOutputSchema;
    this.chatLLM = options.chatLLM;
    this.prompt = options.prompt;
    this.context = options.context;
    this.provider = options.provider || '';
    this.chatModelLibrary = this.chatLLM.constructor.name;
    this.modelName = this.getModelName();
    this.withStructuredOutput = this.setWithStructuredOutput();
    this.id = extraOptions?.id || 'agent';
    this.toolCallingMethod = this.setToolCallingMethod(extraOptions?.toolCallingMethod);
    this.callOptions = extraOptions?.callOptions;
    this.modelOutputToolName = `${this.id}_output`;
    this.controller = new AbortController();
  }

  private getModelName(): string {
    if ('modelName' in this.chatLLM) {
      return this.chatLLM.modelName as string;
    }
    if ('model_name' in this.chatLLM) {
      return this.chatLLM.model_name as string;
    }
    if ('model' in this.chatLLM) {
      return this.chatLLM.model as string;
    }
    return 'Unknown';
  }

  private setToolCallingMethod(toolCallingMethod?: string): string | null {
    if (toolCallingMethod === 'auto') {
      switch (this.chatModelLibrary) {
        case 'ChatGoogleGenerativeAI':
          return null;
        case 'ChatOpenAI':
        case 'AzureChatOpenAI':
        case 'ChatGroq':
        case 'ChatXAI':
          return 'function_calling';
        default:
          return null;
      }
    }
    return toolCallingMethod || null;
  }

  private isLlamaModel(modelName: string): boolean {
    return modelName.includes('Llama-4') || modelName.includes('Llama-3.3') || modelName.includes('llama-3.3');
  }

  private setWithStructuredOutput(): boolean {
    if (this.modelName === 'deepseek-reasoner' || this.modelName === 'deepseek-r1') {
      return false;
    }

    if (this.provider === 'llama' || this.isLlamaModel(this.modelName)) {
      logger.debug(`[${this.modelName}] Llama API doesn't support structured output, using manual JSON extraction`);
      return false;
    }

    return true;
  }

  async invoke(inputMessages: BaseMessage[]): Promise<this['ModelOutput']> {
    const startTime = Date.now();
    this.context.emitEvent('llm_start', `Calling ${this.modelName} with ${inputMessages.length} messages`);
    
    if (this.withStructuredOutput) {
      logger.debug(`[${this.modelName}] Preparing structured output call`);

      const structuredLlm = this.chatLLM.withStructuredOutput(this.modelOutputSchema, {
        includeRaw: true,
        name: this.modelOutputToolName,
      });

      let response = undefined;
      try {
        logger.debug(`[${this.modelName}] Invoking LLM with structured output...`);
        response = await structuredLlm.invoke(inputMessages, {
          signal: this.controller.signal,
          ...this.callOptions,
        });

        if (response.parsed) {
          logger.debug(`[${this.modelName}] Successfully parsed structured output`);
          const duration = Date.now() - startTime;
          this.context.emitEvent('llm_ok', `${this.modelName} responded in ${duration}ms`);
          return response.parsed;
        }
        logger.error('Failed to parse response', response);
        throw new Error('Could not parse response with structured output');
      } catch (error) {
        if (isAbortedError(error)) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('is not valid JSON') &&
          response?.raw?.content &&
          typeof response.raw.content === 'string'
        ) {
          const parsed = this.manuallyParseResponse(response.raw.content);
          if (parsed) {
            const duration = Date.now() - startTime;
            this.context.emitEvent('llm_ok', `${this.modelName} responded in ${duration}ms (manual parse)`);
            return parsed;
          }
        }
        logger.error(`[${this.modelName}] LLM call failed with error: \n${errorMessage}`);
        this.context.emitEvent('llm_fail', `${this.modelName} failed: ${errorMessage.substring(0, 100)}`);
        throw new Error(`Failed to invoke ${this.modelName} with structured output: \n${errorMessage}`);
      }
    }

    // Fallback: Without structured output support
    logger.debug(`[${this.modelName}] Using manual JSON extraction fallback method`);
    const convertedInputMessages = convertInputMessages(inputMessages, this.modelName);

    try {
      const response = await this.chatLLM.invoke(convertedInputMessages, {
        signal: this.controller.signal,
        ...this.callOptions,
      });

      if (typeof response.content === 'string') {
        const parsed = this.manuallyParseResponse(response.content);
        if (parsed) {
          const duration = Date.now() - startTime;
          this.context.emitEvent('llm_ok', `${this.modelName} responded in ${duration}ms (fallback)`);
          return parsed;
        }
      }
    } catch (error) {
      logger.error(`[${this.modelName}] LLM call failed in manual extraction mode:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.context.emitEvent('llm_fail', `${this.modelName} failed: ${errorMessage.substring(0, 100)}`);
      throw error;
    }
    this.context.emitEvent('llm_fail', `${this.modelName} failed to parse response`);
    throw new ResponseParseError('Could not parse response');
  }

  abstract execute(): Promise<AgentOutput<M>>;

  protected validateModelOutput(data: unknown): this['ModelOutput'] | undefined {
    if (!this.modelOutputSchema || !data) return undefined;
    try {
      return this.modelOutputSchema.parse(data);
    } catch (error) {
      logger.error('validateModelOutput', error);
      throw new ResponseParseError('Could not validate model output');
    }
  }

  protected manuallyParseResponse(content: string): this['ModelOutput'] | undefined {
    const cleanedContent = removeThinkTags(content);
    try {
      const extractedJson = extractJsonFromModelOutput(cleanedContent);
      return this.validateModelOutput(extractedJson);
    } catch (error) {
      logger.warning('manuallyParseResponse failed', error);
      return undefined;
    }
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.controller.abort();
  }
}

