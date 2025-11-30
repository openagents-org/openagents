/**
 * Event Log Service
 * Used to record and manage sent and received event logs
 * Supports localStorage persistence
 */

import { Event, EventResponse } from "@/types/events";

export interface EventLogEntry {
  id: string;
  event: Event;
  direction: "sent" | "received";
  timestamp: number;
  response?: EventResponse; // Only valid for sent events
}

export interface HttpRequestLogEntry {
  id: string;
  type: "http_request";
  method: string;
  url: string;
  host: string;
  port: number;
  endpoint: string;
  requestBody?: any;
  responseStatus?: number;
  responseBody?: any;
  timestamp: number;
  duration?: number; // Response time in milliseconds
  error?: string;
}

const STORAGE_KEY = "openagents_event_logs";
const MAX_LOGS = 1000; // Maximum number of logs to save

type LogEntry = EventLogEntry | HttpRequestLogEntry;

class EventLogService {
  private logs: LogEntry[] = [];
  private maxLogs = MAX_LOGS;
  private listeners: Set<(logs: LogEntry[]) => void> = new Set();
  private storageEnabled = false;

  constructor() {
    // Check if localStorage is supported
    try {
      const testKey = "__localStorage_test__";
      localStorage.setItem(testKey, "test");
      localStorage.removeItem(testKey);
      this.storageEnabled = true;
      
      // Load logs from localStorage
      this.loadLogsFromStorage();
    } catch (e) {
      console.warn("localStorage is not available, event logs will not be persisted:", e);
      this.storageEnabled = false;
    }
  }

  /**
   * Load logs from localStorage
   */
  private loadLogsFromStorage(): void {
    if (!this.storageEnabled) return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedLogs = JSON.parse(stored);
        if (Array.isArray(parsedLogs)) {
          // Validate log data (supports event logs and HTTP request logs)
          const validLogs = parsedLogs.filter((log: any) => {
            if (!log || typeof log.id !== "string" || typeof log.timestamp !== "number") {
              return false;
            }
            
            // Check if it's an HTTP request log
            if (log.type === "http_request") {
              return (
                typeof log.method === "string" &&
                typeof log.url === "string" &&
                typeof log.host === "string" &&
                typeof log.port === "number" &&
                typeof log.endpoint === "string"
              );
            }
            
            // Check if it's an event log
            return (
              log.event &&
              typeof log.event.event_name === "string" &&
              typeof log.direction === "string" &&
              (log.direction === "sent" || log.direction === "received")
            );
          });
          
          this.logs = validLogs.slice(0, this.maxLogs);
          console.log(`Loaded ${this.logs.length} event logs from localStorage`);
        }
      }
    } catch (error) {
      console.error("Failed to load event logs from localStorage:", error);
      // If loading fails, clear potentially corrupted data
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Save logs to localStorage
   */
  private saveLogsToStorage(): void {
    if (!this.storageEnabled) return;

    try {
      // Only save the latest maxLogs entries
      const logsToSave = this.logs.slice(0, this.maxLogs);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logsToSave));
    } catch (error) {
      console.error("Failed to save event logs to localStorage:", error);
      // If storage fails (possibly due to quota exceeded), try to clean up old logs
      try {
        // If quota exceeded, keep only the most recent half of logs
        const reducedLogs = this.logs.slice(0, Math.floor(this.maxLogs / 2));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(reducedLogs));
        this.logs = reducedLogs;
        console.warn("Storage quota exceeded, reduced logs to half");
      } catch (e) {
        console.error("Failed to reduce logs size:", e);
        // If still fails, disable storage
        this.storageEnabled = false;
      }
    }
  }

  /**
   * Log sent event
   */
  logSentEvent(event: Event, response?: EventResponse): void {
    const entry: EventLogEntry = {
      id: event.event_id || `sent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event,
      direction: "sent",
      timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
      response,
    };

    this.addLog(entry);
  }

  /**
   * Log received event
   */
  logReceivedEvent(event: Event): void {
    const entry: EventLogEntry = {
      id: event.event_id || `received_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event,
      direction: "received",
      timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
    };

    this.addLog(entry);
  }

  /**
   * Log HTTP request
   */
  logHttpRequest(entry: Omit<HttpRequestLogEntry, "id" | "type" | "timestamp">): void {
    const logEntry: HttpRequestLogEntry = {
      id: `http_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: "http_request",
      timestamp: Date.now(),
      ...entry,
    };

    this.addLog(logEntry);
  }

  /**
   * Add log entry
   */
  private addLog(entry: LogEntry): void {
    this.logs.unshift(entry); // Add to beginning, newest first

    // Limit log count
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // Save to localStorage
    this.saveLogsToStorage();

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Get all logs (in reverse chronological order)
   */
  getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get paginated logs
   */
  getLogs(page: number, pageSize: number): {
    logs: LogEntry[];
    total: number;
    totalPages: number;
  } {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedLogs = this.logs.slice(start, end);

    return {
      logs: paginatedLogs,
      total: this.logs.length,
      totalPages: Math.ceil(this.logs.length / pageSize),
    };
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
    
    // Clear localStorage
    if (this.storageEnabled) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        console.error("Failed to clear event logs from localStorage:", error);
      }
    }
    
    this.notifyListeners();
  }

  /**
   * Subscribe to log updates
   */
  subscribe(listener: (logs: LogEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener([...this.logs]);
      } catch (error) {
        console.error("Error in event log listener:", error);
      }
    });
  }
}

// Export singleton
export const eventLogService = new EventLogService();

