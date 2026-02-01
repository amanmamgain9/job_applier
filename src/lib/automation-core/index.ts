/**
 * automation-core - Browser automation library for Chrome Extensions
 * 
 * Main entry: Manager.run() or runDiscoveryLoop()
 * 
 * See explorer/GOALS_AND_MEMORY.md for full design.
 */

// Manager - top-level coordinator
export {
  Manager,
  runManager,
  type ManagerOptions,
  type ManagerMemory,
  type ManagerResult,
} from './explorer/manager';

// Discovery Loop - Phase 1
export {
  runDiscoveryLoop,
  type DiscoveryContext,
} from './explorer/discovery-loop';

// Discovery Agent (per-step decision maker)
export {
  runDiscoveryAgent,
  type DiscoveryAction,
  type DiscoveryDecision,
  type DiscoveryAgentContext,
} from './explorer/agents/discovery-agent';

// Discovery Sub-Agents
export {
  runDiscoveryAnalyzer,
  type DiscoveryAnalyzerContext,
  type DiscoveryAnalyzerResult,
} from './explorer/agents/discovery-analyzer';

export {
  runDiscoverySummarizer,
  type DiscoverySummarizerContext,
  type DiscoverySummarizerResult,
} from './explorer/agents/discovery-summarizer';

// Handoff Contracts
export {
  type HandoffInput,
  type HandoffOutput,
} from './explorer/types/handoff';

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
