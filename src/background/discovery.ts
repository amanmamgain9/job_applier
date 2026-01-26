/**
 * Discovery - Entry point for page analysis
 * 
 * Receives user request, calls automation-core orchestrator, returns results.
 * Uses ReportService from automation-core for streaming reports.
 */

import { 
  BrowserContext, 
  runOrchestrator,
  createChatModel,
  ReportService,
  type ExplorationResult,
  type SessionReport,
} from '@/lib/automation-core';
import { createMessage } from '@shared/types/messages';

// Re-export types for Reports.tsx
export type { SessionReport, StepLog, ActionLog } from '@/lib/automation-core';

// ============================================================================
// Types
// ============================================================================

export type DiscoveryStatus = 'idle' | 'running' | 'error';

export interface DiscoveryState {
  status: DiscoveryStatus;
  jobsFound: number;
  currentStep: number;
  maxSteps: number;
  error?: string;
}

export interface DiscoveryOptions {
  url: string;
  task: string;
}

export interface DiscoveryResult {
  success: boolean;
  exploration?: ExplorationResult;
  report?: SessionReport;
  error?: string;
}

// ============================================================================
// State
// ============================================================================

const MAX_STEPS = 3; // 1. Connect, 2. Navigate, 3. Explore

let currentState: DiscoveryState = { 
  status: 'idle',
  jobsFound: 0,
  currentStep: 0,
  maxSteps: MAX_STEPS,
};

let browserContext: BrowserContext | null = null;
let currentReport: SessionReport | null = null;

// ============================================================================
// State Management
// ============================================================================

export function getDiscoveryState(): DiscoveryState {
  return { ...currentState };
}

function updateState(updates: Partial<DiscoveryState>): void {
  currentState = { ...currentState, ...updates };
  
  // Broadcast state to UI
  broadcastState();
}

function broadcastState(): void {
  try {
    chrome.runtime.sendMessage(createMessage('DISCOVERY_STATE', {
      status: currentState.status,
      jobsFound: currentState.jobsFound,
      currentStep: currentState.currentStep,
      maxSteps: currentState.maxSteps,
      error: currentState.error,
    })).catch(() => {
      // Ignore - no listeners
    });
  } catch {
    // Ignore broadcast errors
  }
}

function broadcastReport(report: SessionReport): void {
  currentReport = report;
  try {
    chrome.runtime.sendMessage(createMessage('REPORT_UPDATE', report)).catch(() => {
      // Ignore - no listeners
    });
  } catch {
    // Ignore broadcast errors
  }
}

export function getCurrentReport(): SessionReport | null {
  return currentReport;
}

// ============================================================================
// Main Discovery Function
// ============================================================================

export async function startDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { url, task } = options;
  
  console.log('[Discovery] Starting for:', url);
  console.log('[Discovery] Task:', task);
  
  // Reset state
  updateState({ 
    status: 'running', 
    jobsFound: 0, 
    currentStep: 0, 
    maxSteps: MAX_STEPS,
    error: undefined,
  });
  
  // Create ReportService - this streams updates as they happen
  const report = new ReportService({
    task,
    sourceUrl: url,
    onUpdate: broadcastReport, // Stream every update to UI
  });
  
  try {
    // Step 1: Setup
    report.startStep('Setting up LLM and browser');
    updateState({ currentStep: 1 });
    
    report.startAction('Getting API key');
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      report.endAction(false, 'API key not configured');
      throw new Error('Gemini API key not configured. Set it in Settings.');
    }
    report.endAction(true);
    
    report.startAction('Creating LLM');
    const llm = createChatModel({
      provider: 'gemini',
      model: 'gemini-3-flash-preview',  // Latest Gemini 3 Flash - best for reasoning
      apiKey,
    });
    report.endAction(true);
    
    report.startAction('Creating browser context');
    browserContext = new BrowserContext();
    report.endAction(true);
    report.endStep(true);
    
    // Step 2: Open new tab with URL
    report.startStep('Opening page');
    updateState({ currentStep: 2 });
    
    report.startAction('Opening new tab', url);
    const page = await browserContext.openTab(url);
    report.endAction(true);
    
    report.startAction('Waiting for page load');
    await new Promise(resolve => setTimeout(resolve, 2000));
    report.endAction(true);
    report.endStep(true);
    
    // Step 3: Run orchestrator (multi-agent exploration)
    report.startStep('Exploring page with LLM agents');
    updateState({ currentStep: 3 });
    
    const exploration = await runOrchestrator({
      page,
      task,
      llm,
      report,
      maxSteps: 25, // Max exploration actions
    });
    
    report.endStep(exploration.success, exploration.error);
    
    console.log('[Discovery] Exploration complete:', {
      pagesFound: exploration.pages.size,
      navigationPath: exploration.navigationPath,
      success: exploration.success,
    });
    
    // Done
    const finalReport = report.complete(exploration.success, exploration.error);
    updateState({ status: 'idle', currentStep: MAX_STEPS });
    
    return {
      success: exploration.success,
      exploration,
      report: finalReport,
      error: exploration.error,
    };
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Discovery] Error:', errorMessage);
    
    const finalReport = report.complete(false, errorMessage);
    updateState({ status: 'error', error: errorMessage });
    
    return {
      success: false,
      report: finalReport,
      error: errorMessage,
    };
  } finally {
    // Cleanup
    if (browserContext) {
      await browserContext.cleanup();
      browserContext = null;
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function getGeminiApiKey(): Promise<string | null> {
  // First check .env (dev mode)
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envKey) return envKey;
  
  // Then check storage (production)
  try {
    const result = await chrome.storage.local.get('settings');
    return result.settings?.geminiApiKey || null;
  } catch {
    return null;
  }
}

export function stopDiscovery(): void {
  updateState({ status: 'idle', currentStep: 0 });
  if (browserContext) {
    browserContext.cleanup();
    browserContext = null;
  }
}
