// Main orchestrator
export { runOrchestrator, type OrchestratorOptions } from './orchestrator';

// Agents
export { runChangeAnalyzer, type ChangeAnalyzerOptions, type ChangeAnalysis } from './agents/change-analyzer';
export { runExplorer, type ExplorerOptions, type ExplorerAction, type ExplorerDecision } from './agents/explorer';
export { runSummarizer, type SummarizerOptions, type SummarizerResult } from './agents/summarizer';

// Memory
export { MemoryStore } from './memory/store';
export { 
  type PageNode, 
  type Edge, 
  type ClassifierResult, 
  type ExplorationResult 
} from './memory/types';

// Legacy exports (for backwards compatibility during transition)
export { explorePage, type ExplorePageOptions } from './page-explorer';
export { ToolExecutor } from './tool-executor';
export { 
  type ExplorerResult, 
  type ExplorationStep, 
  type ToolCall,
  type ToolResult,
  EXPLORER_TOOLS,
} from './types';
