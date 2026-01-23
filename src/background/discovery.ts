/// <reference types="vite/client" />
/**
 * Job Discovery - Recipe-based automation
 * 
 * Uses the cost-optimized Recipe API:
 * - Navigator LLM discovers page bindings (uses buildDomTree)
 * - Executor runs commands using discovered bindings
 * - Extractor LLM (cheap) parses job content
 * 
 * Cost: ~$0.01-0.02 per run vs $1-2 for full LLM agent
 */

import type { Job } from '@shared/types/job';
import {
  BrowserContext,
  RecipeRunner,
  recipeTemplates,
  createChatModel,
  createDualModelConfig,
  clearBindingsForUrl,
  AgentOrchestrator,
  RecipeExecutor,
  type ExtractedJobData,
  type PhaseOutput,
} from '@/lib/automation-core';

// ============================================================================
// Types
// ============================================================================

export type DiscoveryStatus = 'idle' | 'running' | 'paused' | 'error' | 'captcha' | 'login_required';

export interface DiscoveryState {
  status: DiscoveryStatus;
  jobsFound: number;
  currentStep: number;
  maxSteps: number;
  error?: string;
  startedAt?: number;
}

export interface DiscoveryOptions {
  maxJobs: number;
  /** URL to navigate to before starting discovery */
  url: string;
  /** Force fresh binding discovery (ignore cached bindings) */
  forceRefresh?: boolean;
}

export interface DiscoveryResult {
  success: boolean;
  jobs: Job[];
  error?: string;
  stoppedReason?: 'complete' | 'max_jobs' | 'user_stopped' | 'error' | 'captcha' | 'login';
  report?: SessionReport;
}

export interface ActionLog {
  timestamp: number;
  action: string;
  details: string;
  status: 'start' | 'ok' | 'fail';
  error?: string;
}

export interface StepLog {
  step: number;
  timestamp: number;
  goal: string;
  actions: ActionLog[];
  url?: string;
  success: boolean;
  error?: string;
}

// PhaseOutput is imported from automation-core

export interface SessionReport {
  id: string;
  startedAt: number;
  endedAt: number;
  duration: number;
  task: string;
  sourceUrl: string;
  success: boolean;
  stoppedReason: string;
  error?: string;
  jobsFound: number;
  jobsExtracted: Job[];
  /** New recipe-based fields */
  bindingFixes: number;
  commandsExecuted: number;
  /** Legacy fields for UI compatibility */
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  steps: StepLog[];
  urlsVisited: string[];
  finalUrl?: string;
  searchQuery?: string;
  /** Detailed execution logs */
  logs: string[];
  /** Discovered bindings (if any) */
  discoveredBindings?: Record<string, unknown>;
  
  // ==========================================
  // Phase Outputs (New Agent Flow Architecture)
  // ==========================================
  
  /** Output from each phase of the agent flow */
  phaseOutputs?: PhaseOutput[];
  /** Raw strategy from StrategyPlanner (English understanding + strategy) */
  strategyPlannerOutput?: string;
  /** Generator fragments (JSON) */
  generatorOutputs?: Record<string, unknown>;
  /** Final generated recipe (JSON) */
  generatedRecipe?: Record<string, unknown>;
}

// ============================================================================
// State
// ============================================================================

let discoveryState: DiscoveryState = {
  status: 'idle',
  jobsFound: 0,
  currentStep: 0,
  maxSteps: 50,
};

const stateListeners: Set<(state: DiscoveryState) => void> = new Set();
const jobListeners: Set<(job: Job) => void> = new Set();

// Browser context for cleanup
let browserContext: BrowserContext | null = null;
let recipeRunner: RecipeRunner | null = null;

// Session reporting state
let sessionReports: SessionReport[] = [];
let reportsLoaded = false;
let liveReport: SessionReport | null = null;

const REPORTS_STORAGE_KEY = 'discovery_session_reports';
const MAX_STORED_REPORTS = 50;

// ============================================================================
// Live Report Manager - Streams report updates during discovery
// ============================================================================

