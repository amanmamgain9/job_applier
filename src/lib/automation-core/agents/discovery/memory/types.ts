/**
 * Memory types for page exploration
 */

import type { HandoffOutput } from '../types/handoff';
import type { DiscoveryAnalyzerResult, PageChangeResult } from '../analyzer-agent';
import type { DiscoverySummarizerResult } from '../summarizer-agent';

export type DiscoveryAction =
  | { type: 'explore'; action: 'click' | 'scroll_down' | 'scroll_up'; target?: string; reason: string }
  | { type: 'done'; understanding: string };

export interface ElementInfo {
  kind: 'click' | 'scroll';
  target?: string;
  label?: string;
  context?: string;
}

export interface DiscoveryDecision {
  action: DiscoveryAction;
  elementInfo?: ElementInfo;
}

export interface DiscoveryActionResult {
  action: 'click' | 'scroll_down' | 'scroll_up';
  target?: string;
  description: string;
  success: boolean;
}

export type DiscoveryEventInput =
  | { kind: 'decision'; output: HandoffOutput<DiscoveryDecision> }
  | { kind: 'action'; output: HandoffOutput<DiscoveryActionResult> }
  | {
      kind: 'llm_call';
      output: HandoffOutput<unknown>;
      meta: LlmCallMeta;
    }
  | {
      kind: 'analyzer';
      output: HandoffOutput<DiscoveryAnalyzerResult>;
      meta: {
        beforeUrl: string;
        afterUrl: string;
        beforeSnapshotId?: string;
        afterSnapshotId?: string;
      };
    }
  | {
      kind: 'page_change';
      output: HandoffOutput<PageChangeResult>;
      meta: {
        beforeUrl: string;
        afterUrl: string;
        fromPageKey?: string;
        toPageKey?: string;
        beforeSnapshotId?: string;
        afterSnapshotId?: string;
      };
    }
  | { kind: 'summarizer'; output: HandoffOutput<DiscoverySummarizerResult> };

export type DiscoveryEvent = DiscoveryEventInput & {
  pageKey: string;
  timestamp: number;
};

export type LlmCallAgent =
  | 'step_decider'
  | 'analyzer'
  | 'page_match'
  | 'summarizer'
  | 'page_id';

export interface LlmCallMeta {
  agent: LlmCallAgent;
  goal: string;
  model?: string;
  durationMs?: number;
}

export interface ExplorationResult {
  success: boolean;
  pageKeys: string[];
  events: DiscoveryEvent[];
  finalUnderstanding: string;
  error?: string;
}

