import { clsx, type ClassValue } from 'clsx';

/**
 * Merges Tailwind class names, resolving any conflicts.
 * Simplified version without tailwind-merge - uses clsx only
 *
 * @param inputs - An array of class names to merge.
 * @returns A string of merged class names.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

