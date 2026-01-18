/**
 * @packageDocumentation
 *
 * automation-core - Browser automation library for Chrome Extensions
 *
 * Requirements:
 * - Chrome Extension Manifest V3
 * - Permissions: "debugger", "tabs", "scripting", "activeTab"
 * - Host permissions for target sites
 *
 * This library will NOT work in:
 * - Node.js scripts
 * - Web pages
 * - Other browser extensions (Firefox, Safari)
 *
 * @example
 * ```typescript
 * import { AutomationAgent, BrowserContext } from '@nanobrowser/automation-core';
 *
 * const context = await BrowserContext.fromActiveTab();
 * const agent = new AutomationAgent({
 *   context,
 *   llm: {
 *     provider: 'anthropic',
 *     apiKey: 'sk-...',
 *     model: 'claude-sonnet-4-20250514'
 *   }
 * });
 *
 * agent.on('step', (event) => console.log(event));
 *
 * const result = await agent.execute("Click the submit button");
 * console.log(result);
 * ```
 */

// Main entry point
export { AutomationAgent, type AgentConfig, type EventHandler } from './automation-agent';

// Browser
export { BrowserContext } from './browser/context';
export { Page } from './browser/page';
export {
  type BrowserContextConfig,
  type BrowserState,
  type PageState,
  type TabInfo,
  DEFAULT_BROWSER_CONTEXT_CONFIG,
  BrowserError,
  URLNotAllowedError,
} from './browser/types';
export { DOMElementNode, DOMTextNode } from './browser/dom/views';

// Agent
export { Executor, type ExecutorConfig } from './agent/executor';
export { NavigatorAgent } from './agent/navigator';
export { ActionBuilder, Action, type ActionSchema } from './agent/actions';
export { AgentContext } from './agent/types';

// LLM
export { createChatModel, validateLLMConfig } from './llm/factory';

// Types
export {
  type LLMConfig,
  type LLMProvider,
  type TaskResult,
  type StepRecord,
  type ExecutionEvent,
  type ExecutionEventType,
  type AgentOptions,
  type AgentOutput,
  ActionResult,
  DEFAULT_AGENT_OPTIONS,
} from './types';

// Utilities
export { createLogger, setDebugEnabled } from './utils/logger';

