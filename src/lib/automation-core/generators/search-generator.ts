/**
 * SearchGenerator - Generates recipe fragments for search interactions
 * 
 * Phase 2 of the agent flow (called if StrategyPlanner requests it)
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { GeneratorContext, GeneratorResult, GeneratorFragment } from './types';
import type { Command } from '../recipe/commands';
import { createLogger } from '../utils/logger';

const logger = createLogger('SearchGenerator');

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are a Search Generator for web automation. Your job is to generate recipe commands for performing searches on a page.

OUTPUT FORMAT: Valid JSON only, no markdown or explanations.

You will receive:
1. DOM snapshot of the page
2. Strategy from the planner describing the search to perform
3. Instructions on what to search for

Your output must be a JSON object with:
{
  "searchInputSelector": "CSS selector for the search input field",
  "submitSelector": "CSS selector for submit button (or null if Enter key)",
  "searchQuery": "the search term to use (can be a placeholder like {{query}})",
  "commands": [
    // Array of command objects to perform the search
  ]
}

COMMAND TYPES YOU CAN USE:
- { "type": "CLICK", "selector": "..." }
- { "type": "TYPE", "selector": "...", "text": "..." }
- { "type": "CLEAR", "selector": "..." }
- { "type": "SUBMIT", "selector": "..." }
- { "type": "WAIT_FOR", "condition": { "exists": "..." } }
- { "type": "WAIT", "seconds": N }`;

const USER_TEMPLATE = `Generate search commands for this page.

URL: {url}
TITLE: {title}

STRATEGY CONTEXT:
{strategy}

SPECIFIC INSTRUCTIONS:
{instructions}

DOM SNAPSHOT:
{dom}

Output the JSON for performing this search.`;

// ============================================================================
// SearchGenerator
// ============================================================================

export class SearchGenerator {
  private llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    this.llm = llm;
  }

  async generate(context: GeneratorContext): Promise<GeneratorResult> {
    logger.info(`Generating search fragment for: ${context.url}`);

    const prompt = USER_TEMPLATE
      .replace('{url}', context.url)
      .replace('{title}', context.title)
      .replace('{strategy}', context.strategy)
      .replace('{instructions}', context.instructions || 'Generate search commands based on the strategy')
      .replace('{dom}', context.dom.slice(0, 20000));

    try {
      const response = await this.llm.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(prompt),
      ]);

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'No JSON found in response' };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const fragment: GeneratorFragment = {
        type: 'search',
        selector: parsed.searchInputSelector,
        selectors: {
          submit: parsed.submitSelector,
        },
        commands: this.normalizeCommands(parsed.commands || []),
        metadata: {
          searchQuery: parsed.searchQuery,
        },
      };

      logger.info(`Search fragment generated: ${fragment.selector}`);
      return { success: true, fragment };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Search generation failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  private normalizeCommands(commands: unknown[]): Command[] {
    return commands.map((cmd) => {
      if (typeof cmd !== 'object' || cmd === null) {
        return { type: 'WAIT', seconds: 0.1 } as Command;
      }
      return cmd as Command;
    });
  }
}

