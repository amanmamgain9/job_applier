/**
 * Page - Puppeteer wrapper for browser page automation
 */

import 'webextension-polyfill';
import {
  connect,
  ExtensionTransport,
  type HTTPRequest,
  type HTTPResponse,
  type ProtocolType,
  type KeyInput,
} from 'puppeteer-core/lib/esm/puppeteer/puppeteer-core-browser.js';
import type { Browser } from 'puppeteer-core/lib/esm/puppeteer/api/Browser.js';
import type { Page as PuppeteerPage } from 'puppeteer-core/lib/esm/puppeteer/api/Page.js';
import type { ElementHandle } from 'puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js';
import type { Frame } from 'puppeteer-core/lib/esm/puppeteer/api/Frame.js';
import {
  getClickableElements as _getClickableElements,
  removeHighlights as _removeHighlights,
  getScrollInfo as _getScrollInfo,
  getRawDomTree as _getRawDomTree,
} from './dom/service';
import { DOMElementNode, type DOMState } from './dom/views';
import { type BrowserContextConfig, DEFAULT_BROWSER_CONTEXT_CONFIG, type PageState, URLNotAllowedError } from './types';
import { createLogger } from '../utils/logger';
import { isUrlAllowed } from './util';

const logger = createLogger('Page');

/**
 * Formats a DOMElementNode into a human-readable string for error messages
 */
function formatElementDesc(elementNode: DOMElementNode): string {
  return `<${elementNode.tagName}> (index: ${elementNode.highlightIndex}, xpath: ${elementNode.xpath})`;
}

export function buildInitialState(tabId?: number, url?: string, title?: string): PageState {
  return {
    elementTree: new DOMElementNode({
      tagName: 'root',
      isVisible: true,
      parent: null,
      xpath: '',
      attributes: {},
      children: [],
    }),
    selectorMap: new Map(),
    tabId: tabId || 0,
    url: url || '',
    title: title || '',
    screenshot: null,
    scrollY: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
  };
}

export class Page {
  private _tabId: number;
  private _browser: Browser | null = null;
  private _puppeteerPage: PuppeteerPage | null = null;
  private _config: BrowserContextConfig;
  private _state: PageState;
  private _validWebPage = false;
  private _cachedState: PageState | null = null;

  constructor(tabId: number, url: string, title: string, config: Partial<BrowserContextConfig> = {}) {
    this._tabId = tabId;
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
    this._state = buildInitialState(tabId, url, title);
    const lowerCaseUrl = url.trim().toLowerCase();
    this._validWebPage =
      (tabId &&
        lowerCaseUrl &&
        lowerCaseUrl.startsWith('http') &&
        !lowerCaseUrl.startsWith('https://chromewebstore.google.com')) ||
      false;
  }

  get tabId(): number {
    return this._tabId;
  }

  get validWebPage(): boolean {
    return this._validWebPage;
  }

  get attached(): boolean {
    return this._validWebPage && this._puppeteerPage !== null;
  }

  async attachPuppeteer(): Promise<boolean> {
    if (!this._validWebPage) {
      return false;
    }

    if (this._puppeteerPage) {
      return true;
    }

    logger.info('attaching puppeteer', this._tabId);
    const browser = await connect({
      transport: await ExtensionTransport.connectTab(this._tabId),
      defaultViewport: null,
      protocol: 'cdp' as ProtocolType,
    });
    this._browser = browser;

    const [page] = await browser.pages();
    this._puppeteerPage = page;

    await this._addAntiDetectionScripts();

    return true;
  }

