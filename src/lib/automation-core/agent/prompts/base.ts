/**
 * BasePrompt - Abstract base class for prompts
 */

import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '../types';
import { wrapUntrustedContent } from '../messages/utils';
import { createLogger } from '../../utils/logger';
import type { ActionResult } from '../../types';

const logger = createLogger('BasePrompt');

/**
 * Abstract base class for all prompt types
 */
export abstract class BasePrompt {
  /**
   * Returns the system message that defines the AI's role and behavior
   */
  abstract getSystemMessage(): SystemMessage;

  /**
   * Returns the user message for the specific prompt type
   */
  abstract getUserMessage(context: AgentContext, actionResults?: ActionResult[]): Promise<HumanMessage>;

  /**
   * Builds the user message containing the browser state
   */
  async buildBrowserStateUserMessage(context: AgentContext, actionResults: ActionResult[] = []): Promise<HumanMessage> {
    const browserState = await context.browserContext.getState(context.options.useVision);
    const rawElementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);

    let formattedElementsText = '';
    if (rawElementsText !== '') {
      const scrollInfo = `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, document.body.scrollHeight: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${Math.round((browserState.visualViewportHeight / (browserState.scrollHeight - browserState.visualViewportHeight)) * 100)}%\n`;
      logger.debug(scrollInfo);
      const elementsText = wrapUntrustedContent(rawElementsText);
      formattedElementsText = `${scrollInfo}[Start of page]\n${elementsText}\n[End of page]\n`;
    } else {
      formattedElementsText = 'empty page';
    }

    const stepInfoDescription = `Current step: ${context.nSteps + 1}/${context.options.maxSteps}`;
    const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const timeDescription = `Current date and time: ${timeStr}`;

    let actionResultsDescription = '';
    if (actionResults.length > 0) {
      for (let i = 0; i < actionResults.length; i++) {
        const result = actionResults[i];
        if (result.extractedContent) {
          actionResultsDescription += `\nAction result ${i + 1}/${actionResults.length}: ${result.extractedContent}`;
        }
        if (result.error) {
          const error = result.error.split('\n').pop();
          actionResultsDescription += `\nAction error ${i + 1}/${actionResults.length}: ...${error}`;
        }
      }
    }

    const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
    const otherTabs = browserState.tabs
      .filter(tab => tab.id !== browserState.tabId)
      .map(tab => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`);

    const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${stepInfoDescription}
${timeDescription}
${actionResultsDescription}
`;

    if (browserState.screenshot && context.options.useVision) {
      return new HumanMessage({
        content: [
          { type: 'text', text: stateDescription },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${browserState.screenshot}` },
          },
        ],
      });
    }

    return new HumanMessage(stateDescription);
  }
}

