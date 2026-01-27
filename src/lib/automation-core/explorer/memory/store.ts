/**
 * MemoryStore - Graph-based memory for page exploration
 * 
 * Stores page nodes and edges, tracks navigation path,
 * and holds behavioral patterns (consolidated by ConsolidatorAgent).
 * 
 * Pattern consolidation is now done by the LLM (ConsolidatorAgent),
 * not by brittle code-based rules.
 */

import { PageNode, Edge, ClassifierResult, BehaviorPattern } from './types';

export class MemoryStore {
  private pages: Map<string, PageNode> = new Map();
  private currentPageId: string | null = null;
  private previousPageId: string | null = null;
  private navigationPath: string[] = [];
  
  // Track when consolidation last ran
  private lastConsolidationAt: number = 0;
  
  // Pending observations not yet consolidated
  private pendingObservations: Array<{
    action: string;
    selector?: string;
    elementType: string;
    effect: string;
    changeType: string;
    timestamp: number;
  }> = [];

  /**
   * Update memory from classifier result
   */
  updateFromClassification(result: ClassifierResult, previousUrl: string | null): void {
    const { pageId, isNewPage, understanding, cameFrom, viaAction } = result;

    if (isNewPage || !this.pages.has(pageId)) {
      // Create new page node
      const node: PageNode = {
        id: pageId,
        understanding,
        rawObservations: [],
        patterns: [],
        incomingEdges: [],
        outgoingEdges: [],
        visitCount: 1,
        lastVisitedAt: Date.now(),
        lastUrl: previousUrl || '',
      };

      // Add edge from previous page
      if (cameFrom && this.pages.has(cameFrom)) {
        const edge: Edge = {
          fromPageId: cameFrom,
          toPageId: pageId,
          action: viaAction || 'navigated',
        };
        node.incomingEdges.push(edge);
        
        // Add outgoing edge to source page
        const sourcePage = this.pages.get(cameFrom);
        if (sourcePage) {
          sourcePage.outgoingEdges.push(edge);
        }
      }

      this.pages.set(pageId, node);
    } else {
      // Update existing page
      const existing = this.pages.get(pageId)!;
      existing.visitCount++;
      existing.lastVisitedAt = Date.now();
      // Enrich understanding if new info
      if (understanding && !existing.understanding.includes(understanding)) {
        existing.rawObservations.push(understanding);
      }
    }

    this.previousPageId = this.currentPageId;
    this.currentPageId = pageId;
    
    // Update navigation path
    if (!this.navigationPath.includes(pageId)) {
      this.navigationPath.push(pageId);
    }
  }

  /**
   * Add a raw observation (before consolidation).
   * The ConsolidatorAgent will later process these into patterns.
   */
  addRawObservation(data: {
    action: string;
    selector?: string;
    elementType: string;
    effect: string;
    changeType: string;
  }): void {
    if (!this.currentPageId) return;
    
    const page = this.pages.get(this.currentPageId);
    if (!page) return;
    
    // Build description for raw observations
    const rawDesc = data.selector 
      ? `${data.action} "${data.selector}" (${data.elementType}) → ${data.effect} [${data.changeType}]`
      : `${data.action} (${data.elementType}) → ${data.effect} [${data.changeType}]`;
    page.rawObservations.push(rawDesc);
    
    // Add to pending observations for consolidation
    this.pendingObservations.push({
      ...data,
      timestamp: Date.now(),
    });
  }

  /**
   * Replace patterns with consolidated patterns from ConsolidatorAgent.
   */
  updatePatternsFromConsolidation(patterns: BehaviorPattern[]): void {
    if (!this.currentPageId) return;
    
    const page = this.pages.get(this.currentPageId);
    if (!page) return;
    
    // Merge with existing patterns, preserving firstSeen timestamps
    const existingById = new Map(page.patterns.map(p => [p.id, p]));
    
    page.patterns = patterns.map(newPattern => {
      const existing = existingById.get(newPattern.id);
      if (existing) {
        // Preserve firstSeen, update everything else
        return {
          ...newPattern,
          firstSeen: existing.firstSeen,
        };
      }
      return newPattern;
    });
    
    // Clear pending observations after consolidation
    this.pendingObservations = [];
    this.lastConsolidationAt = Date.now();
  }

