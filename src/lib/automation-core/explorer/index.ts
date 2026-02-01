// =============================================================================
// New Architecture (use these)
// =============================================================================

// Manager (top-level coordinator)
export { Manager, runManager as runManagerNew, type ManagerOptions, type ManagerMemory, type ManagerResult } from './manager';

// Discovery Loop (Phase 1)
export { runDiscoveryLoop, type DiscoveryContext } from './discovery-loop';

// Discovery Agent (per-step decision maker)
export { 
  runDiscoveryAgent, 
  type DiscoveryAction, 
  type DiscoveryDecision, 
  type DiscoveryAgentContext 
} from './agents/discovery-agent';

// Discovery Analyzer (visual diff)
export { 
  runDiscoveryAnalyzer, 
  type DiscoveryAnalyzerContext, 
  type DiscoveryAnalyzerResult 
} from './agents/discovery-analyzer';

// Discovery Summarizer (observation consolidation)
export { 
  runDiscoverySummarizer, 
  type DiscoverySummarizerContext, 
  type DiscoverySummarizerResult 
} from './agents/discovery-summarizer';

// Handoff Contracts
export { type HandoffInput, type HandoffOutput } from './types/handoff';

// =============================================================================
// Legacy Exports (for backwards compatibility during migration)
// =============================================================================

// Old orchestrator (deprecated, use Manager or runDiscoveryLoop)
export { runOrchestrator, type OrchestratorOptions } from './orchestrator';

// Old agent names (deprecated, use new names above)
export { 
  runManager as runManagerLegacy, 
  type ManagerOptions as LegacyManagerOptions, 
  type ManagerAction as LegacyManagerAction, 
  type ManagerDecision as LegacyManagerDecision 
} from './agents/manager';
export { runAnalyzer, type AnalyzerOptions, type AnalyzerInput, type AnalyzerOutput } from './agents/analyzer';
export { runSummarizer, type SummarizerOptions, type SummarizerResult } from './agents/summarizer';

// =============================================================================
// Memory (unchanged)
// =============================================================================

export { MemoryStore } from './memory/store';
export { 
  type PageNode, 
  type Edge, 
  type ClassifierResult, 
  type ExplorationResult,
  type BehaviorPattern,
  type KeyElements,
} from './memory/types';
