/**
 * automation-core - Browser automation library for Chrome Extensions
 * 
 * Main entry: runOrchestrator() - Multi-agent exploration with:
 * - Explorer Agent: Navigates and observes
 * - ChangeAnalyzer Agent: Classifies DOM changes and page types
 * - Consolidator Agent: Groups behavioral patterns
 * - Summarizer Agent: Compresses understanding
 * 
 * See explorer/ARCHITECTURE.md for full design.
 */

// Orchestrator - main entry point for exploration
export {
  runOrchestrator,
  type OrchestratorOptions,
} from './explorer/orchestrator';

// Exploration types
export {
  type ExplorationResult,
  type PageNode,
  type Edge,
  type ClassifierResult,
  type BehaviorPattern,
  type KeyElements,
  MemoryStore,
} from './explorer';

// Report Service - streaming reports
export {
  ReportService,
  type SessionReport,
  type StepLog,
  type ActionLog,
  type PhaseOutput,
  type ReportCallback,
} from './reporting';

// Browser - connects to Chrome tabs
export { BrowserContext } from './browser/context';
export { Page } from './browser/page';
export {
  type BrowserContextConfig,
  type BrowserState,
  type PageState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  BrowserError,
  URLNotAllowedError,
} from './browser/types';

// DOM - tree structure returned by buildDomTree
export { DOMElementNode, DOMTextNode } from './browser/dom/views';

// LLM - create chat models
export { createChatModel, validateLLMConfig } from './llm/factory';
export { type LLMConfig, type LLMProvider } from './types';

// Utilities
export { createLogger, setDebugEnabled } from './utils/logger';
export { domTreeToString } from './utils/dom-to-text';