function createLiveReport(url: string, task: string): SessionReport {
  const now = Date.now();
  const report: SessionReport = {
    id: crypto.randomUUID(),
    startedAt: now,
    endedAt: now,
    duration: 0,
    task,
    sourceUrl: url,
    searchQuery: extractSearchQuery(url),
    success: false,
    stoppedReason: undefined,
    jobsFound: 0,
    jobsExtracted: [],
    bindingFixes: 0,
    commandsExecuted: 0,
    totalSteps: 0,
    successfulSteps: 0,
    failedSteps: 0,
    totalActions: 0,
    successfulActions: 0,
    failedActions: 0,
    steps: [],
    urlsVisited: [url],
    finalUrl: url,
    logs: [],
    phaseOutputs: [],
  };
  
  liveReport = report;
  sessionReports.push(report);
  return report;
}

function updateLiveReport(updates: Partial<SessionReport>): void {
  if (!liveReport) return;
  
  Object.assign(liveReport, updates);
  liveReport.endedAt = Date.now();
  liveReport.duration = liveReport.endedAt - liveReport.startedAt;
  
  // Save immediately (debounced would be better but this ensures we don't lose data)
  saveReportsToStorage().catch(err => {
    console.error('[Discovery] Failed to save live report:', err);
  });
}

function addLogToLiveReport(msg: string): void {
  if (!liveReport) return;
  
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const logLine = `[${timestamp}] ${msg}`;
  liveReport.logs.push(logLine);
  console.log('[AgentFlow]', msg);
}

function addPhaseToLiveReport(phase: PhaseOutput): void {
  if (!liveReport) return;
  
  if (!liveReport.phaseOutputs) {
    liveReport.phaseOutputs = [];
  }
  liveReport.phaseOutputs.push(phase);
  
  // Update step tracking
  const stepLog: StepLog = {
    step: liveReport.steps.length + 1,
    timestamp: phase.timestamp,
    goal: `Phase: ${phase.phase}`,
    actions: [{
      timestamp: phase.timestamp,
      action: phase.phase,
      details: `Duration: ${phase.duration}ms`,
      status: phase.success ? 'ok' : 'fail',
      error: phase.error,
    }],
    success: phase.success,
    error: phase.error,
  };
  
  liveReport.steps.push(stepLog);
  liveReport.totalSteps = liveReport.steps.length;
  liveReport.successfulSteps = liveReport.steps.filter(s => s.success).length;
  liveReport.failedSteps = liveReport.steps.filter(s => !s.success).length;
  liveReport.totalActions = liveReport.steps.reduce((sum, s) => sum + s.actions.length, 0);
  liveReport.successfulActions = liveReport.steps.reduce((sum, s) => sum + s.actions.filter(a => a.status === 'ok').length, 0);
  liveReport.failedActions = liveReport.steps.reduce((sum, s) => sum + s.actions.filter(a => a.status === 'fail').length, 0);
  
  // Save after each phase
  saveReportsToStorage().catch(err => {
    console.error('[Discovery] Failed to save phase update:', err);
  });
}

function finalizeLiveReport(success: boolean, error?: string, stoppedReason?: SessionReport['stoppedReason']): void {
  if (!liveReport) return;
  
  liveReport.success = success;
  liveReport.error = error;
  liveReport.stoppedReason = stoppedReason;
  liveReport.endedAt = Date.now();
  liveReport.duration = liveReport.endedAt - liveReport.startedAt;
  
  // Final save
  saveReportsToStorage().catch(err => {
    console.error('[Discovery] Failed to save final report:', err);
  });
  
  liveReport = null;
}

// ============================================================================
// Storage
// ============================================================================

async function loadReportsFromStorage(): Promise<void> {
  if (reportsLoaded) return;
  
  try {
    const result = await chrome.storage.local.get(REPORTS_STORAGE_KEY);
    if (result[REPORTS_STORAGE_KEY] && Array.isArray(result[REPORTS_STORAGE_KEY])) {
      sessionReports = result[REPORTS_STORAGE_KEY];
      console.log(`[Discovery] Loaded ${sessionReports.length} reports from storage`);
    }
    reportsLoaded = true;
  } catch (error) {
    console.error('[Discovery] Failed to load reports from storage:', error);
    reportsLoaded = true;
  }
}

