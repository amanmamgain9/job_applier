/**
 * SortGenerator - Generates recipe fragments for sort interactions
 * 
 * Phase 2 of the agent flow (called if StrategyPlanner requests it)
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { GeneratorContext, GeneratorResult, GeneratorFragment } from './types';
import type { Command } from '../recipe/commands';
import { createLogger } from '../utils/logger';

const logger = createLogger('SortGenerator');

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are a Sort Generator for web automation. Your job is to generate recipe commands for applying sorting on a page.

OUTPUT FORMAT: Valid JSON only, no markdown or explanations.

You will receive:
1. DOM snapshot of the page
2. Strategy from the planner describing the sort to apply
3. Instructions on what sort order to apply

Your output must be a JSON object with:
{
  "sortSelector": "CSS selector for the sort element (dropdown, button, etc.)",
  "sortType": "dropdown" | "button" | "toggle",
  "sortOption": "the sort option to select (e.g., 'Most Recent', 'Date Posted')",
  "commands": [
    // Array of command objects to apply the sort
  ]
}

COMMAND TYPES YOU CAN USE:
- { "type": "CLICK", "selector": "..." }
- { "type": "WAIT_FOR", "condition": { "exists": "..." } }
- { "type": "SELECT", "selector": "...", "option": "..." }
- { "type": "WAIT", "seconds": N }`;

const USER_TEMPLATE = `Generate sort commands for this page.

URL: {url}
TITLE: {title}

STRATEGY CONTEXT:
{strategy}

SPECIFIC INSTRUCTIONS:
{instructions}

DOM SNAPSHOT:
{dom}

Output the JSON for applying this sort.`;

// ============================================================================
// SortGenerator
// ============================================================================

export class SortGenerator {
  private llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    this.llm = llm;
  }

  async generate(context: GeneratorContext): Promise<GeneratorResult> {
    logger.info(`Generating sort fragment for: ${context.url}`);

    const prompt = USER_TEMPLATE
      .replace('{url}', context.url)
      .replace('{title}', context.title)
      .replace('{strategy}', context.strategy)
      .replace('{instructions}', context.instructions || 'Apply the sort mentioned in the strategy')
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
        type: 'sort',
        selector: parsed.sortSelector,
        commands: this.normalizeCommands(parsed.commands || []),
        metadata: {
          sortType: parsed.sortType,
          sortOption: parsed.sortOption,
        },
      };

      logger.info(`Sort fragment generated: ${fragment.selector}`);
      return { success: true, fragment };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Sort generation failed:', errorMsg);
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

