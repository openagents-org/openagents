import { ReactNode, RefObject, useCallback, useEffect, useRef } from 'react';

type ScrollspyProps = {
  children: ReactNode;
  targetRef?: RefObject<HTMLElement | HTMLDivElement | Document | null | undefined>;
  onUpdate?: (id: string) => void;
  offset?: number;
  smooth?: boolean;
  className?: string;
  dataAttribute?: string;
  history?: boolean;
  throttleTime?: number;
};

export function Scrollspy({
  children,
  targetRef,
  onUpdate,
  className,
  offset = 0,
  smooth = true,
  dataAttribute = 'scrollspy',
  history = true,
}: ScrollspyProps) {
  const selfRef = useRef<HTMLDivElement | null>(null);
  const anchorElementsRef = useRef<Element[] | null>(null);
  const prevIdTracker = useRef<string | null>(null);

  // Sets active nav, hash, prevIdTracker, and calls onUpdate
  const setActiveSection = useCallback(
    (sectionId: string | null, force = false) => {
      if (!sectionId) return;
      anchorElementsRef.current?.forEach((item) => {
        const id = item.getAttribute(`data-${dataAttribute}-anchor`);
        if (id === sectionId) {
          item.setAttribute('data-active', 'true');
        } else {
          item.removeAttribute('data-active');
        }
      });
      if (onUpdate) onUpdate(sectionId);
      if (history && (force || prevIdTracker.current !== sectionId)) {
        window.history.replaceState({}, '', `#${sectionId}`);
      }
      prevIdTracker.current = sectionId;
    },
    [anchorElementsRef, dataAttribute, history, onUpdate],
  );

  const handleScroll = useCallback(() => {
    if (!anchorElementsRef.current || anchorElementsRef.current.length === 0) return;
    const scrollElement = targetRef?.current === document ? window : targetRef?.current;
    const scrollTop =
      scrollElement === window
        ? window.scrollY || document.documentElement.scrollTop
        : (scrollElement as HTMLElement).scrollTop;

    // Find the anchor whose section is closest to but not past the top
    let activeIdx = 0;
    let minDelta = Infinity;
    anchorElementsRef.current.forEach((anchor, idx) => {
      const sectionId = anchor.getAttribute(`data-${dataAttribute}-anchor`);
      const sectionElement = document.getElementById(sectionId!);
      if (!sectionElement) return;
      let customOffset = offset;
      const dataOffset = anchor.getAttribute(`data-${dataAttribute}-offset`);
      if (dataOffset) customOffset = parseInt(dataOffset, 10);
      const delta = Math.abs(sectionElement.offsetTop - customOffset - scrollTop);
      if (sectionElement.offsetTop - customOffset <= scrollTop && delta < minDelta) {
        minDelta = delta;
        activeIdx = idx;
      }
    });

    // If at bottom, force last anchor
    if (scrollElement) {
      const scrollHeight =
        scrollElement === window ? document.documentElement.scrollHeight : (scrollElement as HTMLElement).scrollHeight;
      const clientHeight = scrollElement === window ? window.innerHeight : (scrollElement as HTMLElement).clientHeight;
      if (scrollTop + clientHeight >= scrollHeight - 2) {
        activeIdx = anchorElementsRef.current.length - 1;
      }
    }

    // Set only one anchor active and sync the URL hash
    const activeAnchor = anchorElementsRef.current[activeIdx];
    const sectionId = activeAnchor?.getAttribute(`data-${dataAttribute}-anchor`) || null;
    setActiveSection(sectionId);
    // Remove data-active from all others
    anchorElementsRef.current.forEach((item, idx) => {
      if (idx !== activeIdx) {
        item.removeAttribute('data-active');
      }
    });
  }, [anchorElementsRef, targetRef, dataAttribute, offset, setActiveSection]);

  const scrollTo = useCallback(
    (anchorElement: HTMLElement) => (event?: Event) => {
      if (event) event.preventDefault();
      const sectionId = anchorElement.getAttribute(`data-${dataAttribute}-anchor`)?.replace('#', '') || null;
      if (!sectionId) return;
      const sectionElement = document.getElementById(sectionId);
      if (!sectionElement) return;

      const scrollToElement = targetRef?.current === document ? window : targetRef?.current;

      let customOffset = offset;
      const dataOffset = anchorElement.getAttribute(`data-${dataAttribute}-offset`);
      if (dataOffset) {
        customOffset = parseInt(dataOffset, 10);
      }

      const scrollTop = sectionElement.offsetTop - customOffset;

      if (scrollToElement && 'scrollTo' in scrollToElement) {
        scrollToElement.scrollTo({
          top: scrollTop,
          left: 0,
          behavior: smooth ? 'smooth' : 'auto',
        });
      }
      setActiveSection(sectionId, true);
    },
    [dataAttribute, offset, smooth, targetRef, setActiveSection],
  );

  // Scroll to the section if the ID is present in the URL hash
  const scrollToHashSection = useCallback(() => {
    const hash = CSS.escape(window.location.hash.replace('#', ''));

    if (hash) {
      const targetElement = document.querySelector(`[data-${dataAttribute}-anchor="${hash}"]`) as HTMLElement;
      if (targetElement) {
        scrollTo(targetElement)();
      }
    }
  }, [dataAttribute, scrollTo]);

  useEffect(() => {
    // Query elements and store them in the ref, avoiding unnecessary re-renders
    if (selfRef.current) {
      anchorElementsRef.current = Array.from(selfRef.current.querySelectorAll(`[data-${dataAttribute}-anchor]`));
    }

    anchorElementsRef.current?.forEach((item) => {
      item.addEventListener('click', scrollTo(item as HTMLElement));
    });

    const scrollElement = targetRef?.current === document ? window : targetRef?.current;

    // Attach the scroll event to the correct scrollable element
    scrollElement?.addEventListener('scroll', handleScroll);

    // Check if there's a hash in the URL and scroll to the corresponding section
    setTimeout(() => {
      scrollToHashSection();
      // Wait for scroll to settle, then update nav highlighting
      setTimeout(() => {
        handleScroll();
      }, 100);
    }, 100); // Adding a slight delay to ensure content is fully rendered

    return () => {
      scrollElement?.removeEventListener('scroll', handleScroll);
      anchorElementsRef.current?.forEach((item) => {
        item.removeEventListener('click', scrollTo(item as HTMLElement));
      });
    };
  }, [targetRef, selfRef, handleScroll, dataAttribute, scrollTo, scrollToHashSection]);

  return (
    <div data-slot="scrollspy" className={className} ref={selfRef}>
      {children}
    </div>
  );
}
