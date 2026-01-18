/**
 * DOM module exports
 */

export {
  getClickableElements,
  removeHighlights,
  getScrollInfo,
  injectBuildDomTreeScripts,
  calcBranchPathHashSet,
} from './service';

export { DOMBaseNode, DOMTextNode, DOMElementNode, DEFAULT_INCLUDE_ATTRIBUTES } from './views';
export type { DOMState } from './views';

export {
  HashedDomElement,
  DOMHistoryElement,
} from './history';
export type { Coordinates, CoordinateSet, ViewportInfo } from './history';

export {
  ClickableElementProcessor,
  getClickableElements as getClickableElementsList,
  hashDomElement,
} from './clickable/service';

export type {
  RawDomTextNode,
  RawDomElementNode,
  RawDomTreeNode,
  BuildDomTreeArgs,
  BuildDomTreeResult,
} from './raw_types';

