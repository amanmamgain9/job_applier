// Main orchestrator
export { runOrchestrator, type OrchestratorOptions } from './orchestrator';

// Agents
export { runChangeAnalyzer, type ChangeAnalyzerOptions, type ChangeAnalysis } from './agents/change-analyzer';
export { runExplorer, type ExplorerOptions, type ExplorerAction, type ExplorerDecision } from './agents/explorer';
export { runSummarizer, type SummarizerOptions, type SummarizerResult } from './agents/summarizer';
export { runConsolidator, type ConsolidatorOptions, type ConsolidatorOutput } from './agents/consolidator';

// Memory
export { MemoryStore } from './memory/store';
export { 
  type PageNode, 
  type Edge, 
  type ClassifierResult, 
  type ExplorationResult,
  type BehaviorPattern,
  type KeyElements,
} from './memory/types';
