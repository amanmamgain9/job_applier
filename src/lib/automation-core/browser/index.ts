/**
 * Browser module exports
 */

export { BrowserContext } from './context';
export { Page, buildInitialState } from './page';

export {
  type BrowserContextConfig,
  type BrowserContextWindowSize,
  type PageState,
  type TabInfo,
  type BrowserState,
  type DOMState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  BrowserStateHistory,
  BrowserError,
  URLNotAllowedError,
} from './types';

export { isUrlAllowed, isNewTabPage, capTextLength } from './util';

// DOM exports
export * from './dom';