async function saveReportsToStorage(): Promise<void> {
  try {
    const reportsToSave = sessionReports.slice(-MAX_STORED_REPORTS);
    await chrome.storage.local.set({ [REPORTS_STORAGE_KEY]: reportsToSave });
    console.log(`[Discovery] Saved ${reportsToSave.length} reports to storage`);
  } catch (error) {
    console.error('[Discovery] Failed to save reports to storage:', error);
  }
}

loadReportsFromStorage();

// ============================================================================
// LLM Configuration
// ============================================================================

function getGeminiApiKey(): string {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Set VITE_GEMINI_API_KEY in .env');
  }
  return apiKey;
}

export function hasLLMConfig(): boolean {
  try {
    getGeminiApiKey();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// State Management
// ============================================================================

function updateState(updates: Partial<DiscoveryState>): void {
  discoveryState = { ...discoveryState, ...updates };
  stateListeners.forEach((listener) => {
    try {
      listener(discoveryState);
    } catch (err) {
      console.error('State listener error:', err);
    }
  });
}

function notifyJobFound(job: Job): void {
  jobListeners.forEach((listener) => {
    try {
      listener(job);
    } catch (err) {
      console.error('Job listener error:', err);
    }
  });
}

// ============================================================================
// Utilities
// ============================================================================

function extractSearchQuery(url: string): string {
  try {
    const urlObj = new URL(url);
    // LinkedIn
    const keywords = urlObj.searchParams.get('keywords');
    if (keywords) return keywords;
    // Indeed
    const q = urlObj.searchParams.get('q');
    if (q) return q;
    // Generic fallback
    return urlObj.pathname.split('/').pop() || 'Job Search';
  } catch {
    return 'Job Search';
  }
}

// ============================================================================
// Job Conversion
// ============================================================================

function convertToJob(extracted: ExtractedJobData, sourceUrl: string): Job {
  const now = new Date().toISOString();
  
  const locationLower = (extracted.location || '').toLowerCase();
  let locationType: 'remote' | 'hybrid' | 'onsite' = 'onsite';
  if (locationLower.includes('remote')) locationType = 'remote';
  else if (locationLower.includes('hybrid')) locationType = 'hybrid';

  const jobTypeLower = (extracted.jobType || '').toLowerCase();
  let jobType: 'full-time' | 'part-time' | 'contract' | 'internship' = 'full-time';
  if (jobTypeLower.includes('part')) jobType = 'part-time';
  else if (jobTypeLower.includes('contract')) jobType = 'contract';
  else if (jobTypeLower.includes('intern')) jobType = 'internship';

  return {
    id: crypto.randomUUID(),
    sourceJobId: extracted.id,
    title: extracted.title || 'Unknown Title',
    company: extracted.company || 'Unknown Company',
    location: extracted.location || '',
    locationType,
    jobType,
    salaryText: extracted.salary,
    description: extracted.description,
    capturedAt: now,
    postedAt: now,
    url: extracted.url || sourceUrl,
    status: 'pending',
  };
}

// ============================================================================
// Recipe Discovery
// ============================================================================

async function initBrowserContext(url: string): Promise<BrowserContext> {
  console.log('[Discovery] Creating new tab with URL:', url);
  
  const newTab = await chrome.tabs.create({ 
    url,
    active: true
  });
  
  if (!newTab.id) {
    throw new Error('Failed to create new tab');
  }
  
  const tabId = newTab.id;
  
  // Wait for tab to load with multiple fallback strategies
  console.log('[Discovery] Waiting for tab to load...');
  
  const waitForTab = async (): Promise<void> => {
    const startTime = Date.now();
    const timeout = 45000; // 45 seconds total timeout
    const pollInterval = 500; // Check every 500ms
    
    // First, try the event-based approach with a shorter timeout
    const eventPromise = new Promise<boolean>((resolve) => {
      const eventTimeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false); // Event-based approach timed out
      }, 15000); // 15 second timeout for events
      
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(eventTimeout);
          resolve(true);
        }
      };
      
      // Check if already complete
      chrome.tabs.get(tabId).then(tab => {
        if (tab.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(eventTimeout);
          resolve(true);
        } else {
          chrome.tabs.onUpdated.addListener(listener);
        }
      }).catch(() => {
        clearTimeout(eventTimeout);
        resolve(false);
      });
    });
    
    const eventResult = await eventPromise;
    if (eventResult) {
      console.log('[Discovery] Tab loaded via event');
      return;
    }
    
    // Fallback: Poll for tab status
    console.log('[Discovery] Event-based wait timed out, polling...');
    while (Date.now() - startTime < timeout) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          console.log('[Discovery] Tab loaded via polling');
          return;
        }
        // Also check if URL has changed (indicates navigation happened)
        if (tab.url && tab.url !== 'about:blank' && tab.url.includes('linkedin.com')) {
          // Give it a bit more time for DOM to settle
          await new Promise(r => setTimeout(r, 2000));
          console.log('[Discovery] Tab URL loaded, continuing');
          return;
        }
      } catch (e) {
        // Tab might be gone
        throw new Error(`Tab ${tabId} no longer exists`);
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    
    // Final check
    const finalTab = await chrome.tabs.get(tabId);
    if (finalTab.status === 'complete' || (finalTab.url && finalTab.url.includes('linkedin.com'))) {
      console.log('[Discovery] Tab loaded after extended wait');
      return;
    }
    
    throw new Error(`Tab load timeout after ${timeout}ms (status: ${finalTab.status})`);
  };
  
  await waitForTab();
  
  // Additional wait for JavaScript to initialize
  console.log('[Discovery] Waiting for JS to settle...');
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('[Discovery] Tab loaded, creating BrowserContext');
  return BrowserContext.fromTab(tabId);
}

