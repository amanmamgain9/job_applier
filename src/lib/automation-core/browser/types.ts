/**
 * Browser-related types
 */

import type { DOMElementNode } from './dom/views';
import type { DOMHistoryElement } from './dom/history';

// ============================================================================
// Browser Context Configuration
// ============================================================================

export interface BrowserContextWindowSize {
  width: number;
  height: number;
}

export interface BrowserContextConfig {
  /**
   * Minimum time to wait before getting page state for LLM input
   * @default 0.25
   */
  minimumWaitPageLoadTime: number;

  /**
   * Time to wait for network requests to finish before getting page state.
   * Lower values may result in incomplete page loads.
   * @default 0.5
   */
  waitForNetworkIdlePageLoadTime: number;

  /**
   * Maximum time to wait for page load before proceeding anyway
   * @default 5.0
   */
  maximumWaitPageLoadTime: number;

  /**
   * Time to wait between multiple actions in one step
   * @default 0.5
   */
  waitBetweenActions: number;

  /**
   * Default browser window size
   * @default { width: 1280, height: 1100 }
   */
  browserWindowSize: BrowserContextWindowSize;

  /**
   * Viewport expansion in pixels. This amount will increase the number of elements
   * which are included in the state what the LLM will see.
   * If set to -1, all elements will be included (this leads to high token usage).
   * If set to 0, only the elements which are visible in the viewport will be included.
   * @default 0
   */
  viewportExpansion: number;

  /**
   * List of allowed domains that can be accessed. If empty, all domains are allowed.
   * @default []
   */
  allowedUrls: string[];

  /**
   * List of denied domains that cannot be accessed. If empty, no domains are blocked.
   * @default []
   */
  deniedUrls: string[];

  /**
   * Include dynamic attributes in the CSS selector.
   * @default true
   */
  includeDynamicAttributes: boolean;

  /**
   * Home page url
   * @default 'about:blank'
   */
  homePageUrl: string;

  /**
   * Display highlights on interactive elements
   * @default true
   */
  displayHighlights: boolean;
}

export const DEFAULT_BROWSER_CONTEXT_CONFIG: BrowserContextConfig = {
  minimumWaitPageLoadTime: 0.25,
  waitForNetworkIdlePageLoadTime: 0.5,
  maximumWaitPageLoadTime: 5.0,
  waitBetweenActions: 0.5,
  browserWindowSize: { width: 1280, height: 1100 },
  viewportExpansion: 0,
  allowedUrls: [],
  deniedUrls: [],
  includeDynamicAttributes: true,
  homePageUrl: 'about:blank',
  displayHighlights: true,
};

// ============================================================================
// DOM State
// ============================================================================

export interface DOMState {
  elementTree: DOMElementNode;
  selectorMap: Map<number, DOMElementNode>;
}

// ============================================================================
// Page State
// ============================================================================

export interface PageState extends DOMState {
  tabId: number;
  url: string;
  title: string;
  screenshot: string | null;
  scrollY: number;
  scrollHeight: number;
  visualViewportHeight: number;
}

// ============================================================================
// Tab Info
// ============================================================================

export interface TabInfo {
  id: number;
  url: string;
  title: string;
}

// ============================================================================
// Browser State
// ============================================================================

export interface BrowserState extends PageState {
  tabs: TabInfo[];
}

export class BrowserStateHistory {
  url: string;
  title: string;
  tabs: TabInfo[];
  interactedElements: (DOMHistoryElement | null)[];

  constructor(state: BrowserState, interactedElements?: (DOMHistoryElement | null)[]) {
    this.url = state.url;
    this.title = state.title;
    this.tabs = state.tabs;
    this.interactedElements = interactedElements ?? [];
  }
}

// ============================================================================
// Errors
// ============================================================================

export class BrowserError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

export class URLNotAllowedError extends BrowserError {
  constructor(message?: string) {
    super(message);
    this.name = 'URLNotAllowedError';
  }
}