  /**
   * Get data needed for consolidation.
   */
  getConsolidationInput(): {
    rawObservations: string[];
    existingPatterns: BehaviorPattern[];
    pendingObservations: Array<{
      action: string;
      selector?: string;
      elementType: string;
      effect: string;
      changeType: string;
      timestamp: number;
    }>;
  } {
    if (!this.currentPageId) {
      return { rawObservations: [], existingPatterns: [], pendingObservations: [] };
    }
    
    const page = this.pages.get(this.currentPageId);
    if (!page) {
      return { rawObservations: [], existingPatterns: [], pendingObservations: [] };
    }
    
    return {
      rawObservations: page.rawObservations,
      existingPatterns: page.patterns,
      pendingObservations: this.pendingObservations,
    };
  }

  /**
   * Check if consolidation should run.
   */
  shouldConsolidate(): boolean {
    // Run if we have pending observations
    if (this.pendingObservations.length === 0) {
      return false;
    }
    
    // Run after every 3 observations
    if (this.pendingObservations.length >= 3) {
      return true;
    }
    
    // Run if 30+ seconds since last consolidation
    const timeSinceLastConsolidation = Date.now() - this.lastConsolidationAt;
    if (timeSinceLastConsolidation > 30000) {
      return true;
    }
    
    return false;
  }

  /**
   * Get count of pending observations (not yet consolidated).
   */
  getPendingObservationCount(): number {
    return this.pendingObservations.length;
  }

  /**
   * Add simple string observation (for warnings, notes, etc.)
   * Does NOT go through consolidation.
   */
  enrichCurrentPage(observation: string): void {
    if (!this.currentPageId) return;
    
    const page = this.pages.get(this.currentPageId);
    if (!page || !observation) return;
    
    page.rawObservations.push(observation);
  }
  
  /**
   * Check if a pattern is already confirmed (explored enough).
   * Uses element type matching, not selector matching.
   */
  isPatternConfirmed(action: string, elementType?: string): boolean {
    const pattern = this.getMatchingPattern(action, elementType);
    return pattern?.confirmed ?? false;
  }
  
  /**
   * Get a confirmed pattern for this action + element type, if any.
   * Used to warn the LLM when they're repeating a known behavior.
   */
  getMatchingPattern(action: string, elementType?: string): BehaviorPattern | null {
    if (!this.currentPageId) return null;
    const page = this.pages.get(this.currentPageId);
    if (!page) return null;
    
    // Find confirmed pattern for this action type
    for (const pattern of page.patterns) {
      if (pattern.action === action && pattern.confirmed) {
        // If elementType provided, match it
        if (elementType) {
          const patternType = pattern.targetDescription.toLowerCase();
          const searchType = elementType.toLowerCase();
          if (patternType.includes(searchType) || searchType.includes(patternType)) {
            return pattern;
          }
        } else {
          // No elementType filter - return first confirmed pattern for this action
          return pattern;
        }
      }
    }
    return null;
  }
  
  /**
   * Get count of confirmed patterns for current page
   */
  getConfirmedPatternCount(): number {
    if (!this.currentPageId) return 0;
    const page = this.pages.get(this.currentPageId);
    if (!page) return 0;
    return page.patterns.filter(p => p.confirmed).length;
  }

  /**
   * Get all pattern descriptions for final summary
   */
  getAllPatternDescriptions(): string[] {
    if (!this.currentPageId) return [];
    const page = this.pages.get(this.currentPageId);
    if (!page) return [];
    
    return page.patterns.map(p => {
      const status = p.confirmed ? 'confirmed' : 'observed';
      return `${p.action} ${p.targetDescription} → ${p.effect} (${status}, ${p.count}x)`;
    });
  }

  /**
   * Get discovered selectors organized by element type.
   * Extracts selectors from confirmed patterns, matching them to standard categories.
   */
  getDiscoveredSelectors(): {
    filter_button?: string;
    apply_button?: string;
    job_listings?: string[];
    search_input?: string;
    pagination?: string;
    close_button?: string;
    [key: string]: string | string[] | undefined;
  } {
    const result: {
      filter_button?: string;
      apply_button?: string;
      job_listings?: string[];
      search_input?: string;
      pagination?: string;
      close_button?: string;
      [key: string]: string | string[] | undefined;
    } = {};
    
    if (!this.currentPageId) return result;
    const page = this.pages.get(this.currentPageId);
    if (!page) return result;
    
    // Map element types to standard categories
    const typeMapping: Record<string, string> = {
      'filter button': 'filter_button',
      'filter dropdown': 'filter_button',
      'apply button': 'apply_button',
      'job listing': 'job_listings',
      'search input': 'search_input',
      'pagination control': 'pagination',
      'close button': 'close_button',
      'dropdown button': 'filter_button',
    };
    
    for (const pattern of page.patterns) {
      if (pattern.selectors.length === 0) continue;
      
      const targetLower = pattern.targetDescription.toLowerCase();
      let category: string | undefined;
      
      // Try exact mapping first
      for (const [type, cat] of Object.entries(typeMapping)) {
        if (targetLower.includes(type)) {
          category = cat;
          break;
        }
      }
      
      if (!category) continue;
      
      // For job_listings, collect multiple selectors
      if (category === 'job_listings') {
        if (!result.job_listings) {
          result.job_listings = [];
        }
        for (const sel of pattern.selectors) {
          if (!result.job_listings.includes(sel)) {
            result.job_listings.push(sel);
          }
        }
      } else {
        // For single-selector categories, use first confirmed selector
        if (!result[category]) {
          result[category] = pattern.selectors[0];
        }
      }
    }
    
    return result;
  }

