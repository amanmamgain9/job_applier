import type { DiscoveryEvent, DiscoveryEventInput } from './memory/types';
import type { DiscoveryDecision, DiscoveryActionResult } from './memory/types';
import type { DiscoveryAnalyzerResult, PageChangeResult } from './analyzer-agent';
import type { DiscoverySummarizerResult } from './summarizer-agent';
import type { HandoffOutput } from './types/handoff';

export class DiscoverEventLog {
  private currentPageKey: string | null = null;
  private events: DiscoveryEvent[] = [];
  private snapshotByPageKey: Record<string, { url: string; screenshot: string }> = {};

  getCurrentPageKey(): string | null {
    return this.currentPageKey;
  }

  getEvents(): DiscoveryEvent[] {
    return [...this.events];
  }

  getEventsForPage(pageKey: string): DiscoveryEvent[] {
    return this.events.filter((event) => event.pageKey === pageKey);
  }

  getSnapshots(): Array<{ pageKey: string; lastUrl: string; screenshot: string }> {
    return Object.entries(this.snapshotByPageKey).map(([pageKey, snap]) => ({
      pageKey,
      lastUrl: snap.url,
      screenshot: snap.screenshot,
    }));
  }

  getPageKeys(): string[] {
    const keys = new Set<string>();
    for (const event of this.events) {
      keys.add(event.pageKey);
    }
    if (this.currentPageKey) {
      keys.add(this.currentPageKey);
    }
    return [...keys];
  }

  setCurrent(pageKey: string): void {
    this.currentPageKey = pageKey;
  }

  addDecisionEvent(output: HandoffOutput<DiscoveryDecision>): void {
    this.addEvent({ kind: 'decision', output });
  }

  addActionEvent(output: HandoffOutput<DiscoveryActionResult>): void {
    this.addEvent({ kind: 'action', output });
  }

  addAnalyzerEvent(
    output: HandoffOutput<DiscoveryAnalyzerResult>,
    meta: Extract<DiscoveryEventInput, { kind: 'analyzer' }>['meta']
  ): void {
    this.addEvent({ kind: 'analyzer', output, meta });
  }

  addPageChangeEvent(
    output: HandoffOutput<PageChangeResult>,
    meta: Extract<DiscoveryEventInput, { kind: 'page_change' }>['meta']
  ): void {
    this.addEvent({ kind: 'page_change', output, meta });
  }

  addSummarizerEvent(output: HandoffOutput<DiscoverySummarizerResult>): void {
    this.addEvent({ kind: 'summarizer', output });
  }

  setSnapshot(pageKey: string, url: string, screenshot: string | null): void {
    if (!screenshot) return;
    this.snapshotByPageKey[pageKey] = { url, screenshot };
  }

  private addEvent(event: DiscoveryEventInput): void {
    if (!this.currentPageKey) return;
    this.events.push({
      ...event,
      pageKey: this.currentPageKey,
      timestamp: Date.now(),
    });
  }

  buildSummary(): string {
    const pageKeys = this.getPageKeys();
    if (pageKeys.length === 0) {
      return JSON.stringify({ pageKeyCount: 0, eventCount: 0, currentPageKey: null });
    }

    const pages = pageKeys.map((pageKey) => {
      const events = this.getEventsForPage(pageKey);
      const lastEvent = [...events].reverse()[0];
      const lastAction = [...events].reverse().find((event) => event.kind === 'action');
      const lastAnalyzer = [...events].reverse().find((event) => event.kind === 'analyzer');
      const lastPageChange = [...events].reverse().find((event) => event.kind === 'page_change');
      const lastDecision = [...events].reverse().find((event) => event.kind === 'decision');

      return {
        pageKey,
        eventCount: events.length,
        lastEventKind: lastEvent?.kind ?? null,
        lastDecision: lastDecision ? truncate(JSON.stringify(lastDecision.output)) : null,
        lastAction: lastAction ? truncate(JSON.stringify(lastAction.output)) : null,
        lastAnalyzerSummary: lastAnalyzer ? truncate(lastAnalyzer.output.result?.summary || '') : null,
        lastPageChangeSummary: lastPageChange ? truncate(lastPageChange.output.result?.analysis.summary || '') : null,
      };
    });

    return JSON.stringify({
      pageKeyCount: pageKeys.length,
      eventCount: this.events.length,
      currentPageKey: this.currentPageKey,
      pages,
    });
  }
}

function truncate(value: string, max = 200): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

