// =============================================================================
// Manager (top-level coordinator)
// =============================================================================

export { Manager, runManager, type ManagerOptions, type ManagerMemory, type ManagerResult } from './manager';

// =============================================================================
// Discovery (Phase 1)
// =============================================================================

// Discovery Loop
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

// =============================================================================
// Handoff Contracts
// =============================================================================

export { type HandoffInput, type HandoffOutput } from './types/handoff';

// =============================================================================
// Memory
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
