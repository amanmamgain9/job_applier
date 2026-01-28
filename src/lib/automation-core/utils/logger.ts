/**
 * Simple logger for the automation-core library
 * 
 * All logs are also piped to the active report (if set) so they appear
 * in the downloadable session report.
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

// Global report sink - when set, all logs also go to the report
type ReportSink = (message: string) => void;
let activeReportSink: ReportSink | null = null;

export function setReportSink(sink: ReportSink | null): void {
  activeReportSink = sink;
}

function formatArgs(args: unknown[]): string {
  return args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
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

  const pipeToReport = (level: string, args: unknown[]) => {
    if (activeReportSink) {
      activeReportSink(`${prefix} [${level}] ${formatArgs(args)}`);
    }
  };

  return {
    debug: (...args: unknown[]) => {
      if (debugEnabled) {
        boundDebug(...args);
        pipeToReport('DEBUG', args);
      }
    },
    info: (...args: unknown[]) => {
      boundInfo(...args);
      pipeToReport('INFO', args);
    },
    warning: (...args: unknown[]) => {
      boundWarn(...args);
      pipeToReport('WARN', args);
    },
    error: (...args: unknown[]) => {
      boundError(...args);
      pipeToReport('ERROR', args);
    },
    group: (label: string) => {
      boundGroup(`${prefix} ${label}`);
      pipeToReport('GROUP', [label]);
    },
    groupEnd: boundGroupEnd,
  };
}

// Create default logger
export const logger = createLogger('AutomationCore');

