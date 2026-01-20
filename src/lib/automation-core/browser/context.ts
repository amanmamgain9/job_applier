/**
 * BrowserContext - Manages browser tabs and pages for automation
 */

import 'webextension-polyfill';
import {
  type BrowserContextConfig,
  type BrowserState,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  type TabInfo,
  URLNotAllowedError,
} from './types';
import { Page, buildInitialState } from './page';
import { createLogger } from '../utils/logger';
import { isUrlAllowed } from './util';

const logger = createLogger('BrowserContext');

export class BrowserContext {
  private _config: BrowserContextConfig;
  private _currentTabId: number | null = null;
  private _attachedPages: Map<number, Page> = new Map();

  constructor(config: Partial<BrowserContextConfig> = {}) {
    this._config = { ...DEFAULT_BROWSER_CONTEXT_CONFIG, ...config };
  }

  /**
   * Create a BrowserContext attached to a specific tab
   */
  static async fromTab(tabId: number, config: Partial<BrowserContextConfig> = {}): Promise<BrowserContext> {
    const context = new BrowserContext(config);
    const tab = await chrome.tabs.get(tabId);
    const page = new Page(tabId, tab.url || '', tab.title || '', context._config);
    await context.attachPage(page);
    context._currentTabId = tabId;
    return context;
  }

