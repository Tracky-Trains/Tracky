/**
 * Centralized logging utility
 * Provides consistent logging across the app with environment-aware behavior
 * Persists logs to AsyncStorage for the debug log viewer
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

// __DEV__ is a global variable in React Native
declare const __DEV__: boolean;

const STORAGE_KEY = 'DEBUG_LOGS';
const MAX_PERSISTED_LOGS = 500;

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string; // ISO string for serialization
}

class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  private constructor() {
    // Load persisted logs on init
    this.loadFromStorage();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Log a debug message (only console in dev, always persisted)
   */
  debug(message: string, ...data: unknown[]): void {
    this.addEntry(LogLevel.DEBUG, message, data);
    if (__DEV__) {
      console.log(`[DEBUG] ${message}`, ...data);
    }
  }

  /**
   * Log an informational message
   */
  info(message: string, ...data: unknown[]): void {
    this.addEntry(LogLevel.INFO, message, data);
    if (__DEV__) {
      console.log(`[INFO] ${message}`, ...data);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, ...data: unknown[]): void {
    this.addEntry(LogLevel.WARN, message, data);
    console.warn(`[WARN] ${message}`, ...data);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: unknown): void {
    this.addEntry(LogLevel.ERROR, message, error);
    console.error(`[ERROR] ${message}`, error);
  }

  /**
   * Store log entry in memory and schedule persistence.
   * In production, only WARN and ERROR are persisted to reduce AsyncStorage overhead.
   */
  private addEntry(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      message,
      data: data !== undefined && (!Array.isArray(data) || data.length > 0) ? this.sanitizeData(data) : undefined,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(entry);

    // Keep only the last N logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // In production, only persist warn/error to reduce AsyncStorage writes
    if (__DEV__ || level === LogLevel.WARN || level === LogLevel.ERROR) {
      this.dirty = true;
      this.scheduleFlush();
    }
  }

  /**
   * Make data safe for JSON serialization
   */
  private sanitizeData(data: unknown): unknown {
    // Extract useful info from Error objects (JSON.stringify(Error) returns '{}')
    if (data instanceof Error) {
      return { message: data.message, stack: data.stack, name: data.name };
    }
    try {
      // Test if it's serializable
      JSON.stringify(data);
      return data;
    } catch {
      // Convert to string representation if not serializable
      return String(data);
    }
  }

  /**
   * Debounced flush to AsyncStorage (every 2 seconds max)
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.dirty) {
        this.persistToStorage();
        this.dirty = false;
      }
    }, 2000);
  }

  /**
   * Load persisted logs from AsyncStorage
   */
  private async loadFromStorage(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as LogEntry[];
        // Prepend stored logs (older) before any new in-memory logs
        this.logs = [...parsed.slice(-MAX_PERSISTED_LOGS), ...this.logs];
      }
    } catch {
      // Silently fail — don't log to avoid recursion
    }
  }

  /**
   * Persist current logs to AsyncStorage
   */
  private async persistToStorage(): Promise<void> {
    try {
      const toStore = this.logs.slice(-MAX_PERSISTED_LOGS);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // Silently fail — don't log to avoid recursion
    }
  }

  /**
   * Force flush logs to storage (call before reading)
   */
  async flush(): Promise<void> {
    if (this.dirty) {
      await this.persistToStorage();
      this.dirty = false;
    }
  }

  /**
   * Get all logs (newest last)
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get recent logs (useful for debugging or sending to support)
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Clear all stored logs
   */
  async clearLogs(): Promise<void> {
    this.logs = [];
    this.dirty = false;
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Silently fail
    }
  }

  /**
   * Export logs as JSON string (for debugging or support)
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Convenience exports
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);

function getRecentLogsFormatted(minutes: number): string {
  const cutoff = Date.now() - minutes * 60 * 1000;
  return logger
    .getLogs()
    .filter(l => new Date(l.timestamp).getTime() >= cutoff)
    .map(l => `[${l.timestamp}] [${l.level}] ${l.message}${l.data ? ` ${JSON.stringify(l.data)}` : ''}`)
    .join('\n');
}

export function openReportBugEmail() {
  Linking.openURL('https://github.com/Mootbing/Tracky/issues/new');
}

export function openReportBadDataEmail() {
  Linking.openURL('https://github.com/Mootbing/Tracky/issues/new');
}

export function openCrashReportEmail(err: Error | null, componentStack: string | null) {
  const logs = getRecentLogsFormatted(15);
  const subject = encodeURIComponent(`Tracky Crash: ${err?.message || 'Unknown error'}`);
  const body = encodeURIComponent(
    `\n\n[Provide a brief description above if you can — if not just hit send — the error details are below]\n\n` +
    `Error: ${err?.message || 'Unknown'}\n\n` +
    `Stack trace:\n${err?.stack || 'N/A'}\n\n` +
    `Component stack:\n${componentStack || 'N/A'}\n\n` +
    `────────────────────────────────\n` +
    `Debug Logs (last 15 min)\n` +
    `────────────────────────────────\n\n` +
    `${logs || 'No logs recorded'}\n`
  );
  Linking.openURL(`mailto:him@jasonxu.me?subject=${subject}&body=${body}`);
}
