/**
 * FilterGenerator - Generates recipe fragments for filter interactions
 * 
 * Phase 2 of the agent flow (called if StrategyPlanner requests it)
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { GeneratorContext, GeneratorResult, GeneratorFragment } from './types';
import type { Command } from '../recipe/commands';
import { createLogger } from '../utils/logger';

const logger = createLogger('FilterGenerator');

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are a Filter Generator for web automation. Your job is to generate recipe commands for applying filters on a page.

OUTPUT FORMAT: Valid JSON only, no markdown or explanations.

You will receive:
1. DOM snapshot of the page
2. Strategy from the planner describing the filter to apply
3. Instructions on what filter to apply

Your output must be a JSON object with:
{
  "filterSelector": "CSS selector for the filter element (dropdown, checkbox group, etc.)",
  "filterType": "dropdown" | "checkbox" | "button" | "input",
  "optionsSelector": "CSS selector for filter options (if dropdown)",
  "targetOption": "the option to select or text to match",
  "commands": [
    // Array of command objects to apply the filter
  ]
}

COMMAND TYPES YOU CAN USE:
- { "type": "CLICK", "selector": "..." }
- { "type": "WAIT_FOR", "condition": { "exists": "..." } }
- { "type": "TYPE", "selector": "...", "text": "..." }
- { "type": "SELECT", "selector": "...", "option": "..." }
- { "type": "WAIT", "seconds": N }`;

const USER_TEMPLATE = `Generate filter commands for this page.

URL: {url}
TITLE: {title}

STRATEGY CONTEXT:
{strategy}

SPECIFIC INSTRUCTIONS:
{instructions}

DOM SNAPSHOT:
{dom}

Output the JSON for applying this filter.`;

// ============================================================================
// FilterGenerator
// ============================================================================

export class FilterGenerator {
  private llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    this.llm = llm;
  }

  async generate(context: GeneratorContext): Promise<GeneratorResult> {
    logger.info(`Generating filter fragment for: ${context.url}`);

    const prompt = USER_TEMPLATE
      .replace('{url}', context.url)
      .replace('{title}', context.title)
      .replace('{strategy}', context.strategy)
      .replace('{instructions}', context.instructions || 'Apply the filter mentioned in the strategy')
      .replace('{dom}', context.dom.slice(0, 20000)); // Limit DOM size

    try {
      const response = await this.llm.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(prompt),
      ]);

      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'No JSON found in response' };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Convert to GeneratorFragment
      const fragment: GeneratorFragment = {
        type: 'filter',
        selector: parsed.filterSelector,
        selectors: {
          options: parsed.optionsSelector,
        },
        commands: this.normalizeCommands(parsed.commands || []),
        metadata: {
          filterType: parsed.filterType,
          targetOption: parsed.targetOption,
        },
      };

      logger.info(`Filter fragment generated: ${fragment.selector}`);
      return { success: true, fragment };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Filter generation failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  private normalizeCommands(commands: unknown[]): Command[] {
    // Basic normalization - ensure commands have required structure
    return commands.map((cmd) => {
      if (typeof cmd !== 'object' || cmd === null) {
        return { type: 'WAIT', seconds: 0.1 } as Command;
      }
      return cmd as Command;
    });
  }
}

