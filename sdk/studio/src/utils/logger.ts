/**
 * Unified Logger Utility
 *
 * Provides a centralized logging system that:
 * - Automatically disables logs in production
 * - Supports different log levels
 * - Provides consistent formatting
 * - Can be easily extended for remote logging
 */

import { DEV_CONFIG } from '@/constants/appConfig';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

interface LoggerConfig {
  enabled: boolean;
  minLevel: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      enabled: DEV_CONFIG.ENABLE_DEBUG_LOGS,
      minLevel: process.env.NODE_ENV === 'production' ? LogLevel.WARN : LogLevel.DEBUG,
      timestamp: true,
      ...config,
    };
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return this.config.enabled && level >= this.config.minLevel;
  }

  /**
   * Format log message with optional timestamp and prefix
   */
  private formatMessage(level: string, message: string, prefix?: string): string {
    const parts: string[] = [];

    if (this.config.timestamp) {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour12: false });
      parts.push(`[${time}]`);
    }

    parts.push(`[${level}]`);

    if (prefix || this.config.prefix) {
      parts.push(`[${prefix || this.config.prefix}]`);
    }

    parts.push(message);

    return parts.join(' ');
  }

  /**
   * Debug level logging - for detailed debugging information
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage('DEBUG', message), ...args);
    }
  }

  /**
   * Info level logging - for general information
   */
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('INFO', message), ...args);
    }
  }

  /**
   * Log level logging - alias for info
   */
  log(message: string, ...args: unknown[]): void {
    this.info(message, ...args);
  }

  /**
   * Warning level logging - for warnings
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('WARN', message), ...args);
    }
  }

  /**
   * Error level logging - for errors (always logged)
   */
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('ERROR', message), ...args);
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix}:${prefix}` : prefix,
    });
  }

  /**
   * Group logs together (useful for debugging)
   */
  group(label: string, collapsed: boolean = false): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      if (collapsed) {
        console.groupCollapsed(this.formatMessage('GROUP', label));
      } else {
        console.group(this.formatMessage('GROUP', label));
      }
    }
  }

  /**
   * End a log group
   */
  groupEnd(): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.groupEnd();
    }
  }

  /**
   * Log a table (useful for arrays/objects)
   */
  table(data: unknown): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.table(data);
    }
  }

  /**
   * Start a timer
   */
  time(label: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.time(label);
    }
  }

  /**
   * End a timer and log the duration
   */
  timeEnd(label: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.timeEnd(label);
    }
  }

  /**
   * Assert a condition and log if false
   */
  assert(condition: boolean, message: string): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.assert(condition, this.formatMessage('ASSERT', message));
    }
  }
}

// Create and export default logger instance
export const logger = new Logger();

// Export specialized loggers for different modules
export const authLogger = logger.child('Auth');
export const chatLogger = logger.child('Chat');
export const networkLogger = logger.child('Network');
export const storeLogger = logger.child('Store');
export const serviceLogger = logger.child('Service');
export const uiLogger = logger.child('UI');
export const collaborationLogger = logger.child('Collaboration');
export const eventLogger = logger.child('Event');

// Export Logger class for custom instances
export { Logger };

/**
 * Utility function to safely stringify objects for logging
 */
export function safeStringify(obj: unknown, maxLength: number = 500): string {
  try {
    const str = JSON.stringify(obj, null, 2);
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  } catch (error) {
    return '[Circular or Non-Serializable Object]';
  }
}

/**
 * Utility function to log performance metrics
 */
export function logPerformance(label: string, startTime: number): void {
  if (DEV_CONFIG.ENABLE_PERFORMANCE_MONITORING) {
    const duration = Date.now() - startTime;
    logger.debug(`⚡ ${label}: ${duration}ms`);
  }
}
