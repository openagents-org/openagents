import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';

/**
 * Performance monitoring hook
 *
 * Tracks component render performance and logs slow renders
 */
export function usePerformanceMonitor(
  componentName: string,
  threshold: number = 16 // 16ms = 60fps
) {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(performance.now());

  useEffect(() => {
    renderCount.current += 1;
    const currentTime = performance.now();
    const renderTime = currentTime - lastRenderTime.current;

    if (renderTime > threshold) {
      logger.warn(
        `[Performance] ${componentName} render #${renderCount.current} took ${renderTime.toFixed(2)}ms (threshold: ${threshold}ms)`
      );
    }

    lastRenderTime.current = currentTime;
  });

  return {
    renderCount: renderCount.current,
  };
}

/**
 * Hook to measure component mount time
 */
export function useMountTime(componentName: string) {
  useEffect(() => {
    const mountTime = performance.now();

    return () => {
      const unmountTime = performance.now();
      const lifetime = unmountTime - mountTime;

      logger.debug(
        `[Performance] ${componentName} was mounted for ${lifetime.toFixed(2)}ms`
      );
    };
  }, [componentName]);
}

/**
 * Hook to track expensive operations
 */
export function useOperationTimer(operationName: string) {
  const startOperation = () => {
    const startTime = performance.now();

    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;

      logger.debug(
        `[Performance] ${operationName} took ${duration.toFixed(2)}ms`
      );

      return duration;
    };
  };

  return { startOperation };
}

/**
 * Hook to detect memory leaks
 */
export function useMemoryMonitor(componentName: string, interval: number = 5000) {
  useEffect(() => {
    if (!performance.memory) {
      logger.warn('[Performance] Memory API not available');
      return;
    }

    const checkMemory = () => {
      const memory = (performance as any).memory;
      const usedMB = (memory.usedJSHeapSize / 1048576).toFixed(2);
      const totalMB = (memory.totalJSHeapSize / 1048576).toFixed(2);

      logger.debug(
        `[Performance] ${componentName} - Memory: ${usedMB}MB / ${totalMB}MB`
      );
    };

    const intervalId = setInterval(checkMemory, interval);

    return () => clearInterval(intervalId);
  }, [componentName, interval]);
}

/**
 * Hook to track re-renders and their causes
 */
export function useWhyDidYouUpdate(name: string, props: Record<string, any>) {
  const previousProps = useRef<Record<string, any>>();

  useEffect(() => {
    if (previousProps.current) {
      const allKeys = Object.keys({ ...previousProps.current, ...props });
      const changedProps: Record<string, { from: any; to: any }> = {};

      allKeys.forEach((key) => {
        if (previousProps.current![key] !== props[key]) {
          changedProps[key] = {
            from: previousProps.current![key],
            to: props[key],
          };
        }
      });

      if (Object.keys(changedProps).length > 0) {
        logger.debug(`[Performance] ${name} re-rendered due to:`, changedProps);
      }
    }

    previousProps.current = props;
  });
}

/**
 * Performance metrics collector
 */
export class PerformanceMetrics {
  private static metrics: Map<string, number[]> = new Map();

  static record(metricName: string, value: number) {
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, []);
    }
    this.metrics.get(metricName)!.push(value);
  }

  static getStats(metricName: string) {
    const values = this.metrics.get(metricName) || [];
    if (values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  static getAllStats() {
    const allStats: Record<string, any> = {};
    this.metrics.forEach((_, metricName) => {
      allStats[metricName] = this.getStats(metricName);
    });
    return allStats;
  }

  static clear(metricName?: string) {
    if (metricName) {
      this.metrics.delete(metricName);
    } else {
      this.metrics.clear();
    }
  }

  static report() {
    const stats = this.getAllStats();
    logger.info('[Performance] Metrics Report:', stats);
    return stats;
  }
}

/**
 * Measure function execution time
 */
export function measurePerformance<T extends (...args: any[]) => any>(
  fn: T,
  name: string
): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    const start = performance.now();
    const result = fn(...args);
    const end = performance.now();
    const duration = end - start;

    PerformanceMetrics.record(name, duration);

    if (duration > 100) {
      logger.warn(`[Performance] ${name} took ${duration.toFixed(2)}ms`);
    }

    return result;
  }) as T;
}

/**
 * Async function performance measurement
 */
export function measureAsyncPerformance<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  name: string
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const start = performance.now();
    const result = await fn(...args);
    const end = performance.now();
    const duration = end - start;

    PerformanceMetrics.record(name, duration);

    if (duration > 1000) {
      logger.warn(`[Performance] ${name} took ${duration.toFixed(2)}ms`);
    }

    return result;
  }) as T;
}
