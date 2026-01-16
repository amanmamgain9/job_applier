/**
 * Automation Service Exports
 */

export { getLLMConfig, hasLLMConfig } from './config';
export { initAgent, executeTask, stopAgent, cleanupAgent, isAgentReady, getBrowserContext, onDiscoveryEvent } from './agent';
export { startDiscovery, stopDiscovery, getDiscoveryState, onStateChange, onJobFound } from './discovery';
export type { DiscoveryStatus, DiscoveryState, DiscoveryOptions, DiscoveryResult, DiscoveryEvent, DiscoveryEventHandler } from './types';

