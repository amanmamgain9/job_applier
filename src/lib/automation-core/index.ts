/**
 * automation-core - Browser automation library for Chrome Extensions
 * 
 * Main entry: Manager.run() or runDiscovery()
 * 
 * See explorer/ARCHITECTURE.md for full design.
 */

// Manager - top-level coordinator
export {
  Manager,
  runManager,
  type ManagerOptions,
  type ManagerMemory,
  type ManagerResult,
} from './explorer/manager';

// Discovery Agent - Phase 1
export {
  runDiscovery,
  type DiscoveryContext,
} from './agents/discovery';

// Discovery Sub-Agents
export {
  runStepDecider,
  type DiscoveryAction,
  type DiscoveryDecision,
} from './agents/discovery';

export {
  runAnalyzer,
  type DiscoveryAnalyzerResult,
} from './agents/discovery';

export {
  runSummarizer,
  type DiscoverySummarizerResult,
} from './agents/discovery';

// Composer - Phase 2
export {
  runComposer,
  type ComposerContext,
  type Recipe,
  type RecipeStep,
} from './agents/composer';

// Handoff Contracts
export {
  type HandoffInput,
  type HandoffOutput,
} from './agents/discovery';

// Memory & Types
export {
  type ExplorationResult,
} from './agents/discovery';

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
