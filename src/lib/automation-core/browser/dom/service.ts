/**
 * DOM Service - Handles DOM tree extraction and manipulation
 */

import { createLogger } from '../../utils/logger';
import type { BuildDomTreeArgs, RawDomTreeNode, BuildDomTreeResult } from './raw_types';
import { type DOMState, type DOMBaseNode, DOMElementNode, DOMTextNode } from './views';
import type { ViewportInfo } from './history';
import { isNewTabPage } from '../util';

const logger = createLogger('DOMService');

/**
 * Get the clickable elements for the current page
 */
export async function getClickableElements(
  tabId: number,
  url: string,
  showHighlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
  debugMode = false,
): Promise<DOMState> {
  const [elementTree, selectorMap] = await buildDomTree(
    tabId,
    url,
    showHighlightElements,
    focusElement,
    viewportExpansion,
    debugMode,
  );
  return { elementTree, selectorMap };
}

/**
 * Build the DOM tree for a tab
 */
async function buildDomTree(
  tabId: number,
  url: string,
  showHighlightElements = true,
  focusElement = -1,
  viewportExpansion = 0,
  debugMode = false,
): Promise<[DOMElementNode, Map<number, DOMElementNode>]> {
  // Handle special pages
  if (isNewTabPage(url) || url.startsWith('chrome://')) {
    const elementTree = new DOMElementNode({
      tagName: 'body',
      xpath: '',
      attributes: {},
      children: [],
      isVisible: false,
      isInteractive: false,
      isTopElement: false,
      isInViewport: false,
      parent: null,
    });
    return [elementTree, new Map<number, DOMElementNode>()];
  }

  await injectBuildDomTreeScripts(tabId);

  const mainFrameResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: (args: BuildDomTreeArgs) => {
      return window.buildDomTree(args);
    },
    args: [
      {
        showHighlightElements,
        focusHighlightIndex: focusElement,
        viewportExpansion,
        startId: 0,
        startHighlightIndex: 0,
        debugMode,
      },
    ],
  });

  const mainFramePage = mainFrameResult[0]?.result as unknown as BuildDomTreeResult;
  if (!mainFramePage || !mainFramePage.map || !mainFramePage.rootId) {
    throw new Error('Failed to build DOM tree: No result returned or invalid structure');
  }

  if (debugMode && mainFramePage.perfMetrics) {
    logger.debug('DOM Tree Building Performance Metrics:', mainFramePage.perfMetrics);
  }

  return constructDomTree(mainFramePage);
}

/**
 * Constructs a DOM tree from the evaluated page data
 */
function constructDomTree(evalPage: BuildDomTreeResult): [DOMElementNode, Map<number, DOMElementNode>] {
  const jsNodeMap = evalPage.map;
  const jsRootId = evalPage.rootId;

  const selectorMap = new Map<number, DOMElementNode>();
  const nodeMap: Record<string, DOMBaseNode> = {};

  // First pass: create all nodes
  for (const [id, nodeData] of Object.entries(jsNodeMap)) {
    const [node] = parseNode(nodeData);
    if (node === null) {
      continue;
    }

    nodeMap[id] = node;

    if (node instanceof DOMElementNode && node.highlightIndex !== undefined && node.highlightIndex !== null) {
      selectorMap.set(node.highlightIndex, node);
    }
  }

  // Second pass: build the tree structure
  for (const [id, node] of Object.entries(nodeMap)) {
    if (node instanceof DOMElementNode) {
      const nodeData = jsNodeMap[id];
      const childrenIds = 'children' in nodeData ? nodeData.children : [];

      for (const childId of childrenIds) {
        if (!(childId in nodeMap)) {
          continue;
        }

        const childNode = nodeMap[childId];
        childNode.parent = node;
        node.children.push(childNode);
      }
    }
  }

  const htmlToDict = nodeMap[jsRootId];

  if (htmlToDict === undefined || !(htmlToDict instanceof DOMElementNode)) {
    throw new Error('Failed to parse HTML to dictionary');
  }

  return [htmlToDict, selectorMap];
}

