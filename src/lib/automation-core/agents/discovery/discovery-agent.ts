/**
 * Discovery Agent
 * 
 * Phase 1 of the Recipe Generation System.
 * Explores a webpage to learn how to complete a task.
 * 
 * Called by Manager, returns ExplorationResult via handoff contract.
 * Owns its DiscoverEventLog and orchestrates sub-agents.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  SchemaType,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type FunctionDeclarationsTool,
} from '@google/generative-ai';
import { Page } from '../../browser/page';
import { ExplorationResult, type DiscoveryAction, type DiscoveryDecision, type DiscoveryEvent, type ElementInfo } from './memory';
import { DiscoverEventLog } from './discover-event-log';
import { runAnalyzer, runPageChangeAnalysis, analyzeAndRecordPageChange, type DiscoveryAnalyzerResult } from './analyzer-agent';
import { runSummarizer } from './summarizer-agent';
import { buildSelector, domTreeToString } from '../../utils/dom-to-text';
import { DOMElementNode } from '../../browser/dom/views';
import { ReportService } from '../../reporting';
import { createLogger, setReportSink } from '../../utils/logger';
import { HandoffInput, HandoffOutput } from './types/handoff';

const logger = createLogger('DiscoveryAgent');

// ============================================================================
// Types
// ============================================================================

export interface DiscoveryContext {
  page: Page;
  goals?: string[];
  llm: BaseChatModel;
  apiKey: string;
  model?: string;
  report?: ReportService;
  maxSteps?: number;
}

export type { DiscoveryAction, DiscoveryDecision } from './memory';

interface ActionResult {
  success: boolean;
  description: string;
  newDom: string;
  newUrl: string;
}


interface StepDeciderContext {
  apiKey: string;
  model?: string;
  task: string;
  goals?: string[];
  currentDom: string;
  clickLabelLines: string[];
  screenshot: string | null;
  memorySummary: string;
  actionHistory: DiscoveryEvent[];
}

// ============================================================================
// Step Decider (LLM Function Calling)
// ============================================================================

const STEP_DECIDER_PROMPT = `You are exploring a webpage to understand how to complete a task.

TOOLS:
1. explore(action, target, reason) - Take an action
   - action: "click", "scroll_down", "scroll_up"
   - target: CSS selector (required for click and scroll; use [CLICK: "..."] or [SCROLL: "..."] from the selector lists)
   - reason: Why

2. done(understanding) - Finish exploration
   - understanding: How the page works (goal-by-goal)

RULES:
- ALWAYS call a tool
- Focus on the TASK. Stop when you have enough evidence.
- You will receive a screenshot of the current page with numeric labels on clickable elements.
- Use CLICK_LABELS to map a numeric label in the screenshot to a [CLICK: "..."] selector.
- For click actions, target must be the selector inside [CLICK: "..."] (do NOT include the [CLICK: ...] wrapper).
- For scroll actions, target must be the selector inside [SCROLL: "..."] (do NOT include the [SCROLL: ...] wrapper).
- If recent actions show no new info, call done()`;

const exploreDeclaration: FunctionDeclaration = {
  name: 'explore',
  description: 'Take an action on the page',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      action: {
        type: SchemaType.STRING,
        format: 'enum',
        enum: ['click', 'scroll_down', 'scroll_up'],
        description: 'Action to take',
      },
      target: {
        type: SchemaType.STRING,
        description: 'CSS selector for click/scroll (from [CLICK: "..."] or [SCROLL: "..."])',
      },
      reason: {
        type: SchemaType.STRING,
        description: 'Why you are taking this action',
      },
    },
    required: ['action', 'reason', 'target'],
  } as FunctionDeclarationSchema,
};

const doneDeclaration: FunctionDeclaration = {
  name: 'done',
  description: 'Finish exploration',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      understanding: {
        type: SchemaType.STRING,
        description: 'How the page works (goal-by-goal)',
      },
    },
    required: ['understanding'],
  } as FunctionDeclarationSchema,
};

const stepDeciderTools: FunctionDeclarationsTool[] = [{
  functionDeclarations: [exploreDeclaration, doneDeclaration],
}];

export async function runStepDecider(ctx: StepDeciderContext): Promise<DiscoveryDecision | null> {
  const {
    apiKey,
    model = 'gemini-2.0-flash',
    task,
    goals,
    currentDom,
    clickLabelLines,
    screenshot,
    memorySummary,
    actionHistory,
  } = ctx;
  
  logger.info('Step Decider called', { task, actionCount: actionHistory?.length });
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const genModel = genAI.getGenerativeModel({ 
      model,
      systemInstruction: STEP_DECIDER_PROMPT,
      tools: stepDeciderTools,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
          allowedFunctionNames: ['explore', 'done'],
        },
      },
    });
    
    const scrollSelectors = extractScrollSelectors(currentDom);
    const prompt = buildStepDeciderPrompt(
      task,
      goals,
      clickLabelLines,
      scrollSelectors,
      memorySummary,
      actionHistory
    );
    
    const result = await genModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          ...(screenshot ? [{ inlineData: { mimeType: 'image/jpeg', data: screenshot } }] : []),
        ],
      }],
    });
    
    const functionCall = result.response.functionCalls()?.[0];
    
    if (!functionCall) {
      logger.error('No function call in response');
      return null;
    }
    
    logger.info('Decision', { tool: functionCall.name, args: functionCall.args });
    const action = parseToolCall(functionCall);
    return { action: sanitizeScrollTarget(action, scrollSelectors) };
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Step Decider error', { error: msg });
    return null;
  }
}

function buildStepDeciderPrompt(
  task: string,
  goals: string[] | undefined,
  clickLabelLines: string[],
  scrollSelectors: string[],
  memorySummary: string,
  actionHistory: DiscoveryEvent[]
): string {
  const goalsStr = goals?.length 
    ? goals.map((g, i) => `${i + 1}. ${g}`).join('\n') 
    : '(none)';
  
  const historyStr = formatActionHistory(actionHistory);
  const scrollList = scrollSelectors.slice(0, 50);
  
  return `TASK: ${task}

GOALS:
${goalsStr}

MEMORY:
${memorySummary || '(empty)'}

RECENT ACTIONS:
${historyStr}

CLICK_LABELS (${clickLabelLines.length} total):
${clickLabelLines.slice(0, 200).join('\n') || '(none)'}

SCROLL_TARGETS (${scrollSelectors.length} total):
${scrollList.map(sel => `[SCROLL: "${sel}"]`).join('\n') || '(none)'}

What's next? Call explore() or done().`;
}

function extractScrollSelectors(dom: string): string[] {
  const selectors = new Set<string>();
  const regex = /\[SCROLL:\s*"([^"]+)"\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(dom)) !== null) {
    const value = match[1]?.trim();
    if (value) selectors.add(value);
  }
  return Array.from(selectors);
}

function buildClickLabelData(selectorMap: Map<number, DOMElementNode>): {
  lines: string[];
  hintsBySelector: Map<string, string>;
} {
  const hintsBySelector = new Map<string, string>();
  const lines: string[] = [];
  for (const [index, node] of selectorMap.entries()) {
    if (!node || !node.isInteractive) continue;
    const selector = buildSelector(node);
    const text = capText(node.getAllTextTillNextClickableElement(2), 60);
    const hints = [
      formatAttrHint('text', text),
      formatAttrHint('aria-label', node.attributes?.['aria-label']),
      formatAttrHint('title', node.attributes?.title),
      formatAttrHint('placeholder', node.attributes?.placeholder),
      formatAttrHint('name', node.attributes?.name),
      formatAttrHint('value', node.attributes?.value),
      formatAttrHint('role', node.attributes?.role),
      formatAttrHint('type', node.attributes?.type),
      formatAttrHint('data-testid', node.attributes?.['data-testid']),
    ].filter(Boolean);
    const hintStr = hints.length > 0 ? ` ${hints.join(' ')}` : '';
    lines.push(`[${index}] [CLICK: "${selector}"]${hintStr}`);
    hintsBySelector.set(selector, hints.join(' '));
  }
  return { lines, hintsBySelector };
}

function formatAttrHint(label: string, value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return `${label}="${capText(trimmed, 60)}"`;
}

function capText(text: string | undefined, limit: number): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}…`;
}

function getElementContext(dom: string, target?: string): string | null {
  if (!target) return null;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = dom.match(new RegExp(`.{0,100}${escaped}.{0,200}`, 's'));
  if (!match?.[0]) return null;
  return capText(match[0].replace(/\s+/g, ' ').trim(), 220);
}

function buildElementInfo(
  action: DiscoveryAction & { type: 'explore' },
  hintsBySelector: Map<string, string>,
  dom: string
): ElementInfo {
  const kind = action.action.startsWith('scroll') ? 'scroll' : 'click';
  const label = action.action === 'click' && action.target
    ? hintsBySelector.get(action.target) || undefined
    : undefined;
  return {
    kind,
    target: action.target,
    label,
    context: getElementContext(dom, action.target) || undefined,
  };
}

function sanitizeScrollTarget(
  action: DiscoveryAction,
  scrollSelectors: string[]
): DiscoveryAction {
  if (action.type !== 'explore') return action;
  if (action.action !== 'scroll_down' && action.action !== 'scroll_up') return action;
  if (scrollSelectors.length === 0) return action;
  if (!action.target) return action;
  if (scrollSelectors.includes(action.target)) return action;

  throw new Error(
    `Invalid scroll target "${action.target}". ` +
      `Use a selector from the DOM scroll list: ${scrollSelectors.join(', ')}`
  );
}

function buildScrollTargetsFromDiagnostics(
  diagnostics: Array<Record<string, unknown>>
): string[] {
  const targets: string[] = [];
  for (const entry of diagnostics) {
    if (!entry || entry.isScrollable !== true) continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (id) {
      targets.push(`#${id}`);
      continue;
    }
    const className = typeof entry.className === 'string' ? entry.className.trim() : '';
    if (className) {
      const firstClass = className.split(/\s+/).find(Boolean);
      if (firstClass) {
        const tagName = typeof entry.tagName === 'string' ? entry.tagName.trim() : 'div';
        targets.push(`${tagName}.${firstClass}`);
        continue;
      }
    }
    if (typeof entry.tagName === 'string' && entry.tagName.trim()) {
      targets.push(entry.tagName.trim());
    }
  }
  return Array.from(new Set(targets));
}


function parseToolCall(fc: { name: string; args: object }): DiscoveryAction {
  const args = fc.args as Record<string, unknown>;
  
  if (fc.name === 'explore') {
    const action = args.action as string;
    if (!['click', 'scroll_down', 'scroll_up'].includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }
    const target = args.target as string | undefined;
    if (!target) {
      throw new Error(`Missing target for ${action}`);
    }
    return {
      type: 'explore',
      action: action as 'click' | 'scroll_down' | 'scroll_up',
      target: normalizeSelectorTarget(target),
      reason: (args.reason as string) || '',
    };
  }
  
  if (fc.name === 'done') {
    return {
      type: 'done',
      understanding: (args.understanding as string) || '',
    };
  }
  
  throw new Error(`Unknown tool: ${fc.name}`);
}

function normalizeSelectorTarget(target: string): string {
  const trimmed = target.trim();
  const scrollMatch = trimmed.match(/^\[SCROLL:\s*"([^"]+)"\]$/);
  if (scrollMatch?.[1]) return scrollMatch[1];
  const clickMatch = trimmed.match(/^\[CLICK:\s*"([^"]+)"\]$/);
  if (clickMatch?.[1]) return clickMatch[1];
  return trimmed;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runDiscovery(
  input: HandoffInput<DiscoveryContext>
): Promise<HandoffOutput<ExplorationResult>> {
  const { goal, context } = input;
  
  if (!context) {
    return { goalCompleted: false, reason: 'No context provided' };
  }
  
  const { page, goals, llm, apiKey, model, report, maxSteps = 20 } = context;
  
  const eventLog = new DiscoverEventLog();
  let stepCount = 0;

  if (report) {
    setReportSink((msg) => report.logRaw(msg));
  }

  logDiscoveryStart(goal, maxSteps);

  try {
    // Get initial state
    const initialState = await page.getState();
    let currentDom = domTreeToString(initialState.elementTree, { includeSelectors: true });
    let currentUrl = initialState.url;
    const initialScreenshot = await page.takeScreenshot();
    assertScreenshot(initialScreenshot, 'initial page');
    logInitialState(currentUrl, currentDom, report);
    const rawDom = await page.getRawDom();
    const scrollDiagnostics = (rawDom.scrollDiagnostics || []).slice(0, 20);
    report?.log(`[BuildDomTreeVersion] ${rawDom.buildDomTreeVersion || 'unknown'}`);
    if (scrollDiagnostics.length > 0) {
      report?.log(`[ScrollDiagnostics] ${JSON.stringify(scrollDiagnostics)}`);
      logger.info('Scroll diagnostics', { count: rawDom.scrollDiagnostics?.length || 0 });
    } else {
      report?.log('[ScrollDiagnostics] none');
      logger.warning('No scroll diagnostics captured');
    }
    const scrollTargets = buildScrollTargetsFromDiagnostics(rawDom.scrollDiagnostics || []);
    if (scrollTargets.length > 0) {
      currentDom += `\nSCROLL_TARGETS:\n${scrollTargets.map(sel => `[SCROLL: "${sel}"]`).join('\n')}`;
    }
    const initialScrollSelectors = extractScrollSelectors(currentDom);
    if (initialScrollSelectors.length > 0) {
      report?.log(`[ScrollSelectors] ${initialScrollSelectors.join(', ')}`);
      logger.info('Scroll selectors found', { selectors: initialScrollSelectors });
    } else {
      report?.log('[ScrollSelectors] none');
      logger.warning('No scroll selectors found in DOM');
    }

    // Analyze initial page
    const initialAnalysis = await analyzeInitialPage(
      page, currentUrl, goal, apiKey, model, initialScreenshot, report
    );
    const pageKeyResult = await runPageChangeAnalysis({
      goal: 'Generate a stable page id for the initial page',
      context: {
        apiKey,
        model,
        action: 'initial page',
        beforeUrl: currentUrl,
        afterUrl: currentUrl,
        beforeScreenshot: initialScreenshot,
        afterScreenshot: initialScreenshot,
        domSample: currentDom,
        existingPages: [],
      },
    });
    const pageKey = pageKeyResult.result?.pageKey || currentUrl.replace(/[^a-zA-Z0-9]+/g, '_');
    eventLog.setCurrent(pageKey);
    if (initialAnalysis.analyzerResult) {
      eventLog.addAnalyzerEvent(initialAnalysis.analyzerResult, {
        beforeUrl: currentUrl,
        afterUrl: currentUrl,
      });
    }
    eventLog.setSnapshot(pageKey, currentUrl, initialScreenshot);

    // Main loop
    while (stepCount < maxSteps) {
      stepCount++;
      report?.log(`\n[Step ${stepCount}/${maxSteps}]`);

      if (!page.attached) {
        logError('Browser connection lost', eventLog);
        return { goalCompleted: false, reason: 'Browser connection lost' };
      }

      const decision = await getDiscoveryDecision(
        page, apiKey, model, goal, goals, currentDom, eventLog, report
      );
      
      if (!decision) {
        logError('Step Decider failed', eventLog);
        return { goalCompleted: false, reason: 'Step Decider failed' };
      }

      if (decision.action.type === 'done') {
        report?.log(`[Done] Finishing exploration`);
        const result = await finishExploration(decision.action, eventLog, llm, report);
        return { goalCompleted: true, result };
      }

      const actionResult = await executeAndAnalyze(
        page,
        decision.action,
        currentDom,
        currentUrl,
        decision.elementInfo,
        eventLog,
        apiKey,
        model,
        report
      );
      
      currentDom = actionResult.newDom;
      currentUrl = actionResult.newUrl;
    }

    logError('Max steps reached', eventLog);
    report?.log(`[Timeout] Max steps reached`);
    return { goalCompleted: false, reason: 'Max steps reached' };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logError(msg, eventLog);
    report?.log(`[FATAL] ${msg}`);
    return { goalCompleted: false, reason: msg };
  } finally {
    setReportSink(null);
  }
}

// ============================================================================
// Initial Page Analysis
// ============================================================================

async function analyzeInitialPage(
  page: Page,
  url: string,
  fallbackGoal: string,
  apiKey: string,
  model: string | undefined,
  screenshot: string | null,
  report?: ReportService
): Promise<{ understanding: string; analyzerResult?: HandoffOutput<DiscoveryAnalyzerResult> }> {
  report?.log(`[Analyzing initial page...]`);
  
  try {
    const initialShot = screenshot ?? await page.takeScreenshot();
    assertScreenshot(initialShot, 'initial analysis');
    const result = await runAnalyzer({
      goal: 'Describe this page: what it is, what can be done here, any blockers (login, captcha)',
      context: {
        apiKey,
        model,
        action: 'opened page',
        beforeUrl: url,
        afterUrl: url,
        beforeScreenshot: initialShot,
        afterScreenshot: initialShot,
      },
    });
    
    if (result.goalCompleted && result.result) {
      const understanding = result.result.summary;
      report?.log(`[Initial] ${understanding}`);
      return { understanding, analyzerResult: result };
    }
  } catch {
    logger.warning('Initial page analysis failed');
  }
  
  return { understanding: fallbackGoal };
}

// ============================================================================
// Get Step Decider Decision
// ============================================================================

async function getDiscoveryDecision(
  page: Page,
  apiKey: string,
  model: string | undefined,
  task: string,
  goals: string[] | undefined,
  currentDom: string,
  eventLog: DiscoverEventLog,
  report?: ReportService
): Promise<DiscoveryDecision | null> {
  try {
    report?.log(`[Thinking...]`);
    const currentPageKey = eventLog.getCurrentPageKey();
    const actionHistory = currentPageKey ? eventLog.getEventsForPage(currentPageKey) : [];
    const decisionState = await page.getState(true);
    const decisionScreenshot = decisionState.screenshot;
    assertScreenshot(decisionScreenshot, 'step decider');
    const clickLabelData = buildClickLabelData(decisionState.selectorMap);
    const clickLabelLines = clickLabelData.lines;
    const decision = await runStepDecider({
      apiKey,
      model,
      task,
      goals,
      currentDom,
      clickLabelLines,
      screenshot: decisionScreenshot,
      memorySummary: eventLog.buildSummary(),
      actionHistory,
    });
    
    if (!decision) {
      report?.log(`[Error] No decision`);
      eventLog.addDecisionEvent({ goalCompleted: false, reason: 'unknown' });
      return null;
    }
    
    if (decision.action.type === 'explore') {
      const elementInfo = buildElementInfo(
        decision.action,
        clickLabelData.hintsBySelector,
        currentDom
      );
      decision.elementInfo = elementInfo;
    }
    eventLog.addDecisionEvent({ goalCompleted: true, result: decision });
    return decision;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    report?.log(`[Error] ${msg}`);
    eventLog.addDecisionEvent({ goalCompleted: false, reason: msg });
    return null;
  }
}

// ============================================================================
// Execute Action and Analyze
// ============================================================================

async function executeAndAnalyze(
  page: Page,
  action: DiscoveryAction & { type: 'explore' },
  beforeDom: string,
  beforeUrl: string,
  elementInfo: ElementInfo | undefined,
  eventLog: DiscoverEventLog,
  apiKey: string,
  model: string | undefined,
  report?: ReportService
): Promise<ActionResult> {
  logAction(action, beforeDom, report);

  const beforeScreenshot = await page.takeScreenshot();
  assertScreenshot(beforeScreenshot, 'before action');
  const execResult = await page.executeAction(action);
  eventLog.addActionEvent({
    goalCompleted: execResult.success,
    result: {
      action: action.action,
      target: action.target,
      description: execResult.description,
      success: execResult.success,
    },
    reason: execResult.success ? undefined : execResult.description,
  });
  const afterScreenshot = await page.takeScreenshot();
  assertScreenshot(afterScreenshot, 'after action');
  
  const afterState = await page.getState();
  const afterDom = domTreeToString(afterState.elementTree, { includeSelectors: true });
  const afterUrl = afterState.url;

  if (!execResult.success) {
    return { success: false, description: execResult.description, newDom: afterDom, newUrl: afterUrl };
  }

  const actionContext = elementInfo?.context || getElementContext(beforeDom, action.target);
  const labelHint = elementInfo?.label;
  const hintPart = labelHint ? ` | label: ${labelHint}` : '';
  const contextPart = actionContext ? ` | context: ${actionContext}` : '';
  const actionDesc = `${execResult.description}${hintPart}${contextPart}`;
  await analyzeAndRecordPageChange({
    eventLog,
    apiKey,
    model,
    actionDesc,
    beforeUrl,
    afterUrl,
    beforeScreenshot,
    afterScreenshot,
    afterDom,
    report,
  });

  return { success: true, description: execResult.description, newDom: afterDom, newUrl: afterUrl };
}

// ============================================================================
// Analyze Changes
// ============================================================================

// ============================================================================
// Finish Exploration
// ============================================================================

async function finishExploration(
  action: { understanding: string },
  eventLog: DiscoverEventLog,
  llm: BaseChatModel,
  report?: ReportService
): Promise<ExplorationResult> {
  // Summarize each page key
  const pageKeys = eventLog.getPageKeys();
  for (const pageKey of pageKeys) {
    const observations = eventLog
      .getEventsForPage(pageKey)
      .map((event) => JSON.stringify(event));
    if (observations.length > 0) {
      const result = await runSummarizer({
        goal: `Consolidate observations for page: ${pageKey}`,
        context: { llm, pageKey, observations, currentUnderstanding: '' },
      });
      
      eventLog.addSummarizerEvent(result);
    }
  }
  
  const explorationResult: ExplorationResult = {
    success: true,
    pageKeys,
    events: eventLog.getEvents(),
    finalUnderstanding: action.understanding,
  };
  
  report?.addPhaseOutput('exploration', JSON.stringify({
    understanding: action.understanding,
    pageKeys,
  }, null, 2), true, 0);
  
  return explorationResult;
}

// ============================================================================
// Logging Helpers
// ============================================================================

function logDiscoveryStart(goal: string, maxSteps: number): void {
  logger.info('Starting discovery', { goal, maxSteps });
}

function logInitialState(url: string, dom: string, report?: ReportService): void {
  report?.log(`[Start] ${url}`);
  logger.info('Initial DOM sample', { domSample: dom.slice(0, 2000) });
}

function logAction(action: DiscoveryAction & { type: 'explore' }, dom: string, report?: ReportService): void {
  report?.log(`[Action] ${action.action}${action.target ? ` → ${action.target}` : ''}`);
  if (action.reason) {
    report?.log(`[Reason] ${action.reason}`);
  }
  
  // Log element context
  if (action.target) {
    const context = getElementContext(dom, action.target);
    if (context) {
      logger.info('Element context', { context });
    }
  }
}

function logError(message: string, eventLog: DiscoverEventLog): void {
  logger.error(message, { memory: eventLog.buildSummary() });
}

function formatActionHistory(actionHistory: DiscoveryEvent[]): string {
  if (!actionHistory.length) return '(none)';
  return actionHistory
    .slice(-10)
    .map((entry) => {
      try {
        return JSON.stringify(entry);
      } catch {
        return String(entry);
      }
    })
    .join('\n');
}

function assertScreenshot(screenshot: string | null, label: string): void {
  if (!screenshot) {
    throw new Error(`Screenshot failed: ${label}`);
  }
}


// ============================================================================
// Utilities
// ============================================================================

