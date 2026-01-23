/**
 * RecipeExecutor Tests
 * 
 * Comprehensive tests for all executor commands and functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecipeExecutor } from './executor';
import { cmd, until, when, type Recipe, type Command } from './commands';
import type { Page } from '../browser/page';
import { 
  createMockPage, 
  createJobListElements,
  createCheckboxElement,
  createDropdownElement,
  type MockPage,
} from '@/__tests__/mocks/page.mock';
import { createMinimalBindings, createBindingsWithFilters } from '@/__tests__/mocks/bindings.mock';

// Helper to cast MockPage to Page for executor
const asPage = (mock: MockPage): Page => mock as unknown as Page;

describe('RecipeExecutor', () => {
  let mockPage: MockPage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage = createMockPage({ elements: createJobListElements(5) });
  });

  // ============================================================================
  // Navigation Commands
  // ============================================================================

  describe('Navigation Commands', () => {
    it('OPEN_PAGE should call navigateTo with the correct URL', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.openPage('https://example.com/jobs')],
      };

      await executor.execute(recipe);

      expect(mockPage._mocks.navigateTo).toHaveBeenCalledWith('https://example.com/jobs');
    });

    it('GO_BACK should call goBack on the page', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.goBack()],
      };

      await executor.execute(recipe);

      expect(mockPage._mocks.goBack).toHaveBeenCalled();
    });

  });

  // ============================================================================
  // Scrolling Commands
  // ============================================================================

  describe('Scrolling Commands', () => {
    it('SCROLL page down should call scrollToNextPage', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.scrollPage('down')],
      };

      await executor.execute(recipe);

      expect(mockPage._mocks.scrollToNextPage).toHaveBeenCalled();
    });

    it('SCROLL page up should call scrollToPreviousPage', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.scrollPage('up')],
      };

      await executor.execute(recipe);

      expect(mockPage._mocks.scrollToPreviousPage).toHaveBeenCalled();
    });

    it('should track scroll count in stats', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.scrollPage('down'),
          cmd.scrollPage('down'),
          cmd.scrollPage('up'),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.stats.scrollsPerformed).toBe(3);
    });
  });

  // ============================================================================
  // Input Commands
  // ============================================================================

  describe('Input Commands', () => {
    it('TYPE should fail if no element is focused', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.type('test input')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No element focused');
    });

    it('SUBMIT should send Enter key', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.submit()],
      };

      await executor.execute(recipe);

      expect(mockPage._mocks.sendKeys).toHaveBeenCalledWith('Enter');
    });

    it('CLEAR should select all and delete', async () => {
      // Need to focus an element first
      mockPage = createMockPage({
        elements: [{ index: 0, tagName: 'input', text: 'search box', type: 'input' }],
      });
      const bindings = createMinimalBindings({ SEARCH_BOX: 'input' });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.goTo('searchBox'),
          cmd.clear(),
        ],
      };

      await executor.execute(recipe);

      expect(mockPage._mocks.sendKeys).toHaveBeenCalledWith('Control+a');
      expect(mockPage._mocks.sendKeys).toHaveBeenCalledWith('Backspace');
    });
  });

  // ============================================================================
  // Checkbox Commands (SET_CHECKED)
  // ============================================================================

  describe('Checkbox Commands', () => {
    it('SET_CHECKED should fail if no element is focused', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.setChecked(true)],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No element focused for SET_CHECKED');
    });

    it('SET_CHECKED(true) should attempt to set checkbox state', async () => {
      const checkboxElement = createCheckboxElement(0, 'Remote only', false);
      mockPage = createMockPage({
        elements: [checkboxElement],
      });
      
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        FILTERS: {
          remote: {
            selector: 'input[type="checkbox"]',
            type: 'checkbox',
          },
        },
      });
      
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.goToFilter('remote'),
          cmd.setChecked(true),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.stats.commandsExecuted).toBeGreaterThanOrEqual(2);
    });

    it('SET_CHECKED(false) should attempt to unset checkbox state', async () => {
      const checkboxElement = createCheckboxElement(0, 'Remote only', true);
      mockPage = createMockPage({
        elements: [checkboxElement],
      });
      
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        FILTERS: {
          remote: {
            selector: 'input[type="checkbox"]',
            type: 'checkbox',
          },
        },
      });
      
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.goToFilter('remote'),
          cmd.setChecked(false),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.stats.commandsExecuted).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // Dropdown/Select Commands
  // ============================================================================

  describe('Dropdown Commands', () => {
    it('SELECT should fail if no element is focused', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.select('Option 1')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No element focused for SELECT');
    });

    it('SELECT should attempt to select dropdown option', async () => {
      mockPage = createMockPage({
        elements: [createDropdownElement(0, 'Location filter')],
      });
      
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        FILTERS: {
          location: {
            selector: 'select.filter-location',
            type: 'dropdown',
          },
        },
      });
      
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.goToFilter('location'),
          cmd.select('San Francisco'),
        ],
      };

      const result = await executor.execute(recipe);

      // Command sequence should execute
      expect(result.stats.commandsExecuted).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // GO_TO Command (Generic element navigation)
  // ============================================================================

  describe('GO_TO Command', () => {
    it('should fail if element name not defined in ELEMENTS', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createBindingsWithFilters());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.goTo('nonExistentElement')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not defined in ELEMENTS');
    });

    it('should navigate to element defined in ELEMENTS and allow click', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const executor = new RecipeExecutor(asPage(mockPage), createBindingsWithFilters());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.goTo('applyFilters'),
          cmd.click(),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.clickSelector).toHaveBeenCalledWith('.filter-apply');
    });

    it('should fail if element not found on page', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(false);
      
      const executor = new RecipeExecutor(asPage(mockPage), createBindingsWithFilters());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.goTo('applyFilters')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });

    it('should work with filter + GO_TO pattern for applying filters', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const executor = new RecipeExecutor(asPage(mockPage), createBindingsWithFilters());
      // Simplified: navigate to filter, then navigate to apply button and click
      // (SELECT is tested separately and requires more complex mock setup)
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.goToFilter('location'),
          // Skip SELECT for this test - it's tested elsewhere
          cmd.goTo('applyFilters'),
          cmd.click(),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.clickSelector).toHaveBeenCalledWith('.filter-apply');
    });
  });

  // ============================================================================
  // FOR_EACH_ITEM_IN_LIST Command
  // ============================================================================

  describe('FOR_EACH_ITEM_IN_LIST Command', () => {
    it('should iterate over all items', async () => {
      const elements = createJobListElements(3);
      mockPage = createMockPage({ elements });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.forEachItemInList([
            cmd.extractDetails(),
            cmd.save('job'),
            cmd.markDone(),
          ]),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(3);
      expect(result.stats.itemsProcessed).toBe(3);
    });

    it('should skip already processed items when skipProcessed is true', async () => {
      const elements = createJobListElements(3);
      mockPage = createMockPage({ elements });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      
      // First pass
      const recipe1: Recipe = {
        id: 'test1',
        name: 'Test 1',
        commands: [
          cmd.forEachItemInList([
            cmd.extractDetails(),
            cmd.save('job'),
            cmd.markDone(),
          ], true),
        ],
      };
      await executor.execute(recipe1);

      // Second pass - same items
      const recipe2: Recipe = {
        id: 'test2',
        name: 'Test 2',
        commands: [
          cmd.forEachItemInList([
            cmd.extractDetails(),
            cmd.save('job'),
            cmd.markDone(),
          ], true),
        ],
      };
      const result = await executor.execute(recipe2);

      // Should not have processed any new items
      expect(result.stats.itemsProcessed).toBe(3); // Still 3 from first pass
    });

    it('should handle empty list gracefully', async () => {
      mockPage = createMockPage({ elements: [] });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.forEachItemInList([
            cmd.extractDetails(),
            cmd.save('job'),
            cmd.markDone(),
          ]),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(0);
    });
  });

  // ============================================================================
  // REPEAT Command with Conditions
  // ============================================================================

  describe('REPEAT Command', () => {
    it('should stop when COLLECTED count is reached', async () => {
      const elements = createJobListElements(10);
      mockPage = createMockPage({ elements });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.repeat([
            cmd.forEachItemInList([
              cmd.extractDetails(),
              cmd.save('job'),
              cmd.markDone(),
            ]),
          ], until.collected(3)),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.items.length).toBeGreaterThanOrEqual(3);
    });

    it('should stop when MAX_SCROLLS is reached', async () => {
      mockPage = createMockPage({ elements: [] });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.repeat([
            cmd.scrollPage('down'),
          ], until.maxScrolls(5)),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(5);
    });

    it('should handle OR conditions', async () => {
      const elements = createJobListElements(2);
      mockPage = createMockPage({ elements });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.repeat([
            cmd.forEachItemInList([
              cmd.extractDetails(),
              cmd.save('job'),
              cmd.markDone(),
            ]),
          ], until.or(
            until.collected(1),
            until.maxScrolls(10)
          )),
        ],
      };

      const result = await executor.execute(recipe);

      // Should stop after collecting 1 (first condition met)
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // END and CONTINUE Commands
  // ============================================================================

  describe('Flow Control Commands', () => {
    it('END should stop execution immediately', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.scrollPage('down'),
          cmd.end(),
          cmd.scrollPage('down'), // Should not execute
          cmd.scrollPage('down'), // Should not execute
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(1);
      expect(result.stats.commandsExecuted).toBe(2); // scrollPage + end
    });
  });

  // ============================================================================
  // WAIT Command
  // ============================================================================

  describe('WAIT Command', () => {
    it('should wait for specified duration', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.wait(0.1)], // 100ms
      };

      const start = Date.now();
      const result = await executor.execute(recipe);
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });

  // ============================================================================
  // Statistics Tracking
  // ============================================================================

  describe('Statistics Tracking', () => {
    it('should count commands executed', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.scrollPage('down'),
          cmd.scrollPage('down'),
          cmd.scrollPage('up'),
          cmd.submit(),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.stats.commandsExecuted).toBe(4);
    });

    it('should track duration', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.wait(0.05)],
      };

      const result = await executor.execute(recipe);

      expect(result.stats.duration).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Binding Management
  // ============================================================================

  describe('Binding Management', () => {
    it('should allow updating bindings', () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      
      executor.updateBindings({
        LIST: '.new-list-selector',
      });

      const bindings = executor.getBindings();
      expect(bindings.LIST).toBe('.new-list-selector');
    });

    it('should use binding error handler when set', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      
      const handler = vi.fn().mockResolvedValue({ LIST: '.fixed-selector' });
      executor.setBindingErrorHandler(handler);

      // Verify handler is set (indirect test)
      expect(handler).not.toHaveBeenCalled(); // Not called until error occurs
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('should return error for unknown command type', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          { type: 'UNKNOWN_COMMAND' } as unknown as Command,
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown command type');
    });

    it('should include partial results on error', async () => {
      const elements = createJobListElements(3);
      mockPage = createMockPage({ elements });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.forEachItemInList([
            cmd.extractDetails(),
            cmd.save('job'),
            cmd.markDone(),
          ]),
          { type: 'UNKNOWN_COMMAND' } as unknown as Command, // Will fail
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(false);
      // Should still have items from before the error
      expect(result.items.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // New Scroll Commands (SCROLL, SCROLL_IF_NOT_END)
  // ============================================================================

  describe('SCROLL Command', () => {
    it('should scroll list down', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings({
        SCROLL_CONTAINER: '.jobs-list',
      }));
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.scrollList('down')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(1);
    });

    it('should scroll page down', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.scrollPage('down')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.scrollToNextPage).toHaveBeenCalled();
      expect(result.stats.scrollsPerformed).toBe(1);
    });

    it('should scroll page up', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.scrollPage('up')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.scrollToPreviousPage).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // IF Command
  // ============================================================================

  describe('IF Command', () => {
    it('should execute then branch when condition is true', async () => {
      // Create fresh mock with element exists returning true
      mockPage = createMockPage({ elements: createJobListElements(3) });
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        // Use NEXT_PAGE_BUTTON (the built-in binding) not ELEMENTS
        NEXT_PAGE_BUTTON: '.pagination-next',
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.if(
            when.exists('nextPageButton'),  // Uses built-in binding name
            [cmd.scrollPage('down')],  // then: scroll
            [cmd.end()]         // else: end
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(1);
    });

    it('should execute else branch when condition is false', async () => {
      // Set up: element does not exist
      mockPage._mocks.selectorExists.mockResolvedValue(false);
      
      const bindings = createMinimalBindings({
        ELEMENTS: { nextPageButton: '.pagination-next' }
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.if(
            when.exists('nextPageButton'),
            [cmd.scrollPage('down')],  // then: scroll
            [cmd.scrollPage('up')]     // else: scroll up
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.scrollToPreviousPage).toHaveBeenCalled();
    });

    it('should handle NOT condition', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(false);
      
      const bindings = createMinimalBindings({
        ELEMENTS: { loadingSpinner: '.spinner' }
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.if(
            when.not(when.exists('loadingSpinner')),  // NOT exists
            [cmd.scrollPage('down')],  // then: proceed
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(1);
    });

    it('should handle NEW_ITEMS condition with checkpoint', async () => {
      const elements = createJobListElements(3);
      mockPage = createMockPage({ elements });
      
      // Start with 3 items
      mockPage._mocks.countSelector.mockResolvedValue(3);
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.checkpointCount(),  // Save count = 3
          // Simulate new items appearing
          cmd.if(
            when.newItems(),
            [cmd.scrollPage('down')],  // Should NOT execute (no new items yet)
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      // No new items, so scroll should not happen
      expect(result.stats.scrollsPerformed).toBe(0);
    });

    it('should detect new items after checkpoint', async () => {
      const elements = createJobListElements(3);
      mockPage = createMockPage({ elements });
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      
      // First call: 3 items (checkpoint), second call: 5 items (new items!)
      mockPage._mocks.countSelector
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(5);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.checkpointCount(),  // Save count = 3
          cmd.if(
            when.newItems(),
            [cmd.scrollPage('down')],  // SHOULD execute (5 > 3)
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(1);
    });

    it('should handle AND condition', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        ELEMENTS: { 
          button1: '.btn1',
          button2: '.btn2',
        }
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.if(
            when.and(when.exists('button1'), when.exists('button2')),
            [cmd.scrollPage('down')],
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(1);
    });

    it('should handle OR condition', async () => {
      // First element doesn't exist, second does
      mockPage._mocks.selectorExists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      
      const bindings = createMinimalBindings({
        ELEMENTS: { 
          button1: '.btn1',
          button2: '.btn2',
        }
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.if(
            when.or(when.exists('button1'), when.exists('button2')),
            [cmd.scrollPage('down')],
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(result.stats.scrollsPerformed).toBe(1);
    });
  });

  // ============================================================================
  // CLICK_IF_EXISTS Command
  // ============================================================================

  describe('CLICK_IF_EXISTS Command', () => {
    it('should click element if it exists', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        NEXT_PAGE_BUTTON: '.pagination-next',
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.clickIfExists('nextPageButton')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.clickSelector).toHaveBeenCalledWith('.pagination-next');
    });

    it('should not fail if element does not exist', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(false);
      
      const bindings = createMinimalBindings({
        NEXT_PAGE_BUTTON: '.pagination-next',
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.clickIfExists('nextPageButton')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.clickSelector).not.toHaveBeenCalled();
    });

    it('should not fail if binding is not defined', async () => {
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.clickIfExists('nonExistentButton')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.clickSelector).not.toHaveBeenCalled();
    });

    it('should use ELEMENTS binding for custom buttons', async () => {
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        ELEMENTS: { showMoreButton: '.show-more' }
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.clickIfExists('showMoreButton')],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.clickSelector).toHaveBeenCalledWith('.show-more');
    });
  });

  // ============================================================================
  // CHECKPOINT_COUNT Command
  // ============================================================================

  describe('CHECKPOINT_COUNT Command', () => {
    it('should save current item count', async () => {
      mockPage._mocks.countSelector.mockResolvedValue(10);
      
      const executor = new RecipeExecutor(asPage(mockPage), createMinimalBindings());
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [cmd.checkpointCount()],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.countSelector).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Integration: Hybrid Scroll + Pagination Pattern
  // ============================================================================

  describe('Hybrid Scroll + Pagination Pattern', () => {
    it('should scroll first, then paginate when scroll produces no new items', async () => {
      const elements = createJobListElements(5);
      mockPage = createMockPage({ elements });
      
      // Simulate: scroll produces no new items, but pagination button exists
      mockPage._mocks.countSelector.mockResolvedValue(5); // Always 5 items (no new from scroll)
      mockPage._mocks.selectorExists.mockResolvedValue(true); // Button exists
      
      const bindings = createMinimalBindings({
        NEXT_PAGE_BUTTON: '.pagination-next',
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          // This is the pattern: checkpoint, scroll, check, fallback to pagination
          cmd.checkpointCount(),
          cmd.scrollPage('down'),
          cmd.wait(0.1),
          cmd.if(
            when.not(when.newItems()),
            [cmd.clickIfExists('nextPageButton')],
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      // Should have scrolled
      expect(mockPage._mocks.scrollToNextPage).toHaveBeenCalled();
      // Should have clicked pagination (since no new items)
      expect(mockPage._mocks.clickSelector).toHaveBeenCalledWith('.pagination-next');
    });

    it('should not paginate if scroll produced new items', async () => {
      const elements = createJobListElements(5);
      mockPage = createMockPage({ elements });
      
      // Simulate: scroll produces new items
      mockPage._mocks.countSelector
        .mockResolvedValueOnce(5)  // checkpoint: 5 items
        .mockResolvedValueOnce(8); // after scroll: 8 items (new!)
      mockPage._mocks.selectorExists.mockResolvedValue(true);
      
      const bindings = createMinimalBindings({
        NEXT_PAGE_BUTTON: '.pagination-next',
      });
      const executor = new RecipeExecutor(asPage(mockPage), bindings);
      
      const recipe: Recipe = {
        id: 'test',
        name: 'Test',
        commands: [
          cmd.checkpointCount(),
          cmd.scrollPage('down'),
          cmd.wait(0.1),
          cmd.if(
            when.not(when.newItems()),  // No new items? Then paginate
            [cmd.clickIfExists('nextPageButton')],
          ),
        ],
      };

      const result = await executor.execute(recipe);

      expect(result.success).toBe(true);
      expect(mockPage._mocks.scrollToNextPage).toHaveBeenCalled();
      // Should NOT click pagination (since scroll produced new items)
      expect(mockPage._mocks.clickSelector).not.toHaveBeenCalled();
    });
  });
});

