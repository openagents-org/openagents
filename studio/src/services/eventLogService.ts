/**
 * Event Log Service
 * 用于记录和管理发送和接收的事件日志
 * 支持本地存储持久化
 */

import { Event, EventResponse } from "@/types/events";

export interface EventLogEntry {
  id: string;
  event: Event;
  direction: "sent" | "received";
  timestamp: number;
  response?: EventResponse; // 仅对发送的事件有效
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
const MAX_LOGS = 1000; // 最大保存日志数量

type LogEntry = EventLogEntry | HttpRequestLogEntry;

class EventLogService {
  private logs: LogEntry[] = [];
  private maxLogs = MAX_LOGS;
  private listeners: Set<(logs: LogEntry[]) => void> = new Set();
  private storageEnabled = false;

  constructor() {
    // 检查是否支持 localStorage
    try {
      const testKey = "__localStorage_test__";
      localStorage.setItem(testKey, "test");
      localStorage.removeItem(testKey);
      this.storageEnabled = true;
      
      // 从 localStorage 加载日志
      this.loadLogsFromStorage();
    } catch (e) {
      console.warn("localStorage is not available, event logs will not be persisted:", e);
      this.storageEnabled = false;
    }
  }

  /**
   * 从 localStorage 加载日志
   */
  private loadLogsFromStorage(): void {
    if (!this.storageEnabled) return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedLogs = JSON.parse(stored);
        if (Array.isArray(parsedLogs)) {
          // 验证日志数据的有效性（支持事件日志和 HTTP 请求日志）
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
      // 如果加载失败，清空可能损坏的数据
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * 保存日志到 localStorage
   */
  private saveLogsToStorage(): void {
    if (!this.storageEnabled) return;

    try {
      // 只保存最新的 maxLogs 条日志
      const logsToSave = this.logs.slice(0, this.maxLogs);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logsToSave));
    } catch (error) {
      console.error("Failed to save event logs to localStorage:", error);
      // 如果存储失败（可能是存储空间不足），尝试清理旧日志
      try {
        // 如果存储空间不足，只保留最近的一半日志
        const reducedLogs = this.logs.slice(0, Math.floor(this.maxLogs / 2));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(reducedLogs));
        this.logs = reducedLogs;
        console.warn("Storage quota exceeded, reduced logs to half");
      } catch (e) {
        console.error("Failed to reduce logs size:", e);
        // 如果还是失败，禁用存储
        this.storageEnabled = false;
      }
    }
  }

  /**
   * 记录发送的事件
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
   * 记录接收的事件
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
   * 记录 HTTP 请求
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
   * 添加日志条目
   */
  private addLog(entry: LogEntry): void {
    this.logs.unshift(entry); // 添加到开头，最新的在前面

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // 保存到本地存储
    this.saveLogsToStorage();

    // 通知监听者
    this.notifyListeners();
  }

  /**
   * 获取所有日志（按时间倒序）
   */
  getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * 获取分页日志
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
   * 清空日志
   */
  clearLogs(): void {
    this.logs = [];
    
    // 清空本地存储
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
   * 订阅日志更新
   */
  subscribe(listener: (logs: LogEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 通知所有监听者
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

// 导出单例
export const eventLogService = new EventLogService();

