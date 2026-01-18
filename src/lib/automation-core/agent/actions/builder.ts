/**
 * ActionBuilder - Builds available browser actions
 */

import { z } from 'zod';
import { ActionResult } from '../../types';
import type { AgentContext } from '../types';
import {
  clickElementActionSchema,
  doneActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  searchGoogleActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  sendKeysActionSchema,
  cacheContentActionSchema,
  selectDropdownOptionActionSchema,
  getDropdownOptionsActionSchema,
  closeTabActionSchema,
  waitActionSchema,
  previousPageActionSchema,
  scrollToPercentActionSchema,
  nextPageActionSchema,
  scrollToTopActionSchema,
  scrollToBottomActionSchema,
} from './schemas';
import { createLogger } from '../../utils/logger';
import { wrapUntrustedContent } from '../messages/utils';

const logger = createLogger('Action');

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * An action that can be executed by the agent
 */
export class Action {
  constructor(
    private readonly handler: (input: unknown) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
    public readonly hasIndex: boolean = false,
  ) {}

  async call(input: unknown): Promise<ActionResult> {
    const schema = this.schema.schema;

    const isEmptySchema =
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0;

    if (isEmptySchema) {
      return await this.handler({});
    }

    const parsedArgs = this.schema.schema.safeParse(input);
    if (!parsedArgs.success) {
      throw new InvalidInputError(parsedArgs.error.message);
    }
    return await this.handler(parsedArgs.data);
  }

  name(): string {
    return this.schema.name;
  }

  prompt(): string {
    const schemaShape = (this.schema.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    return `${this.schema.description}:\n${schemaStr}`;
  }

  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (input && typeof input === 'object' && 'index' in input) {
      return (input as { index: number }).index;
    }
    return null;
  }

  setIndexArg(input: unknown, newIndex: number): boolean {
    if (!this.hasIndex) {
      return false;
    }
    if (input && typeof input === 'object') {
      (input as { index: number }).index = newIndex;
      return true;
    }
    return false;
  }
}

/**
 * Build a dynamic action schema from a list of actions
 */
export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    const actionSchema = action.schema.schema;
    schema = schema.extend({
      [action.name()]: actionSchema.nullable().optional().describe(action.schema.description),
    });
  }
  return schema;
}

/**
 * ActionBuilder - Builds default browser actions
 */
export class ActionBuilder {
  private readonly context: AgentContext;

  constructor(context: AgentContext) {
    this.context = context;
  }

