/**
 * Memory types for page exploration graph
 */

export interface Edge {
  fromPageId: string;
  toPageId: string;
  action: string;        // "clicked Jobs nav link"
  selector?: string;     // the actual selector used
}

/**
 * A behavioral pattern discovered through exploration.
 * Multiple similar actions that produce the same effect are consolidated.
 */
export interface BehaviorPattern {
  id: string;                     // unique pattern id
  action: string;                 // what type of action: "click", "scroll", etc.
  targetDescription: string;      // human-readable: "job listing", "filter button"
  effect: string;                 // "updates details panel", "opens modal", "navigates"
  changeType: string;             // from ChangeAnalyzer: "content_loaded", "navigation", etc.
  selectors: string[];            // example selectors that trigger this (max 3)
  count: number;                  // how many times observed
  confirmed: boolean;             // true if count >= 2 (pattern is reliable)
  firstSeen: number;              // timestamp
}

export interface PageNode {
  id: string;                     // "homepage", "job_search"
  understanding: string;          // summarized understanding
  rawObservations: string[];      // collected before summarization (deprecated, for compat)
  patterns: BehaviorPattern[];    // consolidated behavior patterns
  incomingEdges: Edge[];          // how to reach this page
  outgoingEdges: Edge[];          // where you can go from here
  visitCount: number;             // times visited
  lastVisitedAt: number;          // timestamp
  lastUrl: string;                // last URL seen for this page type
}

export interface ClassifierResult {
  pageId: string;
  isNewPage: boolean;
  isSamePage: boolean;
  understanding: string;
  cameFrom?: string;
  viaAction?: string;
}

export interface KeyElements {
  filter_button?: string;
  apply_button?: string;
  job_listings?: string[];
  search_input?: string;
  pagination?: string;
  close_button?: string;
  [key: string]: string | string[] | undefined;
}

export interface ExplorationResult {
  success: boolean;
  pages: Map<string, PageNode>;
  navigationPath: string[];
  finalUnderstanding: string;
  keyElements?: KeyElements;
  error?: string;
}

