import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Whether the element marked `data-truncatable` inside `root` is cut off by
 * its ellipsis. Sidebar rows ask on hover, so their tooltip repeats a name
 * only when the row could not show all of it.
 */
export function hasTruncatedLabel(root: Element | null): boolean {
  const label = root?.querySelector<HTMLElement>('[data-truncatable]');
  return !!label && label.scrollWidth > label.clientWidth;
}