  /**
   * Update page summary (from summarizer)
   */
  updatePageSummary(pageId: string, summary: string): void {
    const page = this.pages.get(pageId);
    if (page) {
      page.understanding = summary;
      page.rawObservations = []; // Clear raw observations after summarization
    }
  }

  /**
   * Get all page IDs
   */
  getPageIds(): string[] {
    return Array.from(this.pages.keys());
  }

  /**
   * Get current page ID
   */
  getCurrentPageId(): string | null {
    return this.currentPageId;
  }

  /**
   * Get previous page ID
   */
  getPreviousPageId(): string | null {
    return this.previousPageId;
  }

  /**
   * Get page node
   */
  getPage(pageId: string): PageNode | undefined {
    return this.pages.get(pageId);
  }

  /**
   * Get raw observations for a page
   */
  getObservations(pageId: string): string[] {
    return this.pages.get(pageId)?.rawObservations || [];
  }

  /**
   * Get all pages
   */
  getAllPages(): Map<string, PageNode> {
    return new Map(this.pages);
  }

  /**
   * Get navigation path
   */
  getNavigationPath(): string[] {
    return [...this.navigationPath];
  }

  /**
   * Serialize memory for LLM context
   */
  getSummary(): string {
    if (this.pages.size === 0) {
      return 'No pages explored yet.';
    }

    let summary = 'EXPLORED PAGES:\n';
    
    for (const [id, page] of this.pages) {
      summary += `\n[${id}]: ${page.understanding}\n`;
      
      // Show consolidated patterns (not repetitive observations)
      if (page.patterns.length > 0) {
        summary += `  LEARNED BEHAVIORS:\n`;
        for (const pattern of page.patterns) {
          const status = pattern.confirmed ? '✓ CONFIRMED' : '? testing';
          const examples = pattern.selectors.length > 0 
            ? ` (e.g., ${pattern.selectors.slice(0, 2).join(', ')})` 
            : '';
          summary += `    [${status}] ${pattern.action} ${pattern.targetDescription}${examples} → ${pattern.effect} (${pattern.count}x)\n`;
        }
        
        // Show unexplored areas (things NOT clicked yet)
        const confirmedCategories = new Set(
          page.patterns.filter(p => p.confirmed).map(p => p.targetDescription)
        );
        if (confirmedCategories.size > 0) {
          summary += `  ALREADY EXPLORED: ${Array.from(confirmedCategories).join(', ')}\n`;
          summary += `  TIP: Try different element types or call done() if you understand the page.\n`;
        }
      }
      
      // Show navigation edges
      for (const edge of page.incomingEdges) {
        summary += `  ← from [${edge.fromPageId}] via "${edge.action}"\n`;
      }
      for (const edge of page.outgoingEdges) {
        summary += `  → leads to [${edge.toPageId}] via "${edge.action}"\n`;
      }
    }

    summary += `CURRENT PAGE: [${this.currentPageId || 'unknown'}]\n`;
    summary += `PATH: ${this.navigationPath.join(' → ')}\n`;

    return summary;
  }

  /**
   * Get final understanding for all pages
   */
  getFinalUnderstanding(): string {
    let result = 'SITE UNDERSTANDING:\n\n';
    
    for (const [id, page] of this.pages) {
      result += `## ${id}\n`;
      result += `${page.understanding}\n`;
      
      if (page.outgoingEdges.length > 0) {
        result += 'Navigation:\n';
        for (const edge of page.outgoingEdges) {
          result += `  - "${edge.action}" → ${edge.toPageId}\n`;
        }
      }
      result += '\n';
    }

    return result;
  }
}
