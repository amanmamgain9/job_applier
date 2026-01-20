/**
 * Mock Page - Simulates browser page for testing executor commands
 */

import { vi, type Mock } from 'vitest';
import type { Page } from '@/lib/automation-core/browser/page';
import { DOMElementNode } from '@/lib/automation-core/browser/dom/views';

export interface MockPageOptions {
  url?: string;
  title?: string;
  /** Simulated elements on the page */
  elements?: MockElement[];
  /** Simulated checkbox states */
  checkboxStates?: Map<number, boolean>;
  /** Simulated dropdown options */
  dropdownOptions?: Map<number, { value: string; text: string }[]>;
}

export interface MockElement {
  index: number;
  tagName: string;
  text: string;
  href?: string;
  dataId?: string;
  type?: 'checkbox' | 'dropdown' | 'input' | 'button';
  checked?: boolean;
  value?: string;
}

export interface MockPageMocks {
  navigateTo: Mock;
  goBack: Mock;
  scrollToNextPage: Mock;
  scrollToPreviousPage: Mock;
  scrollToPercent: Mock;
  sendKeys: Mock;
  clickElementNode: Mock;
  clickSelector: Mock;
  inputTextElementNode: Mock;
  selectDropdownOption: Mock;
  selectorExists: Mock;
  countSelector: Mock;
  getTextFromSelector: Mock;
  querySelectorAll: Mock;
  evaluateOnElement: Mock;
}

export interface MockPageState {
  elements: MockElement[];
  checkboxStates: Map<number, boolean>;
  currentUrl: string;
}

// MockPage is a partial implementation of Page with test utilities
export type MockPage = {
  _mocks: MockPageMocks;
  _state: MockPageState;
} & Record<string, unknown>;

