import React, { ComponentType, lazy, Suspense, memo } from 'react';

/**
 * React Performance Optimization Utilities
 */

// ============================================================================
// Lazy Loading Utilities
// ============================================================================

/**
 * Enhanced lazy loading with retry logic
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  retries: number = 3
): React.LazyExoticComponent<T> {
  return lazy(() => {
    return new Promise<{ default: T }>((resolve, reject) => {
      const attemptImport = (attemptsLeft: number) => {
        componentImport()
          .then(resolve)
          .catch((error) => {
            if (attemptsLeft === 1) {
              reject(error);
              return;
            }
            setTimeout(() => {
              attemptImport(attemptsLeft - 1);
            }, 1000);
          });
      };
      attemptImport(retries);
    });
  });
}

/**
 * Lazy load with preload capability
 */
export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  const Component = lazy(factory);
  let factoryPromise: Promise<{ default: T }> | undefined;

  return {
    Component,
    preload: () => {
      if (!factoryPromise) {
        factoryPromise = factory();
      }
      return factoryPromise;
    },
  };
}

/**
 * Lazy loading wrapper with custom fallback
 */
export function LazyLoad<P extends object>({
  factory,
  fallback = <div>Loading...</div>,
  ...props
}: {
  factory: () => Promise<{ default: ComponentType<P> }>;
  fallback?: React.ReactNode;
} & P) {
  const LazyComponent = lazy(factory);
  return (
    <Suspense fallback={fallback}>
      <LazyComponent {...(props as P)} />
    </Suspense>
  );
}

// ============================================================================
// Memoization Utilities
// ============================================================================

/**
 * Smart memo wrapper with custom comparison
 */
export function smartMemo<P extends object>(
  Component: ComponentType<P>,
  propsAreEqual?: (prevProps: Readonly<P>, nextProps: Readonly<P>) => boolean
): React.MemoExoticComponent<ComponentType<P>> {
  return memo(Component, propsAreEqual);
}

/**
 * Memo wrapper that only re-renders on specific prop changes
 */
export function memoWithProps<P extends object>(
  Component: ComponentType<P>,
  watchProps: (keyof P)[]
): React.MemoExoticComponent<ComponentType<P>> {
  return memo(Component, (prevProps, nextProps) => {
    return watchProps.every((prop) => prevProps[prop] === nextProps[prop]);
  });
}

/**
 * Deep comparison memo
 */
export function deepMemo<P extends object>(
  Component: ComponentType<P>
): React.MemoExoticComponent<ComponentType<P>> {
  return memo(Component, (prevProps, nextProps) => {
    return JSON.stringify(prevProps) === JSON.stringify(nextProps);
  });
}

// ============================================================================
// Virtual Scrolling Component
// ============================================================================

interface VirtualScrollProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
}

/**
 * Virtual scrolling component for large lists
 */
export function VirtualScroll<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
}: VirtualScrollProps<T>) {
  const [scrollTop, setScrollTop] = React.useState(0);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex + 1);
  const offsetY = startIndex * itemHeight;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative',
      }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, index) => (
            <div key={startIndex + index} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Optimized List Rendering
// ============================================================================

interface OptimizedListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  chunkSize?: number;
  emptyComponent?: React.ReactNode;
}

/**
 * Optimized list component with chunked rendering
 */
