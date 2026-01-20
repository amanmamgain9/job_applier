/**
 * MessageManager - Manages LLM conversation history
 */

import { type BaseMessage, AIMessage, HumanMessage, type SystemMessage, ToolMessage } from '@langchain/core/messages';
import { MessageHistory, MessageMetadata } from './views';
import { createLogger } from '../../utils/logger';
import {
  filterExternalContent,
  wrapUserRequest,
  splitUserTextAndAttachments,
  wrapAttachments,
} from './utils';

const logger = createLogger('MessageManager');

export class MessageManagerSettings {
  maxInputTokens = 128000;
  estimatedCharactersPerToken = 3;
  imageTokens = 800;
  includeAttributes: string[] = [];
  messageContext?: string;
  sensitiveData?: Record<string, string>;
  availableFilePaths?: string[];
  
  // Sliding window settings - keep last N non-init messages
  maxHistoryMessages = 20; // Keep last 20 messages (~10 steps worth of state+response pairs)

  constructor(
    options: {
      maxInputTokens?: number;
      estimatedCharactersPerToken?: number;
      imageTokens?: number;
      includeAttributes?: string[];
      messageContext?: string;
      sensitiveData?: Record<string, string>;
      availableFilePaths?: string[];
      maxHistoryMessages?: number;
    } = {},
  ) {
    if (options.maxInputTokens !== undefined) this.maxInputTokens = options.maxInputTokens;
    if (options.estimatedCharactersPerToken !== undefined)
      this.estimatedCharactersPerToken = options.estimatedCharactersPerToken;
    if (options.imageTokens !== undefined) this.imageTokens = options.imageTokens;
    if (options.includeAttributes !== undefined) this.includeAttributes = options.includeAttributes;
    if (options.messageContext !== undefined) this.messageContext = options.messageContext;
    if (options.sensitiveData !== undefined) this.sensitiveData = options.sensitiveData;
    if (options.availableFilePaths !== undefined) this.availableFilePaths = options.availableFilePaths;
    if (options.maxHistoryMessages !== undefined) this.maxHistoryMessages = options.maxHistoryMessages;
  }
}

export class MessageManager {
  private history: MessageHistory;
  private toolId: number;
  private settings: MessageManagerSettings;

  constructor(settings: MessageManagerSettings = new MessageManagerSettings()) {
    this.settings = settings;
    this.history = new MessageHistory();
    this.toolId = 1;
  }

  public initTaskMessages(systemMessage: SystemMessage, task: string, messageContext?: string): void {
    this.addMessageWithTokens(systemMessage, 'init');

    if (messageContext && messageContext.length > 0) {
      const contextMessage = new HumanMessage({
        content: `Context for the task: ${messageContext}`,
      });
      this.addMessageWithTokens(contextMessage, 'init');
    }

    const taskMessage = MessageManager.taskInstructions(task);
    this.addMessageWithTokens(taskMessage, 'init');

    if (this.settings.sensitiveData) {
      const info = `Here are placeholders for sensitive data: ${Object.keys(this.settings.sensitiveData)}`;
      const infoMessage = new HumanMessage({
        content: `${info}\nTo use them, write <secret>the placeholder name</secret>`,
      });
      this.addMessageWithTokens(infoMessage, 'init');
    }

    const placeholderMessage = new HumanMessage({
      content: 'Example output:',
    });
    this.addMessageWithTokens(placeholderMessage, 'init');

    const toolCallId = this.nextToolId();
    const toolCalls = [
      {
        name: 'AgentOutput',
        args: {
          current_state: {
            evaluation_previous_goal: 'Success - I navigated to the target page.',
            memory: 'Currently at step 1/15.',
            next_goal: 'I will click on the target element.',
          },
          action: [{ click_element: { index: 1 } }],
        },
        id: String(toolCallId),
        type: 'tool_call' as const,
      },
    ];

    const exampleToolCall = new AIMessage({
      content: '',
      tool_calls: toolCalls,
    });
    this.addMessageWithTokens(exampleToolCall, 'init');
    this.addToolMessage('Browser started', toolCallId, 'init');

    const historyStartMessage = new HumanMessage({
      content: '[Your task history memory starts here]',
    });
    this.addMessageWithTokens(historyStartMessage);

    if (this.settings.availableFilePaths && this.settings.availableFilePaths.length > 0) {
      const filepathsMsg = new HumanMessage({
        content: `Here are file paths you can use: ${this.settings.availableFilePaths}`,
      });
      this.addMessageWithTokens(filepathsMsg, 'init');
    }
  }

