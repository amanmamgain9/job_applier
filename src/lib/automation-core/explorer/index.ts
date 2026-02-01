/**
 * Explorer - Re-exports for backward compatibility
 * 
 * The main discovery code has moved to agents/discovery/
 */

// Manager (lives here)
export { Manager, runManager, type ManagerOptions, type ManagerMemory, type ManagerResult } from './manager';

// Discovery Agent (moved to agents/discovery/)
export {
  runDiscovery,
  type DiscoveryContext,
  runStepDecider,
  type DiscoveryAction,
  type DiscoveryDecision,
  runAnalyzer,
  type DiscoveryAnalyzerResult,
  runSummarizer,
  type DiscoverySummarizerResult,
  MemoryStore,
  type ExplorationResult,
  type PageNode,
  type HandoffInput,
  type HandoffOutput,
} from '../agents/discovery';