export function createMockPage(options: MockPageOptions = {}): MockPage {
  const {
    url = 'https://www.linkedin.com/jobs/search/',
    title = 'Jobs | LinkedIn',
    elements = [],
    checkboxStates = new Map(),
  } = options;

  const state = {
    elements,
    checkboxStates,
    currentUrl: url,
  };

  // Create mock element tree
  const mockElementTree = new DOMElementNode({
    tagName: 'body',
    isVisible: true,
    parent: null,
    xpath: '/body',
    attributes: {},
    children: [],
  });

  mockElementTree.clickableElementsToString = vi.fn().mockReturnValue(
    elements.map((el) => 
      `[${el.index}]<${el.tagName} data-id="${el.dataId || ''}">${el.text}</${el.tagName}>`
    ).join('\n')
  );

  const mockSelectorMap = new Map<number, DOMElementNode>();
  elements.forEach((el) => {
    const node = new DOMElementNode({
      tagName: el.tagName,
      isVisible: true,
      parent: null,
      xpath: `//${el.tagName}[${el.index}]`,
      attributes: { 'data-id': el.dataId || '' },
      children: [],
      highlightIndex: el.index,
    });
    mockSelectorMap.set(el.index, node);
  });

  const mocks = {
    navigateTo: vi.fn().mockImplementation(async (newUrl: string) => {
      state.currentUrl = newUrl;
    }),
    goBack: vi.fn().mockResolvedValue(undefined),
    scrollToNextPage: vi.fn().mockResolvedValue(undefined),
    scrollToPreviousPage: vi.fn().mockResolvedValue(undefined),
    scrollToPercent: vi.fn().mockResolvedValue(undefined),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    clickElementNode: vi.fn().mockResolvedValue(undefined),
    clickSelector: vi.fn().mockResolvedValue(true),
    inputTextElementNode: vi.fn().mockResolvedValue(undefined),
    selectDropdownOption: vi.fn().mockResolvedValue('Selected option'),
    selectorExists: vi.fn().mockImplementation(async (selector: string) => {
      // Check if any element matches the selector pattern
      return elements.some(el => 
        selector.includes(el.tagName) || 
        selector.includes(el.dataId || '') ||
        selector === 'body'
      );
    }),
    countSelector: vi.fn().mockImplementation(async (selector: string) => {
      return elements.filter(el => 
        selector.includes(el.tagName) || selector.includes(el.dataId || '')
      ).length;
    }),
    getTextFromSelector: vi.fn().mockImplementation(async () => {
      return elements.map(el => el.text);
    }),
    querySelectorAll: vi.fn().mockImplementation(async (selector: string) => {
      return elements.filter(el => 
        selector.includes(el.tagName) || selector.includes(el.dataId || '')
      ).map(el => ({
        index: el.index,
        tagName: el.tagName,
        text: el.text,
        href: el.href,
        dataId: el.dataId,
      }));
    }),
    evaluateOnElement: vi.fn().mockImplementation(async (index: number, _fn: unknown) => {
      // Return checkbox state if it's a checkbox
      const el = elements.find(e => e.index === index);
      if (el?.type === 'checkbox') {
        return state.checkboxStates.get(index) ?? el.checked ?? false;
      }
      return null;
    }),
  };

  const mockPage = {
    url: vi.fn().mockImplementation(() => state.currentUrl),
    title: vi.fn().mockResolvedValue(title),
    attached: true,
    tabId: 1,
    validWebPage: true,

    // Navigation
    navigateTo: mocks.navigateTo,
    goBack: mocks.goBack,

    // State
    getState: vi.fn().mockResolvedValue({
      elementTree: mockElementTree,
      selectorMap: mockSelectorMap,
      url: state.currentUrl,
      title,
      screenshot: null,
      scrollY: 0,
      scrollHeight: 2000,
      visualViewportHeight: 800,
    }),
    getCachedState: vi.fn().mockReturnValue(null),

    // Scrolling
    scrollToPercent: mocks.scrollToPercent,
    scrollToNextPage: mocks.scrollToNextPage,
    scrollToPreviousPage: mocks.scrollToPreviousPage,

    // Keyboard
    sendKeys: mocks.sendKeys,

    // Element operations
    getSelectorMap: vi.fn().mockReturnValue(mockSelectorMap),
    getDomElementByIndex: vi.fn().mockImplementation((index: number) => {
      return mockSelectorMap.get(index) || null;
    }),
    getElementByIndex: vi.fn().mockImplementation(async (index: number) => {
      return mockSelectorMap.has(index) ? {} : null;
    }),
    locateElement: vi.fn().mockResolvedValue({}),
    clickElementNode: mocks.clickElementNode,
    inputTextElementNode: mocks.inputTextElementNode,
    isFileUploader: vi.fn().mockReturnValue(false),

    // Selector operations
    selectorExists: mocks.selectorExists,
    countSelector: mocks.countSelector,
    getTextFromSelector: mocks.getTextFromSelector,
    clickSelector: mocks.clickSelector,
    querySelectorAll: mocks.querySelectorAll,
    evaluateOnElement: mocks.evaluateOnElement,

    // Dropdown
    getDropdownOptions: vi.fn().mockResolvedValue([]),
    selectDropdownOption: mocks.selectDropdownOption,

    // Other
    attachPuppeteer: vi.fn().mockResolvedValue(true),
    detachPuppeteer: vi.fn().mockResolvedValue(undefined),
    removeHighlight: vi.fn().mockResolvedValue(undefined),
    getClickableElements: vi.fn().mockResolvedValue(null),
    getScrollInfo: vi.fn().mockResolvedValue([0, 800, 2000]),
    getContent: vi.fn().mockResolvedValue('<html></html>'),
    takeScreenshot: vi.fn().mockResolvedValue(null),
    waitForPageAndFramesLoad: vi.fn().mockResolvedValue(undefined),

    // Expose for assertions
    _mocks: mocks,
    _state: state,
  } as MockPage;

  return mockPage;
}

/**
 * Create mock elements representing job listings
 */
export function createJobListElements(count: number): MockElement[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    tagName: 'li',
    text: `Job Title ${i + 1}\nCompany ${i + 1}\nLocation ${i + 1}`,
    href: `https://linkedin.com/jobs/view/${100000 + i}`,
    dataId: `${100000 + i}`,
  }));
}

/**
 * Create a checkbox element
 */
export function createCheckboxElement(index: number, label: string, checked = false): MockElement {
  return {
    index,
    tagName: 'input',
    text: label,
    type: 'checkbox',
    checked,
  };
}

/**
 * Create a dropdown element
 */
export function createDropdownElement(index: number, label: string): MockElement {
  return {
    index,
    tagName: 'select',
    text: label,
    type: 'dropdown',
  };
}