  buildDefaultActions(): Action[] {
    const actions: Action[] = [];

    // Done action
    const done = new Action(async (input: unknown) => {
      const args = input as { text: string; success: boolean };
      this.context.emitActionEvent('done', 'start', args.text);
      this.context.emitActionEvent('done', 'ok', args.text);
      return new ActionResult({
        isDone: true,
        extractedContent: args.text,
        success: args.success,
      });
    }, doneActionSchema);
    actions.push(done);

    // Search Google
    const searchGoogle = new Action(async (input: unknown) => {
      const args = input as { intent?: string; query: string };
      const intent = args.intent || `Searching Google for: ${args.query}`;
      this.context.emitActionEvent('search_google', 'start', intent);

      await this.context.browserContext.navigateTo(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`);

      const msg = `Searched Google for: "${args.query}"`;
      this.context.emitActionEvent('search_google', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, searchGoogleActionSchema);
    actions.push(searchGoogle);

    // Go to URL
    const goToUrl = new Action(async (input: unknown) => {
      const args = input as { intent?: string; url: string };
      const intent = args.intent || `Navigating to: ${args.url}`;
      console.log('[Action] go_to_url called:', args.url);
      this.context.emitActionEvent('go_to_url', 'start', intent);

      try {
        await this.context.browserContext.navigateTo(args.url);
        const msg = `Navigated to: ${args.url}`;
        console.log('[Action] go_to_url - SUCCESS');
        this.context.emitActionEvent('go_to_url', 'ok', msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[Action] go_to_url - FAILED:', errorMsg);
        this.context.emitActionEvent('go_to_url', 'fail', errorMsg);
        return new ActionResult({ error: errorMsg, includeInMemory: true });
      }
    }, goToUrlActionSchema);
    actions.push(goToUrl);

    // Go back
    const goBack = new Action(async (input: unknown) => {
      const args = input as { intent?: string };
      const intent = args.intent || 'Going back to previous page';
      this.context.emitActionEvent('go_back', 'start', intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.goBack();
      const msg = 'Went back to previous page';
      this.context.emitActionEvent('go_back', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, goBackActionSchema);
    actions.push(goBack);

    // Wait
    const wait = new Action(async (input: unknown) => {
      const args = input as { intent?: string; seconds?: number };
      const seconds = args.seconds || 3;
      const intent = args.intent || `Waiting for ${seconds} seconds`;
      this.context.emitActionEvent('wait', 'start', intent);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      const msg = `Waited for ${seconds} seconds`;
      this.context.emitActionEvent('wait', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, waitActionSchema);
    actions.push(wait);

    // Click element
    const clickElement = new Action(
      async (input: unknown) => {
        const args = input as { intent?: string; index: number };
        const intent = args.intent || `Clicking element at index ${args.index}`;
        console.log('[Action] click_element called:', { index: args.index, intent });
        this.context.emitActionEvent('click_element', 'start', intent);

        const page = await this.context.browserContext.getCurrentPage();
        console.log('[Action] click_element - getting state...');
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist (total elements: ${state?.selectorMap.size || 0})`;
          console.log('[Action] click_element - ELEMENT NOT FOUND:', errorMsg);
          this.context.emitActionEvent('click_element', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg });
        }

        console.log('[Action] click_element - found element:', {
          tag: elementNode.tagName,
          text: elementNode.getAllTextTillNextClickableElement(1)?.substring(0, 50),
        });

        if (page.isFileUploader(elementNode)) {
          const msg = `Element at index ${args.index} is a file uploader - use appropriate file upload action`;
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }

        try {
          const initialTabIds = await this.context.browserContext.getAllTabIds();
          console.log('[Action] click_element - clicking...');
          await page.clickElementNode(this.context.options.useVision, elementNode);
          let msg = `Clicked element at index ${args.index}: ${elementNode.getAllTextTillNextClickableElement(2)}`;
          console.log('[Action] click_element - SUCCESS:', msg.substring(0, 100));
          logger.info(msg);

          const currentTabIds = await this.context.browserContext.getAllTabIds();
          if (currentTabIds.size > initialTabIds.size) {
            msg += ' - New tab opened';
            const newTabId = Array.from(currentTabIds).find(id => !initialTabIds.has(id));
            if (newTabId) {
              await this.context.browserContext.switchTab(newTabId);
            }
          }
          this.context.emitActionEvent('click_element', 'ok', msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Action] click_element - FAILED:', errorMsg);
          this.context.emitActionEvent('click_element', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg });
        }
      },
      clickElementActionSchema,
      true,
    );
    actions.push(clickElement);

    // Input text
    const inputText = new Action(
      async (input: unknown) => {
        const args = input as { intent?: string; index: number; text: string };
        const intent = args.intent || `Inputting text into element at index ${args.index}`;
        this.context.emitActionEvent('input_text', 'start', intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist`;
          this.context.emitActionEvent('input_text', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg });
        }

        await page.inputTextElementNode(this.context.options.useVision, elementNode, args.text);
        const msg = `Input text "${args.text}" into element at index ${args.index}`;
        this.context.emitActionEvent('input_text', 'ok', msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      },
      inputTextActionSchema,
      true,
    );
    actions.push(inputText);

    // Switch tab
    const switchTab = new Action(async (input: unknown) => {
      const args = input as { intent?: string; tab_id: number };
      const intent = args.intent || `Switching to tab ${args.tab_id}`;
      this.context.emitActionEvent('switch_tab', 'start', intent);
      await this.context.browserContext.switchTab(args.tab_id);
      const msg = `Switched to tab ${args.tab_id}`;
      this.context.emitActionEvent('switch_tab', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, switchTabActionSchema);
    actions.push(switchTab);

    // Open tab
    const openTab = new Action(async (input: unknown) => {
      const args = input as { intent?: string; url: string };
      const intent = args.intent || `Opening new tab with URL: ${args.url}`;
      this.context.emitActionEvent('open_tab', 'start', intent);
      await this.context.browserContext.openTab(args.url);
      const msg = `Opened new tab: ${args.url}`;
      this.context.emitActionEvent('open_tab', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, openTabActionSchema);
    actions.push(openTab);

    // Close tab
    const closeTab = new Action(async (input: unknown) => {
      const args = input as { intent?: string; tab_id: number };
      const intent = args.intent || `Closing tab ${args.tab_id}`;
      this.context.emitActionEvent('close_tab', 'start', intent);
      await this.context.browserContext.closeTab(args.tab_id);
      const msg = `Closed tab ${args.tab_id}`;
      this.context.emitActionEvent('close_tab', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, closeTabActionSchema);
    actions.push(closeTab);

    // Cache content
    const cacheContent = new Action(async (input: unknown) => {
      const args = input as { intent?: string; content: string };
      const intent = args.intent || 'Caching content';
      this.context.emitActionEvent('cache_content', 'start', intent);
      const rawMsg = `Cached: ${args.content}`;
      this.context.emitActionEvent('cache_content', 'ok', rawMsg);
      const msg = wrapUntrustedContent(rawMsg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, cacheContentActionSchema);
    actions.push(cacheContent);

    // Scroll to percent
    const scrollToPercent = new Action(async (input: unknown) => {
      const args = input as { intent?: string; yPercent: number; index?: number | null };
      const intent = args.intent || `Scrolling to ${args.yPercent}%`;
      this.context.emitActionEvent('scroll_to_percent', 'start', intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (args.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist`;
          this.context.emitActionEvent('scroll_to_percent', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(args.yPercent, elementNode);
      } else {
        await page.scrollToPercent(args.yPercent);
      }
      const msg = `Scrolled to ${args.yPercent}%`;
      this.context.emitActionEvent('scroll_to_percent', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToPercentActionSchema);
    actions.push(scrollToPercent);

    // Scroll to top
    const scrollToTop = new Action(async (input: unknown) => {
      const args = input as { intent?: string; index?: number | null };
      const intent = args.intent || 'Scrolling to top';
      this.context.emitActionEvent('scroll_to_top', 'start', intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (args.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist`;
          this.context.emitActionEvent('scroll_to_top', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(0, elementNode);
      } else {
        await page.scrollToPercent(0);
      }
      const msg = 'Scrolled to top';
      this.context.emitActionEvent('scroll_to_top', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToTopActionSchema);
    actions.push(scrollToTop);

    // Scroll to bottom
    const scrollToBottom = new Action(async (input: unknown) => {
      const args = input as { intent?: string; index?: number | null };
      const intent = args.intent || 'Scrolling to bottom';
      this.context.emitActionEvent('scroll_to_bottom', 'start', intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (args.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist`;
          this.context.emitActionEvent('scroll_to_bottom', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(100, elementNode);
      } else {
        await page.scrollToPercent(100);
      }
      const msg = 'Scrolled to bottom';
      this.context.emitActionEvent('scroll_to_bottom', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToBottomActionSchema);
    actions.push(scrollToBottom);

    // Previous page
    const previousPage = new Action(async (input: unknown) => {
      const args = input as { intent?: string; index?: number | null };
      const intent = args.intent || 'Scrolling to previous page';
      this.context.emitActionEvent('previous_page', 'start', intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (args.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist`;
          this.context.emitActionEvent('previous_page', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPreviousPage(elementNode);
      } else {
        await page.scrollToPreviousPage();
      }
      const msg = 'Scrolled to previous page';
      this.context.emitActionEvent('previous_page', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, previousPageActionSchema);
    actions.push(previousPage);

    // Next page
    const nextPage = new Action(async (input: unknown) => {
      const args = input as { intent?: string; index?: number | null };
      const intent = args.intent || 'Scrolling to next page';
      console.log('[Action] next_page called with:', args);
      this.context.emitActionEvent('next_page', 'start', intent);
      
      try {
        const page = await this.context.browserContext.getCurrentPage();
        console.log('[Action] next_page - got page, attached:', page.attached);

        if (args.index) {
          const state = await page.getCachedState();
          const elementNode = state?.selectorMap.get(args.index);
          if (!elementNode) {
            const errorMsg = `Element at index ${args.index} does not exist`;
            console.log('[Action] next_page - element not found:', args.index);
            this.context.emitActionEvent('next_page', 'fail', errorMsg);
            return new ActionResult({ error: errorMsg, includeInMemory: true });
          }
          console.log('[Action] next_page - scrolling element:', elementNode.tagName);
          await page.scrollToNextPage(elementNode);
        } else {
          console.log('[Action] next_page - scrolling window');
          await page.scrollToNextPage();
        }
        const msg = 'Scrolled to next page';
        console.log('[Action] next_page - SUCCESS');
        this.context.emitActionEvent('next_page', 'ok', msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[Action] next_page - FAILED:', errorMsg);
        this.context.emitActionEvent('next_page', 'fail', errorMsg);
        return new ActionResult({ error: errorMsg, includeInMemory: true });
      }
    }, nextPageActionSchema);
    actions.push(nextPage);

    // Send keys
    const sendKeys = new Action(async (input: unknown) => {
      const args = input as { intent?: string; keys: string };
      const intent = args.intent || `Sending keys: ${args.keys}`;
      this.context.emitActionEvent('send_keys', 'start', intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.sendKeys(args.keys);
      const msg = `Sent keys: ${args.keys}`;
      this.context.emitActionEvent('send_keys', 'ok', msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, sendKeysActionSchema);
    actions.push(sendKeys);

    // Get dropdown options
    const getDropdownOptions = new Action(
      async (input: unknown) => {
        const args = input as { intent?: string; index: number };
        const intent = args.intent || `Getting dropdown options from element at index ${args.index}`;
        this.context.emitActionEvent('get_dropdown_options', 'start', intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist`;
          this.context.emitActionEvent('get_dropdown_options', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        try {
          const options = await page.getDropdownOptions(args.index);
          const formattedOptions = options.map(opt => `${opt.index}: text=${JSON.stringify(opt.text)}`);
          const msg = formattedOptions.join('\n') + '\nUse select_dropdown_option with the exact text to select';
          this.context.emitActionEvent('get_dropdown_options', 'ok', `Found ${options.length} options`);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        } catch (error) {
          const errorMsg = `Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`;
          this.context.emitActionEvent('get_dropdown_options', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
      },
      getDropdownOptionsActionSchema,
      true,
    );
    actions.push(getDropdownOptions);

    // Select dropdown option
    const selectDropdownOption = new Action(
      async (input: unknown) => {
        const args = input as { intent?: string; index: number; text: string };
        const intent = args.intent || `Selecting "${args.text}" from dropdown at index ${args.index}`;
        this.context.emitActionEvent('select_dropdown_option', 'start', intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(args.index);
        if (!elementNode) {
          const errorMsg = `Element at index ${args.index} does not exist`;
          this.context.emitActionEvent('select_dropdown_option', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        if (!elementNode.tagName || elementNode.tagName.toLowerCase() !== 'select') {
          const errorMsg = `Element at index ${args.index} is not a select element`;
          this.context.emitActionEvent('select_dropdown_option', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        try {
          const result = await page.selectDropdownOption(args.index, args.text);
          const msg = `Selected "${args.text}" from dropdown at index ${args.index}`;
          this.context.emitActionEvent('select_dropdown_option', 'ok', msg);
          return new ActionResult({ extractedContent: result, includeInMemory: true });
        } catch (error) {
          const errorMsg = `Failed to select dropdown option: ${error instanceof Error ? error.message : String(error)}`;
          this.context.emitActionEvent('select_dropdown_option', 'fail', errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
      },
      selectDropdownOptionActionSchema,
      true,
    );
    actions.push(selectDropdownOption);

    return actions;
  }
}