/**
 * Parse a raw DOM node
 */
function parseNode(nodeData: RawDomTreeNode): [DOMBaseNode | null, string[]] {
  if (!nodeData) {
    return [null, []];
  }

  // Process text nodes
  if ('type' in nodeData && nodeData.type === 'TEXT_NODE') {
    const textNode = new DOMTextNode(nodeData.text, nodeData.isVisible, null);
    return [textNode, []];
  }

  const elementData = nodeData as Exclude<RawDomTreeNode, { type: string }>;

  // Process viewport info
  let viewportInfo: ViewportInfo | undefined = undefined;
  if ('viewport' in nodeData && typeof nodeData.viewport === 'object' && nodeData.viewport) {
    const viewportObj = nodeData.viewport as { width: number; height: number };
    viewportInfo = {
      width: viewportObj.width,
      height: viewportObj.height,
      scrollX: 0,
      scrollY: 0,
    };
  }

  const elementNode = new DOMElementNode({
    tagName: elementData.tagName,
    xpath: elementData.xpath,
    attributes: elementData.attributes ?? {},
    children: [],
    isVisible: elementData.isVisible ?? false,
    isInteractive: elementData.isInteractive ?? false,
    isTopElement: elementData.isTopElement ?? false,
    isInViewport: elementData.isInViewport ?? false,
    highlightIndex: elementData.highlightIndex ?? null,
    shadowRoot: elementData.shadowRoot ?? false,
    parent: null,
    viewportInfo: viewportInfo,
  });

  return [elementNode, elementData.children || []];
}

/**
 * Remove highlights from the page
 */
export async function removeHighlights(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const container = document.getElementById('playwright-highlight-container');
        if (container) {
          container.remove();
        }

        const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
        for (const el of Array.from(highlightedElements)) {
          el.removeAttribute('browser-user-highlight-id');
        }
      },
    });
  } catch (error) {
    logger.error('Failed to remove highlights:', error);
  }
}

/**
 * Get scroll information for a tab
 */
export async function getScrollInfo(tabId: number): Promise<[number, number, number]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      const scrollY = window.scrollY;
      const visualViewportHeight = window.visualViewport?.height || window.innerHeight;
      const scrollHeight = document.body.scrollHeight;
      return {
        scrollY: scrollY,
        visualViewportHeight: visualViewportHeight,
        scrollHeight: scrollHeight,
      };
    },
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get scroll information');
  }
  return [result.scrollY, result.visualViewportHeight, result.scrollHeight];
}

/**
 * Check which frames have the script injected
 */
async function scriptInjectedFrames(tabId: number): Promise<Map<number, boolean>> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => Object.prototype.hasOwnProperty.call(window, 'buildDomTree'),
    });
    return new Map(results.map(result => [result.frameId, result.result || false]));
  } catch (err) {
    logger.error('Failed to check script injection status:', err);
    return new Map();
  }
}

/**
 * Inject the buildDomTree script into a tab
 */
export async function injectBuildDomTreeScripts(tabId: number): Promise<void> {
  try {
    const injectedFrames = await scriptInjectedFrames(tabId);

    if (injectedFrames.size === 0) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['buildDomTree.js'],
        });
      } catch {
        // Silently ignore - script might already be injected
      }
      return;
    }

    if (Array.from(injectedFrames.values()).every(injected => injected)) {
      return;
    }

    const frameIdsToInject = Array.from(injectedFrames.keys()).filter(id => !injectedFrames.get(id));
    if (frameIdsToInject.length > 0) {
      await chrome.scripting.executeScript({
        target: {
          tabId,
          frameIds: frameIdsToInject,
        },
        files: ['buildDomTree.js'],
      });
    }
  } catch (err) {
    logger.error('Failed to inject scripts:', err);
  }
}

/**
 * Calculate branch path hash set for state comparison
 */
export async function calcBranchPathHashSet(state: DOMState): Promise<Set<string>> {
  const { getClickableElementsHashes } = await import('./clickable/service');
  return getClickableElementsHashes(state.elementTree);
}

