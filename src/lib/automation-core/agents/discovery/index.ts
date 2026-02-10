/**
 * Discovery Agent
 * 
 * Phase 1 of Recipe Generation System.
 * Explores webpages to learn how to complete tasks.
 */

// Main agent
export {
  runDiscovery,
  runStepDecider,
  type DiscoveryContext,
  type DiscoveryAction,
  type DiscoveryDecision,
} from './discovery-agent';

// Sub-agents (visual analysis, summarization)
export { runAnalyzer, type DiscoveryAnalyzerResult } from './analyzer-agent';
export { runPageMatch, type PageMatchContext, type PageMatchResult } from './page-match-agent';
export { runSummarizer, type DiscoverySummarizerResult } from './summarizer-agent';

// Memory types
export { type ExplorationResult, type DiscoveryEvent } from './memory';

// Types
export { type HandoffInput, type HandoffOutput } from './types/handoff';

