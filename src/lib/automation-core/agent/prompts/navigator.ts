/**
 * NavigatorPrompt - Prompt for the Navigator agent
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BasePrompt } from './base';
import { getNavigatorSystemPromptTemplate } from './templates';
import type { AgentContext } from '../types';
import type { ActionResult } from '../../types';

export class NavigatorPrompt extends BasePrompt {
  private maxActions: number;

  constructor(maxActions: number = 5) {
    super();
    this.maxActions = maxActions;
  }

  getSystemMessage(): SystemMessage {
    const template = getNavigatorSystemPromptTemplate(this.maxActions);
    return new SystemMessage(template);
  }

  async getUserMessage(context: AgentContext, actionResults: ActionResult[] = []): Promise<HumanMessage> {
    return await this.buildBrowserStateUserMessage(context, actionResults);
  }
}

