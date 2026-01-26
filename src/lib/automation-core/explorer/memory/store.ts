/**
 * MemoryStore - Graph-based memory for page exploration
 * 
 * Stores page nodes and edges, tracks navigation path,
 * consolidates behavioral patterns, and serializes for LLM context.
 */

import { PageNode, Edge, ClassifierResult, BehaviorPattern } from './types';

/**
 * Normalize an effect description for comparison.
 * Strip variable parts (job titles, company names) to find the pattern.
 * E.g., "job details panel updated to show 'SDE III'" → "job details panel updated"
 */
function normalizeEffect(effect: string): string {
  return effect
    // Remove quoted content (job titles, company names)
    .replace(/"[^"]+"/g, '')
    .replace(/'[^']+'/g, '')
    // Remove specific job/company mentions
    .replace(/for\s+\S+/g, '')
    .replace(/at\s+\S+/g, '')
    .replace(/to\s+show\s+\S+/g, '')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export class MemoryStore {
  private pages: Map<string, PageNode> = new Map();
  private currentPageId: string | null = null;
  private previousPageId: string | null = null;
  private navigationPath: string[] = [];

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
   * Check if two normalized effect descriptions are similar enough to be the same pattern.
   */
  private effectsSimilar(effect1: string, effect2: string): boolean {
    // Exact match
    if (effect1 === effect2) return true;
    
    // One contains the other
    if (effect1.includes(effect2) || effect2.includes(effect1)) return true;
    
    // Check for common key phrases that indicate same behavior
    const keyPhrases = [
      'details panel updated',
      'details pane updated',
      'job details',
      'modal opened',
      'modal closed',
      'filter applied',
      'content loaded',
      'navigated',
    ];
    
    for (const phrase of keyPhrases) {
      if (effect1.includes(phrase) && effect2.includes(phrase)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Add a pattern observation using LLM-classified element type.
   * This is the primary method for recording behavioral patterns.
   */
  addPatternObservation(data: {
    action: string;
    selector?: string;
    elementType: string;  // LLM-classified
    effect: string;
    changeType: string;
  }): void {
    if (!this.currentPageId) return;
    
    const page = this.pages.get(this.currentPageId);
    if (!page) return;
    
    // Build description for raw observations
    const rawDesc = data.selector 
      ? `${data.action} "${data.selector}" → ${data.effect} [${data.changeType}]`
      : `${data.action} → ${data.effect} [${data.changeType}]`;
    page.rawObservations.push(rawDesc);
    
    // Find matching pattern by action + changeType + normalized effect
    const normalizedEffect = normalizeEffect(data.effect);
    
    const existingPattern = page.patterns.find(p => 
      p.action === data.action &&
      p.changeType === data.changeType &&
      this.effectsSimilar(normalizeEffect(p.effect), normalizedEffect)
    );
    
    if (existingPattern) {
      existingPattern.count++;
      existingPattern.confirmed = existingPattern.count >= 2;
      
      if (data.selector && existingPattern.selectors.length < 3 && 
          !existingPattern.selectors.includes(data.selector)) {
        existingPattern.selectors.push(data.selector);
      }
    } else {
      const newPattern: BehaviorPattern = {
        id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        action: data.action,
        targetDescription: data.elementType,  // Directly use LLM classification
        effect: data.effect,
        changeType: data.changeType,
        selectors: data.selector ? [data.selector] : [],
        count: 1,
        confirmed: false,
        firstSeen: Date.now(),
      };
      page.patterns.push(newPattern);
    }
  }

  /**
   * Add simple string observation (for warnings, notes, etc.)
   * Does NOT consolidate into patterns - use addPatternObservation for that.
   */
  enrichCurrentPage(observation: string): void {
    if (!this.currentPageId) return;
    
    const page = this.pages.get(this.currentPageId);
    if (!page || !observation) return;
    
    page.rawObservations.push(observation);
  }
  
  /**
   * Check if a pattern is already confirmed (explored enough)
   */
  isPatternConfirmed(action: string, _selector?: string): boolean {
    return this.getMatchingPatternByAction(action)?.confirmed ?? false;
  }
  
  /**
   * Get a confirmed pattern for this action type, if any.
   * Used to warn the LLM when they're repeating a known behavior.
   */
  getMatchingPattern(action: string, _selector?: string): BehaviorPattern | null {
    return this.getMatchingPatternByAction(action);
  }
  
  /**
   * Get any confirmed pattern for this action type on the current page.
   */
  private getMatchingPatternByAction(action: string): BehaviorPattern | null {
    if (!this.currentPageId) return null;
    const page = this.pages.get(this.currentPageId);
    if (!page) return null;
    
    // Find any confirmed pattern for this action type
    for (const pattern of page.patterns) {
      if (pattern.action === action && pattern.confirmed) {
        return pattern;
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

