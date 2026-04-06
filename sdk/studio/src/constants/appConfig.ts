/**
 * Application Configuration Constants
 * Centralized configuration values to avoid magic numbers and improve maintainability
 */

/**
 * Network and Connection Configuration
 */
export const NETWORK_CONFIG = {
  /** Default timeout for network requests (ms) */
  DEFAULT_TIMEOUT: 5000,

  /** Short timeout for quick operations (ms) */
  SHORT_TIMEOUT: 3000,

  /** Long timeout for heavy operations like relay (ms) */
  LONG_TIMEOUT: 10000,

  /** Maximum reconnection attempts */
  MAX_RECONNECT_ATTEMPTS: 5,

  /** Delay between reconnection attempts (ms) */
  RECONNECT_DELAY: 3000,

  /** Interval for checking connection status (ms) */
  CONNECTION_CHECK_INTERVAL: 100,

  /** Heartbeat interval for keeping connection alive (ms) */
  HEARTBEAT_INTERVAL: 30000,
} as const;

/**
 * Polling Configuration
 */
export const POLLING_CONFIG = {
  /** Default polling interval (ms) */
  DEFAULT_INTERVAL: 1000,

  /** Fast polling interval for real-time updates (ms) */
  FAST_INTERVAL: 500,

  /** Slow polling interval for background updates (ms) */
  SLOW_INTERVAL: 5000,
} as const;

/**
 * Retry Configuration
 */
export const RETRY_CONFIG = {
  /** Maximum retry attempts */
  MAX_RETRY_ATTEMPTS: 3,

  /** Initial retry delay (ms) */
  INITIAL_RETRY_DELAY: 1000,

  /** Retry delay multiplier for exponential backoff */
  RETRY_DELAY_MULTIPLIER: 2,

  /** Maximum retry delay (ms) */
  MAX_RETRY_DELAY: 10000,
} as const;

/**
 * Session Configuration
 */
export const SESSION_CONFIG = {
  /** Session timeout duration (ms) - 5 minutes */
  TIMEOUT_DURATION: 5 * 60 * 1000,

  /** Session check interval (ms) */
  CHECK_INTERVAL: 60 * 1000,
} as const;

/**
 * UI Configuration
 */
export const UI_CONFIG = {
  /** Default page size for pagination */
  DEFAULT_PAGE_SIZE: 20,

  /** Maximum items to display in a list */
  MAX_LIST_ITEMS: 100,

  /** Debounce delay for search input (ms) */
  SEARCH_DEBOUNCE_DELAY: 300,

  /** Toast notification duration (ms) */
  TOAST_DURATION: 3000,

  /** Animation duration (ms) */
  ANIMATION_DURATION: 200,
} as const;

/**
 * File Upload Configuration
 */
export const FILE_CONFIG = {
  /** Maximum file size (bytes) - 10MB */
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  /** Maximum files per upload */
  MAX_FILES_PER_UPLOAD: 5,

  /** Allowed file types */
  ALLOWED_FILE_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/markdown',
  ],
} as const;

/**
 * Cache Configuration
 */
export const CACHE_CONFIG = {
  /** Cache expiration time (ms) - 5 minutes */
  EXPIRATION_TIME: 5 * 60 * 1000,

  /** Maximum cache size (number of items) */
  MAX_CACHE_SIZE: 100,
} as const;

/**
 * Development Configuration
 */
export const DEV_CONFIG = {
  /** Enable debug logging */
  ENABLE_DEBUG_LOGS: process.env.NODE_ENV === 'development',

  /** Enable performance monitoring */
  ENABLE_PERFORMANCE_MONITORING: process.env.NODE_ENV === 'development',

  /** API base URL */
  API_BASE_URL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000',
} as const;

/**
 * Feature Flags
 */
export const FEATURE_FLAGS = {
  /** Enable collaborative editing */
  ENABLE_COLLABORATION: true,

  /** Enable real-time notifications */
  ENABLE_NOTIFICATIONS: true,

  /** Enable analytics */
  ENABLE_ANALYTICS: false,
} as const;

/**
 * Helper function to get timeout value based on operation type
 */
export function getTimeout(type: 'short' | 'default' | 'long' = 'default'): number {
  switch (type) {
    case 'short':
      return NETWORK_CONFIG.SHORT_TIMEOUT;
    case 'long':
      return NETWORK_CONFIG.LONG_TIMEOUT;
    default:
      return NETWORK_CONFIG.DEFAULT_TIMEOUT;
  }
}

/**
 * Helper function to calculate exponential backoff delay
 */
export function getRetryDelay(attemptNumber: number): number {
  const delay = RETRY_CONFIG.INITIAL_RETRY_DELAY *
    Math.pow(RETRY_CONFIG.RETRY_DELAY_MULTIPLIER, attemptNumber - 1);
  return Math.min(delay, RETRY_CONFIG.MAX_RETRY_DELAY);
}
