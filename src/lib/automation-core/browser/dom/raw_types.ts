/**
 * Raw DOM types used in injected scripts
 */

import type { CoordinateSet, ViewportInfo } from './history';

export type RawDomTextNode = {
  type: string;
  text: string;
  isVisible: boolean;
};

export type RawDomElementNode = {
  tagName: string | null;
  xpath: string | null;
  attributes: Record<string, string>;
  children: string[];
  isVisible?: boolean;
  isInteractive?: boolean;
  isTopElement?: boolean;
  isInViewport?: boolean;
  highlightIndex?: number;
  viewportCoordinates?: CoordinateSet;
  pageCoordinates?: CoordinateSet;
  viewportInfo?: ViewportInfo;
  shadowRoot?: boolean;
};

export type RawDomTreeNode = RawDomTextNode | RawDomElementNode;

export interface BuildDomTreeArgs {
  showHighlightElements: boolean;
  focusHighlightIndex: number;
  viewportExpansion: number;
  startId?: number;
  startHighlightIndex?: number;
  debugMode?: boolean;
}

export interface PerfMetrics {
  nodeMetrics: {
    totalNodes: number;
    processedNodes: number;
    skippedNodes: number;
  };
  cacheMetrics: {
    boundingRectCacheHits: number;
    boundingRectCacheMisses: number;
    computedStyleCacheHits: number;
    computedStyleCacheMisses: number;
    getBoundingClientRectTime: number;
    getComputedStyleTime: number;
    boundingRectHitRate: number;
    computedStyleHitRate: number;
    overallHitRate: number;
  };
  timings: Record<string, number>;
  buildDomTreeBreakdown: Record<string, number | Record<string, number>>;
}

export interface BuildDomTreeResult {
  rootId: string;
  map: Record<string, RawDomTreeNode>;
  perfMetrics?: PerfMetrics;
}

declare global {
  interface Window {
    buildDomTree: (args: BuildDomTreeArgs) => RawDomTreeNode | null;
  }
}