async function cleanup(): Promise<void> {
  if (browserContext) {
    await browserContext.cleanup();
    browserContext = null;
  }
  recipeRunner = null;
}

export async function discoverJobsWithRecipe(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { maxJobs, url, forceRefresh } = options;
  const startedAt = Date.now();
  
  // Collect logs for the report
  const logs: string[] = [];
  const log = (msg: string) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    const logLine = `[${timestamp}] ${msg}`;
    logs.push(logLine);
    console.log('[Discovery]', msg);
  };

  if (discoveryState.status === 'running') {
    return { success: false, jobs: [], error: 'Discovery already running' };
  }

  if (!url) {
    return { success: false, jobs: [], error: 'URL is required' };
  }

  const jobs: Job[] = [];
  let discoveredBindings: Record<string, unknown> | undefined;

  try {
    updateState({
      status: 'running',
      jobsFound: 0,
      currentStep: 0,
      startedAt,
      error: undefined,
    });

    log(`Starting discovery for: ${url}`);
    log(`Max jobs to extract: ${maxJobs}`);

    // Clear cached bindings if force refresh requested
    if (forceRefresh) {
      log('Force refresh - clearing cached bindings');
      await clearBindingsForUrl(url);
    }

    // Initialize LLM models
    log('Initializing LLM models...');
    const geminiApiKey = getGeminiApiKey();
    log(`Gemini API key present: ${geminiApiKey ? 'YES (' + geminiApiKey.slice(0, 8) + '...)' : 'NO'}`);
    
    const modelConfig = createDualModelConfig(geminiApiKey);
    log(`Navigator model: ${modelConfig.navigator.provider}/${modelConfig.navigator.model}`);
    log(`Extractor model: ${modelConfig.extractor.provider}/${modelConfig.extractor.model}`);
    
    const navigatorLLM = createChatModel(modelConfig.navigator);
    const extractorLLM = createChatModel(modelConfig.extractor);
    log('LLM models created successfully');

    // Initialize browser
    log('Initializing browser context...');
    browserContext = await initBrowserContext(url);
    const page = await browserContext.getCurrentPage();
    
    log(`Page attached: ${page.attached}`);
    log(`Page URL: ${page.url()}`);
    log(`Page title: ${await page.title()}`);

    // Get DOM state to log - show class names for debugging
    try {
      const state = await page.getState();
      // Include class attribute in preview to help debug binding discovery
      const elementsStr = state.elementTree.clickableElementsToString(['class', 'id', 'href', 'role', 'data-job-id']);
      log(`DOM elements obtained: ${elementsStr.length} chars`);
      log(`DOM preview (first 800 chars): ${elementsStr.slice(0, 800).replace(/\n/g, ' ')}`);
    } catch (domError) {
      log(`ERROR getting DOM state: ${domError instanceof Error ? domError.message : String(domError)}`);
    }

    // Create recipe runner with log callback
    log('Creating recipe runner...');
    recipeRunner = new RecipeRunner({
      navigatorLLM,
      extractorLLM,
      maxItems: maxJobs,
    });

    // Set progress callback
    recipeRunner.setProgressCallback((progress) => {
      log(`Progress: ${progress.step} - ${progress.itemsCollected}/${progress.totalItems} items`);
      updateState({
        currentStep: progress.itemsCollected,
        maxSteps: progress.totalItems,
        jobsFound: progress.itemsCollected,
      });
      
      if (progress.currentItem) {
        const job = convertToJob(progress.currentItem, url);
        notifyJobFound(job);
      }
    });

    // Create recipe
    const recipe = recipeTemplates.jobListingExtraction(url, maxJobs);
    log(`Recipe created: ${recipe.id} with ${recipe.commands.length} commands`);

    // Execute recipe
    log('Executing recipe...');
    const result = await recipeRunner.run(page, recipe);
    
    // Include runner's internal logs
    if (result.logs) {
      for (const runnerLog of result.logs) {
        logs.push(`[Runner] ${runnerLog}`);
      }
    }
    
    log(`Recipe completed: success=${result.success}, items=${result.items.length}`);
    log(`Stats: commands=${result.stats.commandsExecuted}, scrolls=${result.stats.scrollsPerformed}, fixes=${result.stats.bindingFixes}`);
    
    if (result.error) {
      log(`Recipe error: ${result.error}`);
    }
    
    // Store discovered bindings for the report
    if (result.bindings) {
      discoveredBindings = {
        id: result.bindings.id,
        LIST: result.bindings.LIST,
        LIST_ITEM: result.bindings.LIST_ITEM,
        DETAILS_PANEL: result.bindings.DETAILS_PANEL,
        DETAILS_CONTENT: result.bindings.DETAILS_CONTENT,
        CLICK_BEHAVIOR: result.bindings.CLICK_BEHAVIOR,
      };
      log(`Bindings discovered: LIST="${result.bindings.LIST}", LIST_ITEM="${result.bindings.LIST_ITEM}"`);
    } else {
      log('WARNING: No bindings in result');
    }

    // Convert extracted items to jobs
    for (const item of result.items) {
      const job = convertToJob(item, url);
      jobs.push(job);
    }

    updateState({ 
      status: 'idle',
      jobsFound: jobs.length,
    });

    // Create session report with full structure for UI compatibility
    const endedAt = Date.now();
    const searchQuery = extractSearchQuery(url);
    
    // Check if bindings were successfully discovered (empty object = failure)
    const hasValidBindings = result.bindings && Object.keys(result.bindings).length > 2;
    const bindingsError = result.error?.includes('bindings') ? result.error : undefined;
    
    // Build step logs from recipe execution
    const steps: StepLog[] = [
      {
        step: 1,
        timestamp: startedAt,
        goal: 'Navigate to page',
        actions: [
          { timestamp: startedAt, action: 'navigate', details: url, status: 'ok' },
        ],
        url,
        success: true,
      },
      {
        step: 2,
        timestamp: startedAt + 1000,
        goal: 'Discover page bindings',
        actions: [
          { timestamp: startedAt + 1000, action: 'analyze_dom', details: 'buildDomTree', status: 'ok' },
          { timestamp: startedAt + 2000, action: 'llm_call', details: 'Navigator LLM - discover bindings', status: hasValidBindings ? 'ok' : 'fail', error: bindingsError },
        ],
        success: hasValidBindings,
        error: bindingsError,
      },
      {
        step: 3,
        timestamp: startedAt + 3000,
        goal: `Extract ${maxJobs} job listings`,
        actions: [
          { timestamp: startedAt + 3000, action: 'execute_recipe', details: `${result.stats.commandsExecuted} commands`, status: result.success ? 'ok' : 'fail' },
          { timestamp: startedAt + 4000, action: 'scroll', details: `${result.stats.scrollsPerformed} scrolls`, status: 'ok' },
          { timestamp: endedAt - 1000, action: 'extract', details: `${result.stats.itemsProcessed} items processed`, status: 'ok' },
        ],
        success: result.success,
        error: result.error,
      },
    ];

    // Add binding fix steps if any
    if (result.stats.bindingFixes > 0) {
      steps.push({
        step: 4,
        timestamp: endedAt - 500,
        goal: 'Fix bindings',
        actions: [
          { timestamp: endedAt - 500, action: 'llm_call', details: `Navigator LLM - ${result.stats.bindingFixes} binding fixes`, status: 'ok' },
        ],
        success: true,
      });
    }

    log(`Creating session report...`);
    
    const report: SessionReport = {
      id: crypto.randomUUID(),
      startedAt,
      endedAt,
      duration: endedAt - startedAt,
      task: `Extract ${maxJobs} jobs`,
      sourceUrl: url,
      searchQuery,
      success: result.success,
      stoppedReason: result.success ? 'complete' : 'error',
      error: result.error,
      jobsFound: jobs.length,
      jobsExtracted: jobs,
      bindingFixes: result.stats.bindingFixes,
      commandsExecuted: result.stats.commandsExecuted,
      // Legacy fields for UI
      totalSteps: steps.length,
      successfulSteps: steps.filter(s => s.success).length,
      failedSteps: steps.filter(s => !s.success).length,
      totalActions: steps.reduce((sum, s) => sum + s.actions.length, 0),
      successfulActions: steps.reduce((sum, s) => sum + s.actions.filter(a => a.status === 'ok').length, 0),
      failedActions: steps.reduce((sum, s) => sum + s.actions.filter(a => a.status === 'fail').length, 0),
      steps,
      urlsVisited: [url],
      finalUrl: url,
      // New detailed logs
      logs,
      discoveredBindings,
      // Phase outputs from the agent flow
      phaseOutputs: result.phaseOutputs,
    };

    sessionReports.push(report);
    await saveReportsToStorage();

    const stoppedReason = jobs.length >= maxJobs ? 'max_jobs' : 'complete';
    
    return {
      success: jobs.length > 0 || result.success,
      jobs,
      stoppedReason,
      report,
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const errorStack = err instanceof Error ? err.stack : '';
    
    log(`ERROR: ${errorMessage}`);
    if (errorStack) {
      log(`Stack: ${errorStack.split('\n').slice(0, 3).join(' | ')}`);
    }
    
    updateState({ status: 'error', error: errorMessage });
    
    const endedAt = Date.now();
    const errorSteps: StepLog[] = [
      {
        step: 1,
        timestamp: startedAt,
        goal: 'Initialize discovery',
        actions: [
          { timestamp: startedAt, action: 'init', details: url, status: 'fail', error: errorMessage },
        ],
        success: false,
        error: errorMessage,
      },
    ];
    
    const report: SessionReport = {
      id: crypto.randomUUID(),
      startedAt,
      endedAt,
      duration: endedAt - startedAt,
      task: `Extract ${maxJobs} jobs`,
      sourceUrl: url,
      searchQuery: extractSearchQuery(url),
      success: false,
      stoppedReason: 'error',
      error: errorMessage,
      jobsFound: jobs.length,
      jobsExtracted: jobs,
      bindingFixes: 0,
      commandsExecuted: 0,
      // Legacy fields for UI
      totalSteps: 1,
      successfulSteps: 0,
      failedSteps: 1,
      totalActions: 1,
      successfulActions: 0,
      failedActions: 1,
      steps: errorSteps,
      urlsVisited: [url],
      finalUrl: url,
      // Include logs captured before the error
      logs,
      discoveredBindings,
    };

    sessionReports.push(report);
    await saveReportsToStorage();

    return { 
      success: false, 
      jobs, 
      error: errorMessage, 
      stoppedReason: 'error',
      report,
    };
  } finally {
    await cleanup();
  }
}

