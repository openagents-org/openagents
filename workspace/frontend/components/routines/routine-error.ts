import { ApiError } from '@/lib/api';

/**
 * What to show the user when a routine request fails. An `ApiError`'s own
 * message is the raw `API 400: {"code":…}` line, so prefer the server's
 * human-readable message and fall back to `fallback` when there isn't one.
 */
export function routineErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.serverMessage || fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
