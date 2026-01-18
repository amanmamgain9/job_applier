/**
 * Simple logger for the automation-core library
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warning: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
}

// Configuration for debug mode
let debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;

  // Bind console methods directly to preserve call stack and show correct line numbers
  const boundDebug = console.debug.bind(console, prefix);
  const boundInfo = console.info.bind(console, prefix);
  const boundWarn = console.warn.bind(console, prefix);
  const boundError = console.error.bind(console, prefix);
  const boundGroup = console.group.bind(console);
  const boundGroupEnd = console.groupEnd.bind(console);

  return {
    debug: (...args: unknown[]) => {
      if (debugEnabled) {
        boundDebug(...args);
      }
    },
    info: boundInfo,
    warning: boundWarn,
    error: boundError,
    group: (label: string) => boundGroup(`${prefix} ${label}`),
    groupEnd: boundGroupEnd,
  };
}

// Create default logger
export const logger = createLogger('AutomationCore');

