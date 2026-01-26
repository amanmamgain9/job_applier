/**
 * Tool Executor - Runs tools and returns results
 */

import type { Page } from '../browser/page';
import type { ReportService } from '../reporting';
import type { 
  ToolCall, 
  ToolResult, 
  ClickArgs, 
  ObserveArgs, 
  ScrollArgs, 
  TypeTextArgs 
} from './types';
import { domTreeToString } from '../utils/dom-to-text';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolExecutor');

export class ToolExecutor {
  private page: Page;
  private report?: ReportService;

  constructor(page: Page, report?: ReportService) {
    this.page = page;
    this.report = report;
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const { name, arguments: args } = toolCall;
    
    logger.info(`Executing tool: ${name}`, args);
    this.report?.startAction(`Tool: ${name}`, JSON.stringify(args).slice(0, 100));

    try {
      let result: ToolResult;
      
      switch (name) {
        case 'click':
          result = await this.executeClick(args as unknown as ClickArgs);
          break;
        case 'observe':
          result = await this.executeObserve(args as unknown as ObserveArgs);
          break;
        case 'scroll':
          result = await this.executeScroll(args as unknown as ScrollArgs);
          break;
        case 'type_text':
          result = await this.executeTypeText(args as unknown as TypeTextArgs);
          break;
        case 'done':
          // 'done' is handled by the explorer, not executed
          result = { success: true, observation: 'Exploration complete' };
          break;
        default:
          result = { success: false, observation: '', error: `Unknown tool: ${name}` };
      }
      
      this.report?.endAction(result.success, result.error);
      return result;
      
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Tool ${name} failed:`, error);
      this.report?.endAction(false, error);
      return { success: false, observation: '', error };
    }
  }

  private async executeClick(args: ClickArgs): Promise<ToolResult> {
    const { selector, reason } = args;
    
    // Find and click the element
    const clicked = await this.page.clickSelector(selector);
    
    if (!clicked) {
      return {
        success: false,
        observation: `Could not find or click element: ${selector}`,
        error: `Element not found or not clickable: ${selector}`,
      };
    }
    
    // Wait for any changes to settle
    await this.wait(500);
    
    // Get updated DOM state
    const state = await this.page.getState();
    const dom = state.elementTree ? domTreeToString(state.elementTree, { includeSelectors: true }) : '';
    
    return {
      success: true,
      observation: `Clicked "${selector}" (reason: ${reason}). Page may have updated.`,
      dom: dom.slice(0, 40000), // Truncate for LLM context
    };
  }

  private async executeObserve(args: ObserveArgs): Promise<ToolResult> {
    const { selector, what } = args;
    
    const state = await this.page.getState();
    
    if (!state.elementTree) {
      return {
        success: false,
        observation: '',
        error: 'Failed to get page state',
      };
    }
    
    let dom: string;
    
    if (selector) {
      // Focus on a specific part of the page
      // For now, we just get the full DOM - could optimize later
      dom = domTreeToString(state.elementTree, { includeSelectors: true });
      // TODO: Filter to just the selector subtree
    } else {
      dom = domTreeToString(state.elementTree, { includeSelectors: true });
    }
    
    return {
      success: true,
      observation: `Observing page to understand: ${what}`,
      dom: dom.slice(0, 50000),
    };
  }

  private async executeScroll(args: ScrollArgs): Promise<ToolResult> {
    const { direction, reason } = args;
    
    try {
      // Scroll by 500px
      const distance = direction === 'down' ? 500 : -500;
      await this.page.scrollBy(0, distance);
    } catch {
      // If scroll fails, try page-level scroll methods
      try {
        if (direction === 'down') {
          await this.page.scrollToNextPage();
        } else {
          await this.page.scrollToPreviousPage();
        }
      } catch {
        // Ignore scroll errors
      }
    }
    
    // Wait for any lazy-loaded content
    await this.wait(500);
    
    // Get updated DOM state
    const state = await this.page.getState();
    const dom = state.elementTree ? domTreeToString(state.elementTree, { includeSelectors: true }) : '';
    
    return {
      success: true,
      observation: `Scrolled ${direction} (reason: ${reason}).`,
      dom: dom.slice(0, 40000),
    };
  }

  private async executeTypeText(args: TypeTextArgs): Promise<ToolResult> {
    const { selector, text, reason } = args;
    
    // Type into the element
    const typed = await this.page.typeSelector(selector, text);
    
    if (!typed) {
      return {
        success: false,
        observation: `Could not type into: ${selector}`,
        error: `Input not found or not typeable: ${selector}`,
      };
    }
    
    // Wait for any autocomplete/changes
    await this.wait(500);
    
    // Get updated DOM state
    const state = await this.page.getState();
    const dom = state.elementTree ? domTreeToString(state.elementTree, { includeSelectors: true }) : '';
    
    return {
      success: true,
      observation: `Typed "${text}" into "${selector}" (reason: ${reason}).`,
      dom: dom.slice(0, 40000),
    };
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

