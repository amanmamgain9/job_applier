/**
 * RecipeGenerator - Assembles the final executable recipe
 * 
 * Phase 3 of the agent flow:
 * - Takes strategy output (English) + generator fragments (JSON)
 * - Produces complete executable recipe with bindings
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Recipe, Command } from '../recipe/commands';
import type { PageBindings } from '../recipe/bindings';
import type { GeneratorFragment } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('RecipeGenerator');

// ============================================================================
// Types
// ============================================================================

export interface RecipeGeneratorContext {
  /** URL of the page */
  url: string;
  /** Page title */
  title: string;
  /** DOM snapshot */
  dom: string;
  /** Strategy output from StrategyPlanner */
  strategy: string;
  /** Fragments from generators (filter, sort, search) */
  fragments: GeneratorFragment[];
  /** Task to accomplish */
  task: string;
  /** Maximum items to extract */
  maxItems: number;
}

export interface RecipeGeneratorResult {
  success: boolean;
  recipe?: Recipe;
  bindings?: PageBindings;
  error?: string;
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are a Recipe Generator for web automation. Your job is to create a complete, executable recipe based on the strategy and any generator fragments provided.

OUTPUT FORMAT: Valid JSON only, no markdown or explanations.

You will receive:
1. A strategy with VERIFIED SELECTORS from actual page exploration
2. DOM snapshot of the page
3. Task description and max items

Your output must be a JSON object with TWO parts:

{
  "bindings": {
    "LIST": "body",
    "LIST_ITEM": "COPY EXACTLY from strategy's LIST_ITEM selector",
    "DETAILS_PANEL": "COPY from strategy (selector where details appear after click)",
    "NEXT_PAGE_BUTTON": "COPY from strategy's PAGINATION_BUTTON, or null",
    "PAGE_LOADED": { "exists": "body" },
    "LIST_LOADED": { "exists": "COPY the LIST_ITEM selector here" },
    "DETAILS_LOADED": { "exists": "COPY DETAILS_PANEL here, or use body" },
    "CLICK_BEHAVIOR": "shows_panel" or "navigates" or "inline",
    "ITEM_ID": { "from": "href", "pattern": "/\\d+/" }
  },
  "recipe": {
    "id": "unique_id",
    "name": "Recipe Name", 
    "commands": [...]
  }
}

CRITICAL RULES:
1. COPY selectors EXACTLY from the strategy - do not modify or invent new ones
2. The strategy says which selectors were VERIFIED to exist
3. If strategy says LIST_ITEM is "div[data-job-id]", use EXACTLY "div[data-job-id]"
4. For LIST, just use "body" - the executor will find LIST_ITEM elements within it
5. DO NOT add class prefixes or modify selectors in any way

COMMAND TYPES:
- { "type": "WAIT_FOR", "target": "page" | "list" | "details" }
- { "type": "SCROLL", "target": "list", "direction": "down" } - ALWAYS scroll "list", not "page"!
- { "type": "CLICK" } - clicks current focused element
- { "type": "FOR_EACH_ITEM_IN_LIST", "body": [...] }  // NOTE: use "body" not "commands"!
- { "type": "EXTRACT_DETAILS" } - extracts ALL text from DETAILS_PANEL, LLM parses it later
- { "type": "SAVE", "as": "item" }
- { "type": "MARK_DONE" }
- { "type": "REPEAT", "body": [...], "until": { "itemCount": N } }  // NOTE: use "body" not "commands"!
- { "type": "CLICK_IF_EXISTS", "name": "nextPageButton" }
- { "type": "CHECKPOINT_COUNT" }
- { "type": "SCROLL_IF_NOT_END", "target": "list" }
- { "type": "WAIT", "seconds": N }
- { "type": "END" }

CRITICAL: For FOR_EACH_ITEM_IN_LIST and REPEAT, use "body" (not "commands") for nested commands!

TYPICAL RECIPE STRUCTURE for list-detail pages:
1. WAIT_FOR page
2. WAIT_FOR list  
3. FOR_EACH_ITEM_IN_LIST with body containing:
   - CLICK (to open details)
   - WAIT_FOR details
   - EXTRACT_DETAILS
   - SAVE as item
   - MARK_DONE
4. END`;

const USER_TEMPLATE = `Generate a complete recipe for this automation task.

URL: {url}
TITLE: {title}
TASK: {task}
MAX ITEMS: {maxItems}

## STRATEGY
{strategy}

## GENERATOR FRAGMENTS
{fragments}

## DOM SNAPSHOT (first 15000 chars)
{dom}

Generate the complete recipe JSON with bindings.`;

// ============================================================================
// RecipeGenerator
// ============================================================================

export class RecipeGenerator {
  private llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    this.llm = llm;
  }

  async generate(context: RecipeGeneratorContext): Promise<RecipeGeneratorResult> {
    logger.info(`Generating recipe for: ${context.url}`);
    logger.info(`Strategy length: ${context.strategy.length}, Fragments: ${context.fragments.length}`);

    const fragmentsJson = context.fragments.length > 0
      ? JSON.stringify(context.fragments, null, 2)
      : 'None provided - generate based on strategy only';

    const prompt = USER_TEMPLATE
      .replace('{url}', context.url)
      .replace('{title}', context.title)
      .replace('{task}', context.task)
      .replace('{maxItems}', String(context.maxItems))
      .replace('{strategy}', context.strategy)
      .replace('{fragments}', fragmentsJson)
      .replace('{dom}', context.dom.slice(0, 15000));

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

      // Normalize bindings
      const bindings = this.normalizeBindings(parsed.bindings, context.url);
      
      // Log warnings for potentially bad selectors (but don't override - let it fail so we can debug)
      if (this.hasInvalidSelectors(bindings)) {
        logger.warning(`Potentially invalid selectors detected: LIST="${bindings.LIST}", LIST_ITEM="${bindings.LIST_ITEM}"`);
      }
      
      // Normalize recipe
      const recipe = this.normalizeRecipe(parsed.recipe, context.url, context.maxItems);

      logger.info(`Recipe generated: ${recipe.id} with ${recipe.commands.length} commands`);
      logger.info(`Bindings: LIST="${bindings.LIST}", LIST_ITEM="${bindings.LIST_ITEM}"`);

      return { success: true, recipe, bindings };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Recipe generation failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  private normalizeBindings(bindings: Record<string, unknown>, url: string): PageBindings {
    const urlPattern = new URL(url).hostname;
    const listItem = (bindings.LIST_ITEM as string) || '';
    
    // Handle DETAILS_CONTENT - must have actual selectors, not empty array
    let detailsContent = bindings.DETAILS_CONTENT as string[] | undefined;
    if (!detailsContent || detailsContent.length === 0) {
      // Fallback: if we have a details panel, use common selectors within it
      const detailsPanel = bindings.DETAILS_PANEL as string | undefined;
      if (detailsPanel) {
        // Generic fallback: look for common content elements inside the details panel
        detailsContent = [
          `${detailsPanel} h1, ${detailsPanel} h2, ${detailsPanel} h3`,
          `${detailsPanel} p`,
          `${detailsPanel} [class*="description"], ${detailsPanel} [class*="content"]`,
        ];
        logger.warning('DETAILS_CONTENT was empty, using fallback selectors');
      } else {
        // No details panel - extract from the list item itself
        detailsContent = [listItem];
      }
    }
    
    return {
      id: `bindings_${Date.now()}`,
      urlPattern,
      version: 1,
      updatedAt: Date.now(),
      
      LIST: (bindings.LIST as string) || '',
      LIST_ITEM: listItem,
      DETAILS_PANEL: bindings.DETAILS_PANEL as string | undefined,
      DETAILS_CONTENT: detailsContent,
      
      SCROLL_CONTAINER: bindings.SCROLL_CONTAINER as string | undefined,
      NEXT_PAGE_BUTTON: bindings.NEXT_PAGE_BUTTON as string | undefined,
      
      PAGE_LOADED: this.normalizeCondition(bindings.PAGE_LOADED) || { exists: 'body' },
      LIST_LOADED: this.normalizeCondition(bindings.LIST_LOADED) || { exists: listItem },
      LIST_UPDATED: { countChanged: listItem },
      DETAILS_LOADED: this.normalizeCondition(bindings.DETAILS_LOADED) || { exists: listItem },
      NO_MORE_ITEMS: this.normalizeCondition(bindings.NO_MORE_ITEMS) || { exists: '.no-results' },
      
      ITEM_ID: this.normalizeItemId(bindings.ITEM_ID),
      
      CLICK_BEHAVIOR: (bindings.CLICK_BEHAVIOR as PageBindings['CLICK_BEHAVIOR']) || 'shows_panel',
    };
  }

  private normalizeCondition(input: unknown): { exists?: string; gone?: string } | undefined {
    if (!input) return undefined;
    if (typeof input === 'string') return { exists: input };
    if (typeof input === 'object') return input as { exists?: string };
    return undefined;
  }

  private normalizeItemId(input: unknown): PageBindings['ITEM_ID'] {
    if (!input || typeof input !== 'object') {
      return { from: 'href', pattern: '/(\\d+)' };
    }
    const parsed = input as Record<string, unknown>;
    return {
      from: (parsed.from as 'href' | 'attribute' | 'text' | 'data') || 'href',
      selector: parsed.selector as string | undefined,
      attribute: parsed.attribute as string | undefined,
      pattern: parsed.pattern as string | undefined,
    };
  }

  private normalizeRecipe(
    recipe: Record<string, unknown>,
    _url: string,
    maxItems: number
  ): Recipe {
    return {
      id: (recipe.id as string) || `recipe_${Date.now()}`,
      name: (recipe.name as string) || 'Generated Recipe',
      commands: this.normalizeCommands(recipe.commands as unknown[]),
      config: { maxItems },
    };
  }

  private normalizeCommands(commands: unknown[]): Command[] {
    if (!commands || !Array.isArray(commands)) {
      return [];
    }
    return commands.map((cmd) => {
      if (typeof cmd !== 'object' || cmd === null) {
        return { type: 'WAIT', seconds: 0.1 } as Command;
      }
      
      // Fix common LLM mistake: using "commands" instead of "body"
      const cmdObj = cmd as Record<string, unknown>;
      if (cmdObj.type === 'FOR_EACH_ITEM_IN_LIST' || cmdObj.type === 'REPEAT') {
        if (cmdObj.commands && !cmdObj.body) {
          cmdObj.body = this.normalizeCommands(cmdObj.commands as unknown[]);
          delete cmdObj.commands;
        } else if (cmdObj.body) {
          cmdObj.body = this.normalizeCommands(cmdObj.body as unknown[]);
        }
      }
      
      // Fix IF command
      if (cmdObj.type === 'IF') {
        if (cmdObj.then) {
          cmdObj.then = this.normalizeCommands(cmdObj.then as unknown[]);
        }
        if (cmdObj.else) {
          cmdObj.else = this.normalizeCommands(cmdObj.else as unknown[]);
        }
      }
      
      return cmdObj as unknown as Command;
    });
  }

  /**
   * Check if bindings have obviously invalid selectors
   */
  private hasInvalidSelectors(bindings: PageBindings): boolean {
    const invalidPatterns = [
      'data-occludable',  // LinkedIn internal, often doesn't match
      'undefined',
      'null',
      '[object Object]',
    ];
    
    const selectorsToCheck = [bindings.LIST, bindings.LIST_ITEM];
    
    for (const selector of selectorsToCheck) {
      if (!selector || selector.trim() === '') {
        return true;
      }
      for (const pattern of invalidPatterns) {
        if (selector.includes(pattern)) {
          return true;
        }
      }
    }
    
    return false;
  }

}

