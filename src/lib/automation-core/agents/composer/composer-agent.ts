/**
 * Composer Agent
 *
 * Phase 2 of the Recipe Generation System.
 * Generates a program-executable recipe from ExplorationResult.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { domTreeToString } from '../../utils/dom-to-text';
import { createLogger } from '../../utils/logger';
import { Page } from '../../browser/page';
import type { ExplorationResult, DiscoveryEvent } from '../discovery';
import type { HandoffInput, HandoffOutput } from '../discovery/types/handoff';
import type { ReportService } from '../../reporting';
import type { Recipe, RecipeStep } from './types';

const logger = createLogger('ComposerAgent');

const STEP_PROMPT = `You generate ONE executable recipe step at a time for web automation.

RULES:
- Output JSON only (no markdown, no extra text).
- Return exactly ONE step, or mark done.
- Steps must be executable. Include CSS selectors directly.
- Prefer stable selectors: data-testid, aria-label, role + text, placeholder/name, or stable data-* attributes (for example: data-job-id, data-occludable-job-id).
- Avoid selectors with ids like "#ember1234". Do NOT use selectors containing "#ember".
- Do NOT return a loop in iterative mode.
- If you cannot find a stable selector, return done=true with a short reason.
- Keep steps minimal and ordered. No extra commentary or explanation.

OUTPUT SHAPE:
{
  "done": false,
  "reason": "<optional>",
  "step": {
    "action": { "type": "click|type|scroll|type", "selector": "<css>", "text": "<optional>" },
    "wait": { "type": "delay|until", "ms": 1000, "selector": "<css>" },
    "extract": { "key": "apply_links", "selector": "<css>", "attr": "href|text" },
    "expect": { "selector": "<css>", "containsText": "<optional>" },
    "note": "<optional>"
  }
}`;

export interface ComposerContext {
  page: Page;
  apiKey: string;
  model?: string;
  task: string;
  goals?: string[];
  exploration: ExplorationResult;
  report?: ReportService;
}

export async function runComposer(
  input: HandoffInput<ComposerContext>
): Promise<HandoffOutput<Recipe>> {
  const { goal, context } = input;
  if (!context) {
    return { goalCompleted: false, reason: 'No context provided' };
  }

  const { page, apiKey, model = 'gemini-3-flash-preview', task, goals, exploration, report } = context;

  try {
    report?.log(`[Composer] Generating recipe steps (iterative)...`);
    const recipe = await buildRecipeIteratively({
      page,
      apiKey,
      model,
      task,
      goal,
      goals,
      exploration,
      report,
    });

    report?.addPhaseOutput('recipe_generation', JSON.stringify(recipe, null, 2), true, 0);

    return { goalCompleted: true, result: recipe };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Composer failed', { error: msg });
    report?.log(`[Composer] Error: ${msg}`);
    return { goalCompleted: false, reason: msg };
  }
}

type StepResponse = {
  done?: boolean;
  reason?: string;
  step?: RecipeStep | null;
};

const MAX_ITERATIVE_STEPS = 15;
const MAX_STEP_ATTEMPTS = 3;

async function buildRecipeIteratively(params: {
  page: Page;
  apiKey: string;
  model: string;
  task: string;
  goal: string;
  goals?: string[];
  exploration: ExplorationResult;
  report?: ReportService;
}): Promise<Recipe> {
  const { page, apiKey, model, task, goal, goals, exploration, report } = params;
  const steps: RecipeStep[] = [];
  let lastError = '';

  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: STEP_PROMPT,
  });

  for (let iteration = 1; iteration <= MAX_ITERATIVE_STEPS; iteration += 1) {
    report?.log(`[Composer] Iteration ${iteration}/${MAX_ITERATIVE_STEPS}`);
    let accepted = false;

    for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt += 1) {
      report?.log(`[Composer] Attempt ${attempt}/${MAX_STEP_ATTEMPTS}`);
      const { domText, screenshot, currentUrl } = await captureComposerState(page);
      const prompt = buildIterativePrompt({
        task,
        goal,
        goals,
        exploration,
        steps,
        lastError,
        currentUrl,
        domText,
      });

      const result = await genModel.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: screenshot } },
          ],
        }],
      });

      const responseText = result.response.text().trim();
      const response = parseStepResponse(responseText);

      if (response.done) {
        if (steps.length === 0) {
          throw new Error(response.reason || 'Composer returned done with no steps');
        }
        return { goal, steps };
      }

      if (!response.step) {
        lastError = response.reason || 'No step returned by composer';
        report?.log(`[Composer] Step rejected: ${lastError}`);
        continue;
      }

      if (response.step.loop) {
        lastError = 'Loop steps are not supported in iterative mode';
        report?.log(`[Composer] Step rejected: ${lastError}`);
        continue;
      }

      const invalid: string[] = [];
      const ok = await validateStepByReplay(page, response.step, invalid, report, steps.length + 1);
      if (ok) {
        steps.push(response.step);
        lastError = '';
        accepted = true;
        break;
      }

      lastError = invalid.length > 0
        ? `Invalid selectors: ${invalid.join(', ')}`
        : 'Step failed to execute';
      report?.log(`[Composer] Step rejected: ${lastError}`);
    }

    if (!accepted) {
      throw new Error(lastError || 'Composer failed to produce a valid step');
    }
  }

  if (steps.length === 0) {
    throw new Error('Composer failed to generate any valid steps');
  }

  return { goal, steps };
}

async function captureComposerState(page: Page): Promise<{
  domText: string;
  screenshot: string;
  currentUrl: string;
}> {
  const pageState = await page.getState(true);
  const currentUrl = pageState.url;
  let domText = '';
  try {
    const html = await page.getContent();
    domText = stripScriptsAndStyles(html);
  } catch (error) {
    logger.warning('Failed to read full page HTML, falling back to DOM snapshot', error);
    domText = domTreeToString(pageState.elementTree, {
      includeSelectors: false,
      includeDataAttributes: true,
    });
  }
  let screenshot = pageState.screenshot;
  try {
    screenshot = await page.takeScreenshot(true);
  } catch (error) {
    if (!screenshot) {
      throw error;
    }
  }
  if (!screenshot) {
    throw new Error('No screenshot available for recipe generation');
  }
  return { domText, screenshot, currentUrl };
}

function buildIterativePrompt(params: {
  task: string;
  goal: string;
  goals?: string[];
  exploration: ExplorationResult;
  steps: RecipeStep[];
  lastError: string;
  currentUrl: string;
  domText: string;
}): string {
  const { task, goal, goals, exploration, steps, lastError, currentUrl, domText } = params;
  const actionSummary = buildActionSummary(exploration.events);
  const goalsStr = goals?.length ? goals.map((g, i) => `${i + 1}. ${g}`).join('\n') : '(none)';
  const stepsJson = steps.length > 0 ? JSON.stringify(steps, null, 2) : '[]';
  const errorLine = lastError ? lastError : '(none)';

  return [
    `TASK: ${task}`,
    `GOAL: ${goal}`,
    `GOALS:`,
    goalsStr,
    '',
    `FINAL UNDERSTANDING:`,
    exploration.finalUnderstanding || '(none)',
    '',
    `ACTION HISTORY:`,
    actionSummary || '(none)',
    '',
    `CURRENT URL:`,
    currentUrl || '(unknown)',
    '',
    `STEPS SO FAR:`,
    stepsJson,
    '',
    `LAST ERROR:`,
    errorLine,
    '',
    `DOM (full html, scripts/styles removed):`,
    domText,
    '',
    `Return JSON only.`,
  ].join('\n');
}

function parseStepResponse(text: string): StepResponse {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { done: true, reason: 'No JSON response from composer' };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as StepResponse;
    return parsed;
  } catch {
    return { done: true, reason: 'Failed to parse composer response JSON' };
  }
}

function buildActionSummary(events: DiscoveryEvent[]): string {
  const lines: string[] = [];
  let lastAction: string | null = null;

  for (const event of events) {
    if (event.kind === 'action') {
      const action = event.output.result;
      if (action) {
        lastAction = `${action.action} ${action.target || ''}`.trim();
      }
    }
    if (event.kind === 'page_change') {
      const summary = event.output.result?.analysis.summary;
      if (lastAction && summary) {
        lines.push(`- ${lastAction} -> ${summary}`);
        lastAction = null;
      }
    }
  }

  return lines.join('\n');
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
}

async function validateStepByReplay(
  page: Page,
  step: RecipeStep,
  invalid: string[],
  report: ReportService | undefined,
  stepNumber: number
): Promise<boolean> {
  if (step.action?.selector) {
    const selector = step.action.selector;
    if (isUnstableSelector(selector)) {
      invalid.push(selector);
      return false;
    }
    const count = await page.countSelector(selector);
    if (count <= 0) {
      invalid.push(selector);
      return false;
    }

    report?.log(`[Composer] Replay step ${stepNumber}: ${step.action.type} ${selector}`);
    const ok = await runAction(page, step.action);
    if (!ok) {
      invalid.push(selector);
      return false;
    }
  }

  if (step.wait) {
    const ok = await runWait(page, step.wait);
    if (!ok && step.wait.selector) {
      invalid.push(step.wait.selector);
      return false;
    }
  }

  if (step.expect?.selector) {
    const ok = await assertExpect(page, step.expect);
    if (!ok) {
      invalid.push(step.expect.selector);
      return false;
    }
  }

  if (step.extract?.selector) {
    const ok = await ensureSelectorExists(page, step.extract.selector);
    if (!ok) {
      invalid.push(step.extract.selector);
      return false;
    }
  }

  if (step.loop?.over) {
    const ok = await ensureSelectorExists(page, step.loop.over);
    if (!ok) {
      invalid.push(step.loop.over);
      return false;
    }
    if (step.loop.steps?.length) {
      for (const child of step.loop.steps) {
        const childOk = await validateStepByReplay(page, child, invalid, report, stepNumber);
        if (!childOk) {
          return false;
        }
      }
    }
  }

  return true;
}

async function runAction(page: Page, action: RecipeStep['action']): Promise<boolean> {
  if (!action) return true;
  switch (action.type) {
    case 'click':
      return page.clickSelector(action.selector);
    case 'type':
      if (typeof action.text !== 'string') {
        return false;
      }
      return page.typeSelector(action.selector, action.text);
    case 'scroll':
      try {
        const result = await page.executeAction({
          action: 'scroll_down',
          target: action.selector,
        });
        return result.success;
      } catch {
        return false;
      }
    default:
      return false;
  }
}

async function runWait(page: Page, wait: RecipeStep['wait']): Promise<boolean> {
  if (!wait) return true;
  if (wait.type === 'delay') {
    const ms = typeof wait.ms === 'number' ? wait.ms : 1000;
    await new Promise(resolve => setTimeout(resolve, ms));
    return true;
  }
  if (wait.type === 'until' && wait.selector) {
    return waitForSelector(page, wait.selector);
  }
  return true;
}

async function assertExpect(page: Page, expect: RecipeStep['expect']): Promise<boolean> {
  if (!expect) return true;
  const exists = await ensureSelectorExists(page, expect.selector);
  if (!exists) return false;
  if (expect.containsText) {
    const texts = await page.getTextFromSelector(expect.selector);
    return texts.some(text => text.includes(expect.containsText || ''));
  }
  return true;
}

async function ensureSelectorExists(page: Page, selector: string): Promise<boolean> {
  if (isUnstableSelector(selector)) return false;
  const count = await page.countSelector(selector);
  return count > 0;
}

async function waitForSelector(page: Page, selector: string, timeoutMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ensureSelectorExists(page, selector)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function isUnstableSelector(selector: string): boolean {
  if (selector === 'UNRESOLVED') return true;
  return /#ember\d+/i.test(selector);
}