  public nextToolId(): number {
    const id = this.toolId;
    this.toolId += 1;
    return id;
  }

  private static taskInstructions(task: string): HumanMessage {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(task);

    const cleanedTask = filterExternalContent(userText);
    const content = `Your ultimate task is: """${cleanedTask}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`;
    const wrappedUser = wrapUserRequest(content, false);

    if (attachmentsInner && attachmentsInner.length > 0) {
      const wrappedFiles = wrapAttachments(attachmentsInner);
      return new HumanMessage({ content: `${wrappedUser}\n\n${wrappedFiles}` });
    }

    return new HumanMessage({ content: wrappedUser });
  }

  public length(): number {
    return this.history.messages.length;
  }

  public addNewTask(newTask: string): void {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(newTask);

    const cleanedTask = filterExternalContent(userText);
    const content = `Your new ultimate task is: """${cleanedTask}""". This is a follow-up of the previous tasks. Make sure to take all of the previous context into account and finish your new ultimate task.`;
    const wrappedUser = wrapUserRequest(content, false);

    let finalContent = wrappedUser;
    if (attachmentsInner && attachmentsInner.length > 0) {
      const wrappedFiles = wrapAttachments(attachmentsInner);
      finalContent = `${wrappedUser}\n\n${wrappedFiles}`;
    }

    const msg = new HumanMessage({ content: finalContent });
    this.addMessageWithTokens(msg);
  }

  public addPlan(plan?: string, position?: number): void {
    if (plan) {
      const cleanedPlan = filterExternalContent(plan, false);
      const msg = new AIMessage({ content: `<plan>${cleanedPlan}</plan>` });
      this.addMessageWithTokens(msg, null, position);
    }
  }

  public addStateMessage(stateMessage: HumanMessage): void {
    this.addMessageWithTokens(stateMessage);
  }

  public addModelOutput(modelOutput: Record<string, unknown>): void {
    const toolCallId = this.nextToolId();
    const toolCalls = [
      {
        name: 'AgentOutput',
        args: modelOutput,
        id: String(toolCallId),
        type: 'tool_call' as const,
      },
    ];

    const msg = new AIMessage({
      content: 'tool call',
      tool_calls: toolCalls,
    });
    this.addMessageWithTokens(msg);

    this.addToolMessage('tool call response', toolCallId);
  }

  public removeLastStateMessage(): void {
    this.history.removeLastStateMessage();
  }

  public getMessages(): BaseMessage[] {
    const messages = this.history.messages
      .filter(m => {
        if (!m.message) {
          return false;
        }
        return true;
      })
      .map(m => m.message);

    let totalInputTokens = 0;
    logger.debug(`Messages in history: ${this.history.messages.length}:`);

    for (const m of this.history.messages) {
      totalInputTokens += m.metadata.tokens;
    }

    logger.debug(`Total input tokens: ${totalInputTokens}`);
    return messages;
  }

  public addMessageWithTokens(message: BaseMessage, messageType?: string | null, position?: number): void {
    let filteredMessage = message;
    if (this.settings.sensitiveData) {
      filteredMessage = this._filterSensitiveData(message);
    }

    const tokenCount = this._countTokens(filteredMessage);
    const metadata: MessageMetadata = new MessageMetadata(tokenCount, messageType);
    this.history.addMessage(filteredMessage, metadata, position);
  }

  private _filterSensitiveData(message: BaseMessage): BaseMessage {
    const replaceSensitive = (value: string): string => {
      let filteredValue = value;
      if (!this.settings.sensitiveData) return filteredValue;

      for (const [key, val] of Object.entries(this.settings.sensitiveData)) {
        if (!val) continue;
        filteredValue = filteredValue.replace(val, `<secret>${key}</secret>`);
      }
      return filteredValue;
    };

    if (typeof message.content === 'string') {
      message.content = replaceSensitive(message.content);
    } else if (Array.isArray(message.content)) {
      message.content = message.content.map(item => {
        if (typeof item === 'object' && item !== null && 'text' in item) {
          return { ...item, text: replaceSensitive(item.text) };
        }
        return item;
      });
    }

    return message;
  }