  /**
   * Create a BrowserContext attached to the current active tab
   */
  static async fromActiveTab(config: Partial<BrowserContextConfig> = {}): Promise<BrowserContext> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found');
    }
    return BrowserContext.fromTab(tab.id, config);
  }

  public getConfig(): BrowserContextConfig {
    return this._config;
  }

  public updateConfig(config: Partial<BrowserContextConfig>): void {
    this._config = { ...this._config, ...config };
  }

  public updateCurrentTabId(tabId: number): void {
    this._currentTabId = tabId;
  }

  private async _getOrCreatePage(tab: chrome.tabs.Tab, forceUpdate = false): Promise<Page> {
    if (!tab.id) {
      throw new Error('Tab ID is not available');
    }

    const existingPage = this._attachedPages.get(tab.id);
    if (existingPage) {
      logger.info('getOrCreatePage', tab.id, 'already attached');
      if (!forceUpdate) {
        return existingPage;
      }
      await existingPage.detachPuppeteer();
      this._attachedPages.delete(tab.id);
    }
    logger.info('getOrCreatePage', tab.id, 'creating new page');
    return new Page(tab.id, tab.url || '', tab.title || '', this._config);
  }

  public async cleanup(): Promise<void> {
    const currentPage = await this.getCurrentPage();
    currentPage?.removeHighlight();
    for (const page of this._attachedPages.values()) {
      await page.detachPuppeteer();
    }
    this._attachedPages.clear();
    this._currentTabId = null;
  }

  public async attachPage(page: Page): Promise<boolean> {
    if (this._attachedPages.has(page.tabId)) {
      logger.info('attachPage', page.tabId, 'already attached');
      return true;
    }

    if (await page.attachPuppeteer()) {
      logger.info('attachPage', page.tabId, 'attached');
      this._attachedPages.set(page.tabId, page);
      return true;
    }
    return false;
  }

  public async detachPage(tabId: number): Promise<void> {
    const page = this._attachedPages.get(tabId);
    if (page) {
      await page.detachPuppeteer();
      this._attachedPages.delete(tabId);
    }
  }

  public async getCurrentPage(): Promise<Page> {
    if (!this._currentTabId) {
      let activeTab: chrome.tabs.Tab;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        const newTab = await chrome.tabs.create({ url: this._config.homePageUrl });
        if (!newTab.id) {
          throw new Error('No tab ID available');
        }
        activeTab = newTab;
      } else {
        activeTab = tab;
      }
      logger.info('active tab', activeTab.id, activeTab.url, activeTab.title);
      const page = await this._getOrCreatePage(activeTab);
      await this.attachPage(page);
      this._currentTabId = activeTab.id || null;
      return page;
    }

    const existingPage = this._attachedPages.get(this._currentTabId);
    if (!existingPage) {
      const tab = await chrome.tabs.get(this._currentTabId);
      const page = await this._getOrCreatePage(tab);
      await this.attachPage(page);
      return page;
    }

    return existingPage;
  }

  public async getAllTabIds(): Promise<Set<number>> {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return new Set(tabs.map(tab => tab.id).filter(id => id !== undefined));
  }

  private async waitForTabEvents(
    tabId: number,
    options: {
      waitForUpdate?: boolean;
      waitForActivation?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<void> {
    // waitForActivation defaults to false - DevTools Protocol doesn't require tab to be visually active
    const { waitForUpdate = true, waitForActivation = false, timeoutMs = 5000 } = options;

    logger.info(`[waitForTabEvents] tabId=${tabId}, waitForUpdate=${waitForUpdate}, waitForActivation=${waitForActivation}, timeout=${timeoutMs}ms`);

    const promises: Promise<void>[] = [];

    if (waitForUpdate) {
      const updatePromise = new Promise<void>((resolve, reject) => {
        let hasUrl = false;
        let hasTitle = false;
        let isComplete = false;

        const checkAndResolve = (source: string) => {
          logger.info(`[waitForTabEvents] ${source}: hasUrl=${hasUrl}, hasTitle=${hasTitle}, isComplete=${isComplete}`);
          if (hasUrl && hasTitle && isComplete) {
            chrome.tabs.onUpdated.removeListener(onUpdatedHandler);
            logger.info(`[waitForTabEvents] Update complete for tab ${tabId}`);
            resolve();
          }
        };

        const onUpdatedHandler = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (updatedTabId !== tabId) return;

          logger.info(`[waitForTabEvents] onUpdated event:`, changeInfo);
          if (changeInfo.url !== undefined) hasUrl = true;
          if (changeInfo.title !== undefined) hasTitle = true;
          if (changeInfo.status === 'complete') isComplete = true;

          checkAndResolve('onUpdated');
        };
        chrome.tabs.onUpdated.addListener(onUpdatedHandler);

        chrome.tabs.get(tabId).then(tab => {
          logger.info(`[waitForTabEvents] Initial tab state: url=${tab.url}, title=${tab.title}, status=${tab.status}`);
          if (tab.url !== undefined) hasUrl = true;
          if (tab.title !== undefined) hasTitle = true;
          if (tab.status === 'complete') isComplete = true;

          checkAndResolve('initial');
        }).catch(err => {
          logger.error(`[waitForTabEvents] Failed to get tab ${tabId}:`, err);
          reject(err);
        });
      });
      promises.push(updatePromise);
    }

    if (waitForActivation) {
      const activatedPromise = new Promise<void>(resolve => {
        const onActivatedHandler = (activeInfo: chrome.tabs.TabActiveInfo) => {
          if (activeInfo.tabId === tabId) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            logger.info(`[waitForTabEvents] Tab ${tabId} activated`);
            resolve();
          }
        };
        chrome.tabs.onActivated.addListener(onActivatedHandler);

        chrome.tabs.get(tabId).then(tab => {
          if (tab.active) {
            chrome.tabs.onActivated.removeListener(onActivatedHandler);
            logger.info(`[waitForTabEvents] Tab ${tabId} already active`);
            resolve();
          }
        });
      });
      promises.push(activatedPromise);
    }

    if (promises.length === 0) {
      logger.info(`[waitForTabEvents] No promises to wait for, returning immediately`);
      return;
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        logger.error(`[waitForTabEvents] TIMEOUT after ${timeoutMs}ms for tab ${tabId}`);
        reject(new Error(`Tab operation timed out after ${timeoutMs} ms`));
      }, timeoutMs),
    );

    await Promise.race([Promise.all(promises), timeoutPromise]);
    logger.info(`[waitForTabEvents] Completed for tab ${tabId}`);
  }

  public async switchTab(tabId: number): Promise<Page> {
    logger.info('switchTab', tabId);

    await chrome.tabs.update(tabId, { active: true });
    await this.waitForTabEvents(tabId, { waitForUpdate: false });

    const page = await this._getOrCreatePage(await chrome.tabs.get(tabId));
    await this.attachPage(page);
    this._currentTabId = tabId;
    return page;
  }

  public async navigateTo(url: string): Promise<void> {
    logger.info(`[navigateTo] Starting navigation to: ${url}`);
    
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`URL: ${url} is not allowed`);
    }

    const page = await this.getCurrentPage();
    if (!page) {
      logger.info(`[navigateTo] No current page, opening new tab`);
      await this.openTab(url);
      return;
    }

    logger.info(`[navigateTo] Current page tabId=${page.tabId}, attached=${page.attached}`);

    if (page.attached) {
      logger.info(`[navigateTo] Using Puppeteer navigation (page is attached)`);
      await page.navigateTo(url);
      return;
    }

    logger.info(`[navigateTo] Using chrome.tabs.update (page not attached)`);
    const tabId = page.tabId;
    await chrome.tabs.update(tabId, { url, active: true });
    await this.waitForTabEvents(tabId);

    const updatedPage = await this._getOrCreatePage(await chrome.tabs.get(tabId), true);
    await this.attachPage(updatedPage);
    this._currentTabId = tabId;
    logger.info(`[navigateTo] Navigation complete`);
  }

  public async openTab(url: string): Promise<Page> {
    logger.info(`[openTab] Opening new tab with url: ${url}`);
    
    if (!isUrlAllowed(url, this._config.allowedUrls, this._config.deniedUrls)) {
      throw new URLNotAllowedError(`Open tab failed. URL: ${url} is not allowed`);
    }

    const tab = await chrome.tabs.create({ url, active: true });
    if (!tab.id) {
      throw new Error('No tab ID available');
    }
    logger.info(`[openTab] Tab created with id=${tab.id}, waiting for load...`);
    await this.waitForTabEvents(tab.id);

    const updatedTab = await chrome.tabs.get(tab.id);
    logger.info(`[openTab] Tab loaded: url=${updatedTab.url}, status=${updatedTab.status}`);
    const page = await this._getOrCreatePage(updatedTab);
    await this.attachPage(page);
    this._currentTabId = tab.id;

    logger.info(`[openTab] Complete, tabId=${tab.id}`);
    return page;
  }

  public async closeTab(tabId: number): Promise<void> {
    await this.detachPage(tabId);
    await chrome.tabs.remove(tabId);
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public removeAttachedPage(tabId: number): void {
    this._attachedPages.delete(tabId);
    if (this._currentTabId === tabId) {
      this._currentTabId = null;
    }
  }

  public async getTabInfos(): Promise<TabInfo[]> {
    const tabs = await chrome.tabs.query({});
    const tabInfos: TabInfo[] = [];

    for (const tab of tabs) {
      if (tab.id && tab.url && tab.title) {
        tabInfos.push({
          id: tab.id,
          url: tab.url,
          title: tab.title,
        });
      }
    }
    return tabInfos;
  }

  public async getCachedState(useVision = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    let pageState = !currentPage ? buildInitialState() : currentPage.getCachedState();
    if (!pageState) {
      pageState = await currentPage.getState(useVision);
    }

    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
    };
    return browserState;
  }

  public async getState(useVision = false): Promise<BrowserState> {
    const currentPage = await this.getCurrentPage();

    const pageState = !currentPage
      ? buildInitialState()
      : await currentPage.getState(useVision);
    const tabInfos = await this.getTabInfos();
    const browserState: BrowserState = {
      ...pageState,
      tabs: tabInfos,
    };
    return browserState;
  }

  public async removeHighlight(): Promise<void> {
    const page = await this.getCurrentPage();
    if (page) {
      await page.removeHighlight();
    }
  }
}

