import type { DiscoveryEvent, DiscoveryEventInput, LlmCallAgent, LlmCallMeta } from './memory/types';
import type { DiscoveryDecision, DiscoveryActionResult } from './memory/types';
import type { DiscoveryAnalyzerResult, PageChangeResult } from './analyzer-agent';
import type { DiscoverySummarizerResult } from './summarizer-agent';
import type { HandoffOutput } from './types/handoff';

export class DiscoverEventLog {
  private currentPageKey: string | null = null;
  private events: DiscoveryEvent[] = [];
  private snapshotByPageKey: Record<
    string,
    { url: string; screenshot: string; snapshotId: string }
  > = {};
  private snapshotCounter = 0;

  getCurrentPageKey(): string | null {
    return this.currentPageKey;
  }

  getEvents(): DiscoveryEvent[] {
    return [...this.events];
  }

  getEventsForPage(pageKey: string): DiscoveryEvent[] {
    return this.events.filter((event) => event.pageKey === pageKey);
  }

  getSnapshots(): Array<{ pageKey: string; lastUrl: string; screenshot: string; snapshotId: string }> {
    return Object.entries(this.snapshotByPageKey).map(([pageKey, snap]) => ({
      pageKey,
      lastUrl: snap.url,
      screenshot: snap.screenshot,
      snapshotId: snap.snapshotId,
    }));
  }

  getLlmCallEvents(filter?: {
    agent?: LlmCallAgent;
    pageKey?: string;
    goalIncludes?: string;
  }): Array<Extract<DiscoveryEvent, { kind: 'llm_call' }>> {
    let events = this.events.filter(
      (event): event is Extract<DiscoveryEvent, { kind: 'llm_call' }> => event.kind === 'llm_call'
    );
    if (filter?.agent) {
      events = events.filter((event) => event.meta.agent === filter.agent);
    }
    if (filter?.pageKey) {
      events = events.filter((event) => event.pageKey === filter.pageKey);
    }
    if (filter?.goalIncludes) {
      const needle = filter.goalIncludes.toLowerCase();
      events = events.filter((event) => event.meta.goal.toLowerCase().includes(needle));
    }
    return events;
  }

  formatLlmCallEvents(filter?: {
    agent?: LlmCallAgent;
    pageKey?: string;
    goalIncludes?: string;
  }): string {
    const events = this.getLlmCallEvents(filter);
    return events
      .map((event) => {
        const status = event.output.goalCompleted ? 'ok' : 'fail';
        const duration = event.meta.durationMs ? ` ${event.meta.durationMs}ms` : '';
        const model = event.meta.model ? ` ${event.meta.model}` : '';
        return `${new Date(event.timestamp).toISOString()} [${event.meta.agent}] ${status}${duration}${model} - ${event.meta.goal}`;
      })
      .join('\n');
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

  addLlmCallEvent(output: HandoffOutput<unknown>, meta: LlmCallMeta): void {
    this.addEvent({ kind: 'llm_call', output, meta });
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

  setSnapshot(pageKey: string, url: string, screenshot: string | null): string | null {
    if (!screenshot) return null;
    const snapshotId = this.createSnapshotId();
    this.snapshotByPageKey[pageKey] = { url, screenshot, snapshotId };
    return snapshotId;
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

  private createSnapshotId(): string {
    this.snapshotCounter += 1;
    return `snap_${Date.now()}_${this.snapshotCounter}`;
  }
}

function truncate(value: string, max = 200): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