  private _countTokens(message: BaseMessage): number {
    let tokens = 0;

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if ('image_url' in item) {
          tokens += this.settings.imageTokens;
        } else if (typeof item === 'object' && 'text' in item) {
          tokens += this._countTextTokens(item.text);
        }
      }
    } else {
      let msg = message.content;
      if ('tool_calls' in message) {
        msg += JSON.stringify(message.tool_calls);
      }
      tokens += this._countTextTokens(msg);
    }

    return tokens;
  }

  private _countTextTokens(text: string): number {
    return Math.floor(text.length / this.settings.estimatedCharactersPerToken);
  }

  /**
   * Prune old history messages using sliding window.
   * Keeps 'init' messages and the most recent N non-init messages.
   * IMPORTANT: Ensures AIMessage with tool_calls and their ToolMessage responses are kept together.
   */
  public pruneHistory(): void {
    // Separate init messages from history messages
    const initMessages: typeof this.history.messages = [];
    const historyMessages: typeof this.history.messages = [];
    
    for (const msg of this.history.messages) {
      if (msg.metadata.message_type === 'init') {
        initMessages.push(msg);
      } else {
        historyMessages.push(msg);
      }
    }
    
    // If history is within limits, no pruning needed
    if (historyMessages.length <= this.settings.maxHistoryMessages) {
      return;
    }
    
    // Group messages into pairs: AIMessage with tool_calls + ToolMessage response
    // These must be kept together to avoid tool_use_id mismatch errors
    const messagePairs: Array<typeof this.history.messages> = [];
    let i = 0;
    while (i < historyMessages.length) {
      const msg = historyMessages[i];
      const pair: typeof this.history.messages = [msg];
      
      // Check if this is an AIMessage with tool_calls
      if (msg.message instanceof AIMessage && msg.message.tool_calls && msg.message.tool_calls.length > 0) {
        // Look for the following ToolMessage(s)
        let j = i + 1;
        while (j < historyMessages.length && historyMessages[j].message instanceof ToolMessage) {
          pair.push(historyMessages[j]);
          j++;
        }
        i = j;
      } else {
        i++;
      }
      
      messagePairs.push(pair);
    }
    
    // Calculate how many pairs to remove
    const targetPairs = Math.ceil(this.settings.maxHistoryMessages / 2); // Approximate pairs
    const pairsToRemove = Math.max(0, messagePairs.length - targetPairs);
    
    if (pairsToRemove === 0) {
      return;
    }
    
    logger.debug(`Pruning ${pairsToRemove} message pairs (keeping ${messagePairs.length - pairsToRemove} pairs)`);
    
    // Keep the newest pairs
    const keptPairs = messagePairs.slice(pairsToRemove);
    const prunedHistory = keptPairs.flat();
    
    // Calculate tokens removed
    let tokensRemoved = 0;
    for (let k = 0; k < pairsToRemove; k++) {
      for (const msg of messagePairs[k]) {
        tokensRemoved += msg.metadata.tokens;
      }
    }
    
    // Rebuild the message list: init messages + pruned history
    this.history.messages = [...initMessages, ...prunedHistory];
    this.history.totalTokens -= tokensRemoved;
    
    logger.debug(`After pruning: ${this.history.messages.length} messages, ${this.history.totalTokens} tokens`);
  }

  public cutMessages(): void {
    // First, apply sliding window pruning
    this.pruneHistory();
    
    let diff = this.history.totalTokens - this.settings.maxInputTokens;
    if (diff <= 0) return;

    const lastMsg = this.history.messages[this.history.messages.length - 1];

    if (Array.isArray(lastMsg.message.content)) {
      let text = '';
      lastMsg.message.content = lastMsg.message.content.filter(item => {
        if ('image_url' in item) {
          diff -= this.settings.imageTokens;
          lastMsg.metadata.tokens -= this.settings.imageTokens;
          this.history.totalTokens -= this.settings.imageTokens;
          return false;
        }
        if ('text' in item) {
          text += item.text;
        }
        return true;
      });
      lastMsg.message.content = text;
      this.history.messages[this.history.messages.length - 1] = lastMsg;
    }

    if (diff <= 0) return;

    const proportionToRemove = diff / lastMsg.metadata.tokens;
    if (proportionToRemove > 0.99) {
      throw new Error('Max token limit reached - history is too long');
    }

    const content = lastMsg.message.content as string;
    const charactersToRemove = Math.floor(content.length * proportionToRemove);
    const newContent = content.slice(0, -charactersToRemove);

    this.history.removeLastStateMessage();

    const msg = new HumanMessage({ content: newContent });
    this.addMessageWithTokens(msg);
  }

  public addToolMessage(content: string, toolCallId?: number, messageType?: string | null): void {
    const id = toolCallId ?? this.nextToolId();
    const msg = new ToolMessage({ content, tool_call_id: String(id) });
    this.addMessageWithTokens(msg, messageType);
  }
}