export function OptimizedList<T>({
  items,
  renderItem,
  keyExtractor,
  chunkSize = 20,
  emptyComponent = <div>No items</div>,
}: OptimizedListProps<T>) {
  const [visibleCount, setVisibleCount] = React.useState(chunkSize);

  React.useEffect(() => {
    setVisibleCount(chunkSize);
  }, [items, chunkSize]);

  const loadMore = React.useCallback(() => {
    if (visibleCount < items.length) {
      setVisibleCount((prev) => Math.min(prev + chunkSize, items.length));
    }
  }, [visibleCount, items.length, chunkSize]);

  if (items.length === 0) {
    return <>{emptyComponent}</>;
  }

  const visibleItems = items.slice(0, visibleCount);

  return (
    <div>
      {visibleItems.map((item, index) => (
        <React.Fragment key={keyExtractor(item, index)}>
          {renderItem(item, index)}
        </React.Fragment>
      ))}
      {visibleCount < items.length && (
        <button
          onClick={loadMore}
          className="w-full py-2 text-center text-blue-600 hover:bg-blue-50"
        >
          Load More ({items.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Performance Monitoring HOC
// ============================================================================

/**
 * HOC to monitor component render performance
 */
export function withPerformanceMonitoring<P extends object>(
  Component: ComponentType<P>,
  componentName: string
): ComponentType<P> {
  return (props: P) => {
    const renderCount = React.useRef(0);
    const startTime = React.useRef(performance.now());

    React.useEffect(() => {
      renderCount.current += 1;
      const renderTime = performance.now() - startTime.current;

      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[Performance] ${componentName} render #${renderCount.current} took ${renderTime.toFixed(2)}ms`
        );
      }

      startTime.current = performance.now();
    });

    return <Component {...props} />;
  };
}

// ============================================================================
// Debounced Component
// ============================================================================

interface DebouncedComponentProps<P> {
  component: ComponentType<P>;
  props: P;
  delay?: number;
}

/**
 * Wrapper to debounce component re-renders
 */
export function DebouncedComponent<P extends object>({
  component: Component,
  props,
  delay = 300,
}: DebouncedComponentProps<P>) {
  const [debouncedProps, setDebouncedProps] = React.useState(props);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedProps(props);
    }, delay);

    return () => clearTimeout(handler);
  }, [props, delay]);

  return <Component {...debouncedProps} />;
}

// ============================================================================
// Conditional Rendering Utilities
// ============================================================================

/**
 * Render component only when visible in viewport
 */
export function RenderWhenVisible({
  children,
  threshold = 0.1,
  rootMargin = '50px',
}: {
  children: React.ReactNode;
  threshold?: number;
  rootMargin?: string;
}) {
  const [isVisible, setIsVisible] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return <div ref={ref}>{isVisible ? children : <div style={{ minHeight: '100px' }} />}</div>;
}

// ============================================================================
// Image Optimization
// ============================================================================

interface OptimizedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  placeholder?: string;
  lazy?: boolean;
}

/**
 * Optimized image component with lazy loading and placeholder
 */
export const OptimizedImage = memo(
  ({ src, alt, placeholder, lazy = true, ...props }: OptimizedImageProps) => {
    const [imageSrc, setImageSrc] = React.useState(placeholder || '');
    const [isLoaded, setIsLoaded] = React.useState(false);
    const imgRef = React.useRef<HTMLImageElement>(null);

    React.useEffect(() => {
      if (!lazy) {
        setImageSrc(src);
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setImageSrc(src);
            observer.disconnect();
          }
        },
        { rootMargin: '50px' }
      );

      if (imgRef.current) {
        observer.observe(imgRef.current);
      }

      return () => observer.disconnect();
    }, [src, lazy]);

    return (
      <img
        ref={imgRef}
        src={imageSrc}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        style={{
          opacity: isLoaded ? 1 : 0.5,
          transition: 'opacity 0.3s ease-in-out',
        }}
        {...props}
      />
    );
  }
);

OptimizedImage.displayName = 'OptimizedImage';

// ============================================================================
// Batch Updates Utility
// ============================================================================

/**
 * Batch multiple state updates together
 */
export function useBatchedUpdates() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const pendingUpdates = React.useRef<(() => void)[]>([]);

  const batchUpdate = React.useCallback((updateFn: () => void) => {
    pendingUpdates.current.push(updateFn);

    if (pendingUpdates.current.length === 1) {
      requestAnimationFrame(() => {
        pendingUpdates.current.forEach((fn) => fn());
        pendingUpdates.current = [];
        forceUpdate();
      });
    }
  }, []);

  return batchUpdate;
}

// ============================================================================
// Prevent Unnecessary Re-renders
// ============================================================================

/**
 * Hook to prevent re-renders when props haven't changed
 */
export function useStableCallback<T extends (...args: any[]) => any>(callback: T): T {
  const callbackRef = React.useRef(callback);

  React.useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return React.useCallback((...args: Parameters<T>) => {
    return callbackRef.current(...args);
  }, []) as T;
}

/**
 * Hook to get stable reference to a value
 */
export function useStableValue<T>(value: T): T {
  const ref = React.useRef(value);

  React.useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}