// ============================================================================
// Agent Flow Discovery (New Architecture)
// ============================================================================

/**
 * Discover jobs using the full agent flow:
 * StrategyPlanner → Generators → RecipeGenerator → Executor
 * 
 * Reports are streamed - saved after each phase completes.
 */
export async function discoverJobsWithAgentFlow(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { maxJobs, url, forceRefresh } = options;

  if (discoveryState.status === 'running') {
    return { success: false, jobs: [], error: 'Discovery already running' };
  }

  if (!url) {
    return { success: false, jobs: [], error: 'URL is required' };
  }

  // Create live report immediately - this will be streamed/saved after each phase
  const report = createLiveReport(url, `Extract ${maxJobs} jobs`);
  const jobs: Job[] = [];

  try {
    updateState({
      status: 'running',
      jobsFound: 0,
      currentStep: 0,
      startedAt: report.startedAt,
      error: undefined,
    });

    addLogToLiveReport(`Starting agent flow discovery for: ${url}`);
    addLogToLiveReport(`Max jobs to extract: ${maxJobs}`);

    // Add navigation step
    addPhaseToLiveReport({
      phase: 'binding_discovery', // Using this for navigate step
      timestamp: Date.now(),
      duration: 0,
      success: true,
      output: `Navigating to ${url}`,
    });

    if (forceRefresh) {
      addLogToLiveReport('Force refresh - clearing cached bindings');
      await clearBindingsForUrl(url);
    }

    // Initialize LLM
    addLogToLiveReport('Initializing LLM models...');
    const geminiApiKey = getGeminiApiKey();
    addLogToLiveReport(`Gemini API key present: ${geminiApiKey ? 'YES' : 'NO'}`);
    
    const modelConfig = createDualModelConfig(geminiApiKey);
    const plannerLLM = createChatModel(modelConfig.navigator);
    const extractorLLM = createChatModel(modelConfig.extractor);
    addLogToLiveReport('LLM models created');

    // Initialize browser
    addLogToLiveReport('Initializing browser context...');
    browserContext = await initBrowserContext(url);
    const page = await browserContext.getCurrentPage();
    
    addLogToLiveReport(`Page URL: ${page.url()}`);
    addLogToLiveReport(`Page title: ${await page.title()}`);
    
    updateLiveReport({ finalUrl: page.url() });

    // Create orchestrator
    const orchestrator = new AgentOrchestrator({
      plannerLLM,
      generatorLLM: plannerLLM,
      maxToolCalls: 5,
    });

    // Run the full agent flow
    addLogToLiveReport('Running agent orchestration...');
    updateState({ currentStep: 1, maxSteps: 4 });
    
    const orchestratorResult = await orchestrator.run({
      page,
      task: `Extract ${maxJobs} job listings from this page`,
      maxItems: maxJobs,
    });

    // Add each phase output to the live report (they're already saved incrementally)
    for (const phase of orchestratorResult.phaseOutputs) {
      addPhaseToLiveReport(phase);
      addLogToLiveReport(`Phase ${phase.phase}: ${phase.success ? 'SUCCESS' : 'FAILED'} (${phase.duration}ms)`);
      if (phase.error) {
        addLogToLiveReport(`  Error: ${phase.error}`);
      }
    }

    updateState({ currentStep: 2, maxSteps: 4 });

    if (!orchestratorResult.success || !orchestratorResult.recipe || !orchestratorResult.bindings) {
      addLogToLiveReport(`Orchestration failed: ${orchestratorResult.error}`);
      throw new Error(orchestratorResult.error || 'Recipe generation failed');
    }

    addLogToLiveReport(`Recipe generated: ${orchestratorResult.recipe.id} with ${orchestratorResult.recipe.commands.length} commands`);
    addLogToLiveReport(`Bindings: LIST="${orchestratorResult.bindings.LIST}", LIST_ITEM="${orchestratorResult.bindings.LIST_ITEM}"`);

    // Store bindings and recipe in report
    addLogToLiveReport('Storing bindings and recipe...');
    updateLiveReport({
      discoveredBindings: {
        id: orchestratorResult.bindings.id,
        LIST: orchestratorResult.bindings.LIST,
        LIST_ITEM: orchestratorResult.bindings.LIST_ITEM,
        DETAILS_PANEL: orchestratorResult.bindings.DETAILS_PANEL,
        DETAILS_CONTENT: orchestratorResult.bindings.DETAILS_CONTENT,
        CLICK_BEHAVIOR: orchestratorResult.bindings.CLICK_BEHAVIOR,
      },
      strategyPlannerOutput: orchestratorResult.strategy,
      generatedRecipe: orchestratorResult.recipe as unknown as Record<string, unknown>,
    });

    // Execute the generated recipe
    addLogToLiveReport('Creating executor...');
    const executor = new RecipeExecutor(page, orchestratorResult.bindings, extractorLLM);
    addLogToLiveReport('Starting recipe execution...');
    updateState({ currentStep: 3, maxSteps: 4 });
    
    let execResult;
    try {
      execResult = await executor.execute(orchestratorResult.recipe);
      addLogToLiveReport(`Execution finished: ${execResult.success ? 'SUCCESS' : 'FAILED'}`);
    } catch (execError) {
      const execErrorMsg = execError instanceof Error ? execError.message : String(execError);
      addLogToLiveReport(`EXECUTION CRASHED: ${execErrorMsg}`);
      throw execError;
    }

    // Add execution phase
    addPhaseToLiveReport({
      phase: 'binding_discovery', // Using for execution step
      timestamp: Date.now(),
      duration: execResult.stats.duration || 0,
      success: execResult.success,
      output: `Executed ${execResult.stats.commandsExecuted} commands, extracted ${execResult.items.length} items`,
      error: execResult.error,
    });

    updateState({ currentStep: 4, maxSteps: 4 });
    addLogToLiveReport(`Execution complete: ${execResult.items.length} items extracted`);
    addLogToLiveReport(`Stats: commands=${execResult.stats.commandsExecuted}, scrolls=${execResult.stats.scrollsPerformed}`);

    if (execResult.error) {
      addLogToLiveReport(`Execution error: ${execResult.error}`);
    }

    // Convert extracted items to jobs
    for (const item of execResult.items) {
      const job = convertToJob(item, url);
      jobs.push(job);
      notifyJobFound(job);
    }

    updateState({ 
      status: 'idle',
      jobsFound: jobs.length,
    });

    // Finalize report
    updateLiveReport({
      jobsFound: jobs.length,
      jobsExtracted: jobs,
      commandsExecuted: execResult.stats.commandsExecuted,
    });
    
    const success = jobs.length > 0;
    const stoppedReason = jobs.length >= maxJobs ? 'max_jobs' : (success ? 'complete' : 'error');
    finalizeLiveReport(success, execResult.error, stoppedReason);

    return {
      success,
      jobs,
      stoppedReason,
      report,
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    addLogToLiveReport(`ERROR: ${errorMessage}`);
    
    updateState({ status: 'error', error: errorMessage });
    
    // Finalize report with error
    updateLiveReport({
      jobsFound: jobs.length,
      jobsExtracted: jobs,
    });
    finalizeLiveReport(false, errorMessage, 'error');

    return {
      success: false,
      jobs,
      stoppedReason: 'error',
      error: errorMessage,
      report,
    };
  } finally {
    await cleanup();
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start job discovery using the Recipe API (default)
 * Set useAgentFlow=true to use the new agent architecture
 */
export async function startDiscovery(options: DiscoveryOptions & { useAgentFlow?: boolean }): Promise<DiscoveryResult> {
  if (options.useAgentFlow) {
    return discoverJobsWithAgentFlow(options);
  }
  return discoverJobsWithRecipe(options);
}

export async function stopDiscovery(): Promise<void> {
  if (discoveryState.status === 'running') {
    // Recipe runner doesn't have a stop method, so just cleanup
    await cleanup();
    updateState({ status: 'idle' });
  }
}

export function getDiscoveryState(): DiscoveryState {
  return { ...discoveryState };
}

export function onStateChange(listener: (state: DiscoveryState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function onJobFound(listener: (job: Job) => void): () => void {
  jobListeners.add(listener);
  return () => jobListeners.delete(listener);
}

// ============================================================================
// Session Reports
// ============================================================================

export async function getSessionReports(): Promise<SessionReport[]> {
  await loadReportsFromStorage();
  return [...sessionReports];
}

export async function getLastSessionReport(): Promise<SessionReport | null> {
  await loadReportsFromStorage();
  return sessionReports.length > 0 ? sessionReports[sessionReports.length - 1] : null;
}

export async function clearSessionReports(): Promise<void> {
  sessionReports = [];
  reportsLoaded = true;
  await chrome.storage.local.remove(REPORTS_STORAGE_KEY);
  console.log('[Discovery] Cleared all session reports from storage');
}