  private async _addAntiDetectionScripts(): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }

    await this._puppeteerPage.evaluateOnNewDocument(`
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      window.chrome = { runtime: {} };

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      (function () {
        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function attachShadow(options) {
          return originalAttachShadow.call(this, { ...options, mode: "open" });
        };
      })();
    `);
  }

  async detachPuppeteer(): Promise<void> {
    if (this._browser) {
      await this._browser.disconnect();
      this._browser = null;
      this._puppeteerPage = null;
      this._state = buildInitialState(this._tabId);
    }
  }

  async removeHighlight(): Promise<void> {
    if (this._config.displayHighlights && this._validWebPage) {
      await _removeHighlights(this._tabId);
    }
  }

  async getClickableElements(showHighlightElements: boolean, focusElement: number): Promise<DOMState | null> {
    if (!this._validWebPage) {
      return null;
    }
    return _getClickableElements(
      this._tabId,
      this.url(),
      showHighlightElements,
      focusElement,
      this._config.viewportExpansion,
    );
  }

  async getScrollInfo(): Promise<[number, number, number]> {
    if (!this._validWebPage) {
      return [0, 0, 0];
    }
    return _getScrollInfo(this._tabId);
  }

  async getContent(): Promise<string> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }
    return await this._puppeteerPage.content();
  }

  getCachedState(): PageState | null {
    return this._cachedState;
  }

  async getState(useVision = false): Promise<PageState> {
    if (!this._validWebPage) {
      return buildInitialState(this._tabId);
    }
    await this.waitForPageAndFramesLoad();
    const updatedState = await this._updateState(useVision);
    this._cachedState = updatedState;
    return updatedState;
  }

  /**
   * Get the raw DOM tree output directly from buildDomTree.js
   * Returns the flat map as JSON string for the LLM.
   */
  async getRawDom(): Promise<string> {
    if (!this._validWebPage) {
      return '{}';
    }
    await this.waitForPageAndFramesLoad();
    const rawResult = await _getRawDomTree(this._tabId, this._state.url);
    return JSON.stringify(rawResult.map, null, 2);
  }

  async _updateState(useVision = false, focusElement = -1): Promise<PageState> {
    try {
      if (this._puppeteerPage) {
        await this._puppeteerPage.evaluate('1');
      }
    } catch (error) {
      logger.warning('Current page is no longer accessible:', error);
      if (this._browser) {
        const pages = await this._browser.pages();
        if (pages.length > 0) {
          this._puppeteerPage = pages[0];
        } else {
          throw new Error('Browser closed: no valid pages available');
        }
      }
    }

    try {
      await this.removeHighlight();

      const displayHighlights = this._config.displayHighlights || useVision;
      const content = await this.getClickableElements(displayHighlights, focusElement);
      if (!content) {
        logger.warning('Failed to get clickable elements');
        return this._state;
      }

      const screenshot = useVision ? await this.takeScreenshot() : null;
      const [scrollY, visualViewportHeight, scrollHeight] = await this.getScrollInfo();

      this._state.elementTree = content.elementTree;
      this._state.selectorMap = content.selectorMap;
      this._state.url = this._puppeteerPage?.url() || '';
      this._state.title = (await this._puppeteerPage?.title()) || '';
      this._state.screenshot = screenshot;
      this._state.scrollY = scrollY;
      this._state.visualViewportHeight = visualViewportHeight;
      this._state.scrollHeight = scrollHeight;
      return this._state;
    } catch (error) {
      logger.error('Failed to update state:', error);
      return this._state;
    }
  }

  async takeScreenshot(fullPage = false): Promise<string | null> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    try {
      await this._puppeteerPage.evaluate(() => {
        const styleId = 'puppeteer-disable-animations';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
            }
          `;
          document.head.appendChild(style);
        }
      });

      const screenshot = await this._puppeteerPage.screenshot({
        fullPage: fullPage,
        encoding: 'base64',
        type: 'jpeg',
        quality: 50,  // Lower quality for faster Gemini API calls (~360KB → ~150KB)
      });

      await this._puppeteerPage.evaluate(() => {
        const style = document.getElementById('puppeteer-disable-animations');
        if (style) {
          style.remove();
        }
      });

      return screenshot as string;
    } catch (error) {
      logger.error('Failed to take screenshot:', error);
      throw error;
    }
  }

  url(): string {
    if (this._puppeteerPage) {
      return this._puppeteerPage.url();
    }
    return this._state.url;
  }

  async title(): Promise<string> {
    if (this._puppeteerPage) {
      return await this._puppeteerPage.title();
    }
    return this._state.title;
  }

  async navigateTo(url: string): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }
    logger.info('navigateTo', url);

    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goto(url)]);
      logger.info('navigateTo complete');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Navigation failed:', error);
      throw error;
    }
  }

  async goBack(): Promise<void> {
    if (!this._puppeteerPage) return;

    try {
      await Promise.all([this.waitForPageAndFramesLoad(), this._puppeteerPage.goBack()]);
      logger.info('Navigation back completed');
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('timeout')) {
        logger.warning('Back navigation timeout, but page might still be usable:', error);
        return;
      }

      logger.error('Could not navigate back:', error);
      throw error;
    }
  }

  async scrollToPercent(yPercent: number, elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }
    if (!elementNode) {
      await this._puppeteerPage.evaluate(yPercent => {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        window.scrollTo({
          top: scrollTop,
          left: window.scrollX,
          behavior: 'smooth',
        });
      }, yPercent);
    } else {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element not found: ${formatElementDesc(elementNode)}`);
      }
      await element.evaluate((el, yPercent) => {
        const scrollHeight = el.scrollHeight;
        const viewportHeight = el.clientHeight;
        const scrollTop = (scrollHeight - viewportHeight) * (yPercent / 100);
        el.scrollTo({
          top: scrollTop,
          left: el.scrollLeft,
          behavior: 'smooth',
        });
      }, yPercent);
    }
  }

  async scrollToPreviousPage(elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    if (!elementNode) {
      await this._puppeteerPage.evaluate('window.scrollBy(0, -(window.visualViewport?.height || window.innerHeight));');
    } else {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element not found: ${formatElementDesc(elementNode)}`);
      }
      await element.evaluate(el => {
        el.scrollBy(0, -el.clientHeight);
      });
    }
  }

  async scrollToNextPage(elementNode?: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    if (!elementNode) {
      await this._puppeteerPage.evaluate('window.scrollBy(0, (window.visualViewport?.height || window.innerHeight));');
    } else {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element not found: ${formatElementDesc(elementNode)}`);
      }
      await element.evaluate(el => {
        el.scrollBy(0, el.clientHeight);
      });
    }
  }

  async sendKeys(keys: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    const keyParts = keys.split('+');
    const modifiers = keyParts.slice(0, -1);
    const mainKey = keyParts[keyParts.length - 1];

    try {
      for (const modifier of modifiers) {
        await this._puppeteerPage.keyboard.down(this._convertKey(modifier));
      }
      await Promise.all([
        this._puppeteerPage.keyboard.press(this._convertKey(mainKey)),
        this.waitForPageAndFramesLoad(),
      ]);
      logger.info('sendKeys complete', keys);
    } catch (error) {
      logger.error('Failed to send keys:', error);
      throw new Error(`Failed to send keys: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      for (const modifier of [...modifiers].reverse()) {
        try {
          await this._puppeteerPage.keyboard.up(this._convertKey(modifier));
        } catch (releaseError) {
          logger.error('Failed to release modifier:', modifier, releaseError);
        }
      }
    }
  }

  private _convertKey(key: string): KeyInput {
    const lowerKey = key.trim().toLowerCase();
    const isMac = navigator.userAgent.toLowerCase().includes('mac os x');

    if (isMac) {
      if (lowerKey === 'control' || lowerKey === 'ctrl') {
        return 'Meta' as KeyInput;
      }
      if (lowerKey === 'command' || lowerKey === 'cmd') {
        return 'Meta' as KeyInput;
      }
    }

    const keyMap: { [key: string]: string } = {
      a: 'KeyA', b: 'KeyB', c: 'KeyC', d: 'KeyD', e: 'KeyE',
      f: 'KeyF', g: 'KeyG', h: 'KeyH', i: 'KeyI', j: 'KeyJ',
      k: 'KeyK', l: 'KeyL', m: 'KeyM', n: 'KeyN', o: 'KeyO',
      p: 'KeyP', q: 'KeyQ', r: 'KeyR', s: 'KeyS', t: 'KeyT',
      u: 'KeyU', v: 'KeyV', w: 'KeyW', x: 'KeyX', y: 'KeyY', z: 'KeyZ',
      '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4',
      '5': 'Digit5', '6': 'Digit6', '7': 'Digit7', '8': 'Digit8', '9': 'Digit9',
      control: 'Control', shift: 'Shift', alt: 'Alt', meta: 'Meta',
      enter: 'Enter', backspace: 'Backspace', delete: 'Delete',
      arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
      arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
      escape: 'Escape', tab: 'Tab', space: 'Space',
    };

    return (keyMap[lowerKey] || key) as KeyInput;
  }

  async locateElement(element: DOMElementNode): Promise<ElementHandle | null> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer is not connected');
      return null;
    }
    let currentFrame: PuppeteerPage | Frame = this._puppeteerPage;

    const parents: DOMElementNode[] = [];
    let current = element;
    while (current.parent) {
      parents.push(current.parent);
      current = current.parent;
    }

    const iframes = parents.reverse().filter(item => item.tagName === 'iframe');
    for (const parent of iframes) {
      const cssSelector = parent.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);
      const frameElement: ElementHandle | null = await currentFrame.$(cssSelector);
      if (!frameElement) {
        logger.warning(`Could not find iframe with selector: ${cssSelector}`);
        return null;
      }
      const frame: Frame | null = await frameElement.contentFrame();
      if (!frame) {
        logger.warning(`Could not access frame content for selector: ${cssSelector}`);
        return null;
      }
      currentFrame = frame;
    }

    const cssSelector = element.enhancedCssSelectorForElement(this._config.includeDynamicAttributes);

    try {
      let elementHandle: ElementHandle | null = await currentFrame.$(cssSelector);

      if (!elementHandle) {
        const xpath = element.xpath;
        if (xpath) {
          try {
            const fullXpath = xpath.startsWith('/') ? xpath : `/${xpath}`;
            const xpathSelector = `::-p-xpath(${fullXpath})`;
            elementHandle = await currentFrame.$(xpathSelector);
          } catch (xpathError) {
            logger.error('Failed to locate element using XPath:', xpathError);
          }
        }
      }

      if (elementHandle) {
        const isHidden = await elementHandle.isHidden();
        if (!isHidden) {
          await this._scrollIntoViewIfNeeded(elementHandle);
        }
        return elementHandle;
      }
    } catch (error) {
      logger.error('Failed to locate element:', error);
    }

    return null;
  }

  async inputTextElementNode(_useVision: boolean, elementNode: DOMElementNode, text: string): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element not found: ${formatElementDesc(elementNode)}`);
      }

      const tagName = await element.evaluate(el => el.tagName.toLowerCase());
      const isContentEditable = await element.evaluate(el => {
        if (el instanceof HTMLElement) {
          return el.isContentEditable;
        }
        return false;
      });

      if (isContentEditable || tagName === 'input') {
        await element.evaluate(el => {
          if (el instanceof HTMLElement) {
            el.textContent = '';
          }
          if ('value' in el) {
            (el as HTMLInputElement).value = '';
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await element.type(text, { delay: 50 });
      } else {
        await element.evaluate((el, value) => {
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = value;
          } else if (el instanceof HTMLElement && el.isContentEditable) {
            el.textContent = value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, text);
      }

      await this.waitForPageAndFramesLoad();
    } catch (error) {
      const errorMsg = `Failed to input text into element: ${formatElementDesc(elementNode)}. Error: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  private async _scrollIntoViewIfNeeded(element: ElementHandle, timeout = 1000): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const isVisible = await element.evaluate(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
          return false;
        }

        const isInViewport =
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth);

        if (!isInViewport) {
          el.scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'center',
          });
          return false;
        }

        return true;
      });

      if (isVisible) break;

      if (Date.now() - startTime > timeout) {
        logger.warning('Timed out while trying to scroll element into view, continuing anyway');
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async clickElementNode(_useVision: boolean, elementNode: DOMElementNode): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer is not connected');
    }

    try {
      const element = await this.locateElement(elementNode);
      if (!element) {
        throw new Error(`Element not found: ${formatElementDesc(elementNode)}`);
      }

      await this._scrollIntoViewIfNeeded(element);

      try {
        await Promise.race([
          element.click(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 2000)),
        ]);
        await this._checkAndHandleNavigation();
      } catch (error) {
        if (error instanceof URLNotAllowedError) {
          throw error;
        }
        logger.info('Failed to click element, trying again', error);
        try {
          await element.evaluate(el => (el as HTMLElement).click());
        } catch (secondError) {
          if (secondError instanceof URLNotAllowedError) {
            throw secondError;
          }
          throw new Error(
            `Failed to click element: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
          );
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to click element: ${formatElementDesc(elementNode)}. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getSelectorMap(): Map<number, DOMElementNode> {
    if (this._cachedState === null) {
      return new Map();
    }
    return this._cachedState.selectorMap;
  }

  async getElementByIndex(index: number): Promise<ElementHandle | null> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap.get(index);
    if (!element) return null;
    return await this.locateElement(element);
  }

  getDomElementByIndex(index: number): DOMElementNode | null {
    const selectorMap = this.getSelectorMap();
    return selectorMap.get(index) || null;
  }

  isFileUploader(elementNode: DOMElementNode, maxDepth = 3, currentDepth = 0): boolean {
    if (currentDepth > maxDepth) {
      return false;
    }

    if (elementNode.tagName === 'input') {
      const attributes = elementNode.attributes;
      if (attributes['type']?.toLowerCase() === 'file' || !!attributes['accept']) {
        return true;
      }
    }

    if (elementNode.children && currentDepth < maxDepth) {
      for (const child of elementNode.children) {
        if ('tagName' in child) {
          if (this.isFileUploader(child as DOMElementNode, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async _waitForStableNetwork(): Promise<void> {
    if (!this._puppeteerPage) {
      throw new Error('Puppeteer page is not connected');
    }

    const RELEVANT_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'font', 'script', 'iframe']);

    const pendingRequests = new Set();
    let lastActivity = Date.now();

    const onRequest = (request: HTTPRequest) => {
      const resourceType = request.resourceType();
      if (!RELEVANT_RESOURCE_TYPES.has(resourceType)) {
        return;
      }
      pendingRequests.add(request);
      lastActivity = Date.now();
    };

    const onResponse = (response: HTTPResponse) => {
      const request = response.request();
      if (!pendingRequests.has(request)) {
        return;
      }
      pendingRequests.delete(request);
      lastActivity = Date.now();
    };

    this._puppeteerPage.on('request', onRequest);
    this._puppeteerPage.on('response', onResponse);

    try {
      const startTime = Date.now();

      while (true) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const now = Date.now();
        const timeSinceLastActivity = (now - lastActivity) / 1000;

        if (pendingRequests.size === 0 && timeSinceLastActivity >= this._config.waitForNetworkIdlePageLoadTime) {
          break;
        }

        const elapsedTime = (now - startTime) / 1000;
        if (elapsedTime > this._config.maximumWaitPageLoadTime) {
          break;
        }
      }
    } finally {
      this._puppeteerPage.off('request', onRequest);
      this._puppeteerPage.off('response', onResponse);
    }
  }

  async waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
    const startTime = Date.now();

    try {
      await this._waitForStableNetwork();

      if (this._puppeteerPage) {
        await this._checkAndHandleNavigation();
      }
    } catch (error) {
      if (error instanceof URLNotAllowedError) {
        throw error;
      }
      console.warn('Page load failed, continuing...', error);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const minWaitTime = timeoutOverwrite || this._config.minimumWaitPageLoadTime;
    const remaining = Math.max(minWaitTime - elapsed, 0);

    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining * 1000));
    }
  }

  private async _checkAndHandleNavigation(): Promise<void> {
    if (!this._puppeteerPage) {
      return;
    }

    const currentUrl = this._puppeteerPage.url();
    if (!isUrlAllowed(currentUrl, this._config.allowedUrls, this._config.deniedUrls)) {
      const errorMessage = `URL: ${currentUrl} is not allowed`;
      logger.error(errorMessage);

      const safeUrl = this._config.homePageUrl || 'about:blank';
      logger.info(`Redirecting to safe URL: ${safeUrl}`);

      try {
        await this._puppeteerPage.goto(safeUrl);
      } catch (error) {
        logger.error(`Failed to redirect to safe URL: ${error instanceof Error ? error.message : String(error)}`);
      }

      throw new URLNotAllowedError(errorMessage);
    }
  }

  async getDropdownOptions(index: number): Promise<Array<{ index: number; text: string; value: string }>> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    try {
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error('Dropdown element not found');
      }

      const options = await elementHandle.evaluate(select => {
        if (!(select instanceof HTMLSelectElement)) {
          throw new Error('Element is not a select element');
        }

        return Array.from(select.options).map(option => ({
          index: option.index,
          text: option.text,
          value: option.value,
        }));
      });

      if (!options.length) {
        throw new Error('No options found in dropdown');
      }

      return options;
    } catch (error) {
      throw new Error(`Failed to get dropdown options: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async selectDropdownOption(index: number, text: string): Promise<string> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap?.get(index);

    if (!element || !this._puppeteerPage) {
      throw new Error('Element not found or puppeteer is not connected');
    }

    try {
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        throw new Error(`Dropdown element with index ${index} not found`);
      }

      const result = await elementHandle.evaluate(
        (select, optionText, elementIndex) => {
          if (!(select instanceof HTMLSelectElement)) {
            return {
              found: false,
              message: `Element with index ${elementIndex} is not a SELECT`,
            };
          }

          const options = Array.from(select.options);
          const option = options.find(opt => opt.text.trim() === optionText);

          if (!option) {
            const availableOptions = options.map(o => o.text.trim()).join('", "');
            return {
              found: false,
              message: `Option "${optionText}" not found. Available: "${availableOptions}"`,
            };
          }

          const previousValue = select.value;
          select.value = option.value;

          if (previousValue !== option.value) {
            select.dispatchEvent(new Event('change', { bubbles: true }));
            select.dispatchEvent(new Event('input', { bubbles: true }));
          }

          return {
            found: true,
            message: `Selected option "${optionText}" with value "${option.value}"`,
          };
        },
        text,
        index,
      );

      return result.message;
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Evaluate if a CSS selector exists on the page
   * @param selector CSS selector to check
   * @returns true if at least one element matches the selector
   */
  async selectorExists(selector: string): Promise<boolean> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer not attached, cannot evaluate selector');
      return false;
    }

    try {
      const result = await this._puppeteerPage.evaluate((sel) => {
        const element = document.querySelector(sel);
        return element !== null;
      }, selector);
      return result;
    } catch (error) {
      logger.warning(`Failed to evaluate selector "${selector}":`, error);
      return false;
    }
  }

  /**
   * Count elements matching a CSS selector
   * @param selector CSS selector to count
   * @returns number of elements matching the selector
   */
  async countSelector(selector: string): Promise<number> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer not attached, cannot count selector');
      return 0;
    }

    try {
      const result = await this._puppeteerPage.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);
        return elements.length;
      }, selector);
      return result;
    } catch (error) {
      logger.warning(`Failed to count selector "${selector}":`, error);
      return 0;
    }
  }

  /**
   * Get text content from elements matching a selector
   * @param selector CSS selector
   * @returns array of text content from matching elements
   */
  async getTextFromSelector(selector: string): Promise<string[]> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer not attached, cannot get text');
      return [];
    }

    try {
      const result = await this._puppeteerPage.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map(el => (el as HTMLElement).innerText || el.textContent || '');
      }, selector);
      return result;
    } catch (error) {
      logger.warning(`Failed to get text from selector "${selector}":`, error);
      return [];
    }
  }

  /**
   * Click an element by CSS selector
   * @param selector CSS selector to click
   * @returns true if click was successful
   */
  async clickSelector(selector: string): Promise<boolean> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer not attached, cannot click selector');
      return false;
    }

    try {
      await this._puppeteerPage.click(selector);
      return true;
    } catch (error) {
      logger.warning(`Failed to click selector "${selector}":`, error);
      return false;
    }
  }

  /**
   * Type text into an element by CSS selector
   * @param selector CSS selector for the input element
   * @param text Text to type
   * @returns true if typing was successful
   */
  async typeSelector(selector: string, text: string): Promise<boolean> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer not attached, cannot type');
      return false;
    }

    try {
      await this._puppeteerPage.click(selector);
      await this._puppeteerPage.type(selector, text);
      return true;
    } catch (error) {
      logger.warning(`Failed to type into "${selector}":`, error);
      return false;
    }
  }

  /**
   * Scroll the main page by pixels
   * @param x Horizontal scroll amount
   * @param y Vertical scroll amount
   */
  async scrollBy(x: number, y: number): Promise<void> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer not attached, cannot scroll');
      return;
    }

    await this._puppeteerPage.evaluate((scrollX, scrollY) => {
      window.scrollBy(scrollX, scrollY);
    }, x, y);
  }

  /**
   * Get all elements matching a selector as an array with index references
   * @param selector CSS selector
   * @returns array of element info objects
   */
  async querySelectorAll(selector: string): Promise<Array<{ index: number; tagName: string; text: string; href?: string; dataId?: string }>> {
    if (!this._puppeteerPage) {
      logger.warning('Puppeteer not attached, cannot query selector');
      return [];
    }

    try {
      const result = await this._puppeteerPage.evaluate((sel) => {
        const elements = document.querySelectorAll(sel);
        return Array.from(elements).map((el, index) => {
          const htmlEl = el as HTMLElement;
          
          // Get text content - try innerText first, then textContent
          // Also try to get structured data from nested elements
          let text = '';
          try {
            text = (htmlEl.innerText || htmlEl.textContent || '').trim();
            
            // For job cards, try to structure the content better
            // Look for common patterns: title, company, location elements
            const titleEl = htmlEl.querySelector('strong, [class*="title"], h3, h4');
            const companyEl = htmlEl.querySelector('[class*="company"], [class*="subtitle"]');
            const locationEl = htmlEl.querySelector('[class*="location"], [class*="metadata"]');
            
            // If we found structured elements, format them
            if (titleEl || companyEl) {
              const parts: string[] = [];
              if (titleEl) parts.push(`Title: ${(titleEl as HTMLElement).innerText?.trim() || ''}`);
              if (companyEl) parts.push(`Company: ${(companyEl as HTMLElement).innerText?.trim() || ''}`);
              if (locationEl) parts.push(`Location: ${(locationEl as HTMLElement).innerText?.trim() || ''}`);
              if (parts.length > 0) {
                text = parts.join('\n') + '\n---\n' + text;
              }
            }
          } catch {
            text = '';
          }
          
          // Try to find href in the element or its children
          let href = '';
          const linkEl = el.tagName === 'A' ? el : el.querySelector('a');
          if (linkEl) {
            href = (linkEl as HTMLAnchorElement).href || '';
          }
          
          // Get data-id from the element or parent
          let dataId = htmlEl.dataset?.jobId || 
                        htmlEl.dataset?.occludableJobId || 
                        htmlEl.getAttribute('data-job-id') ||
                        htmlEl.getAttribute('data-occludable-job-id') ||
                        '';
          
          // Also check parent for job ID
          if (!dataId && htmlEl.parentElement) {
            dataId = htmlEl.parentElement.dataset?.jobId ||
                    htmlEl.parentElement.dataset?.occludableJobId ||
                    htmlEl.parentElement.getAttribute('data-job-id') ||
                    htmlEl.parentElement.getAttribute('data-occludable-job-id') ||
                    '';
          }
          
          return {
            index,
            tagName: el.tagName.toLowerCase(),
            text: text.slice(0, 1500),  // Increased for structured content
            href: href || undefined,
            dataId: dataId || undefined,
          };
        });
      }, selector);
      
      logger.info(`querySelectorAll("${selector}"): found ${result.length} elements`);
      if (result.length > 0) {
        logger.debug(`First element text preview: "${result[0].text.slice(0, 100)}..."`);
      }
      
      return result;
    } catch (error) {
      logger.warning(`Failed to query selector "${selector}":`, error);
      return [];
    }
  }

  /**
   * Evaluate a function on an element by its index
   * @param index Element index from selector map
   * @param fn Function to evaluate on the element
   * @returns Result of the function evaluation
   */
  async evaluateOnElement<T>(
    index: number, 
    fn: (el: Element) => T
  ): Promise<T | null> {
    const selectorMap = this.getSelectorMap();
    const element = selectorMap.get(index);
    
    if (!element || !this._puppeteerPage) {
      return null;
    }

    try {
      const elementHandle = await this.locateElement(element);
      if (!elementHandle) {
        return null;
      }
      
      const result = await elementHandle.evaluate(fn);
      return result;
    } catch (error) {
      logger.warning(`Failed to evaluate on element ${index}:`, error);
      return null;
    }
  }
}

