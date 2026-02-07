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
      kind: 'analyzer';
      output: HandoffOutput<DiscoveryAnalyzerResult>;
      meta: {
        beforeUrl: string;
        afterUrl: string;
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
      };
    }
  | { kind: 'summarizer'; output: HandoffOutput<DiscoverySummarizerResult> };

export type DiscoveryEvent = DiscoveryEventInput & {
  pageKey: string;
  timestamp: number;
};

export interface ExplorationResult {
  success: boolean;
  pageKeys: string[];
  events: DiscoveryEvent[];
  finalUnderstanding: string;
  error?: string;
}

