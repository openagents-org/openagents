import { useState, useEffect } from 'react';

/**
 * Hook to detect screen size using media queries
 * @param query - Media query string (e.g., '(max-width: 768px)')
 * @returns boolean indicating if the media query matches
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);
    
    // Set initial value
    const updateMatches = () => {
      setMatches(mediaQuery.matches);
    };
    updateMatches();

    // Create event listener
    const handler = (event: MediaQueryListEvent | MediaQueryList) => {
      // Handle both event and direct mediaQueryList
      const matches = 'matches' in event ? event.matches : mediaQuery.matches;
      setMatches(matches);
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handler);
      return () => mediaQuery.removeListener(handler);
    }
  }, [query]);

  return matches;
};

/**
 * Hook to detect if screen is mobile size (typically < 768px)
 */
export const useIsMobile = (): boolean => {
  return useMediaQuery('(max-width: 768px)');
};

