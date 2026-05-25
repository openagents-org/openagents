const USER_ID_COOKIE = 'oa_user_id';
const USER_NAME_COOKIE = 'oa_user_name';
const MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${MAX_AGE};SameSite=Lax`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function generateUserId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getStoredIdentity(): { id: string; name: string } | null {
  try {
    const id = getCookie(USER_ID_COOKIE);
    const name = getCookie(USER_NAME_COOKIE);
    if (id && name) return { id, name };
  } catch {
    // SSR or cookie access blocked
  }
  return null;
}

export function storeIdentity(id: string, name: string) {
  try {
    setCookie(USER_ID_COOKIE, id);
    setCookie(USER_NAME_COOKIE, name);
  } catch {
    // cookie access blocked
  }
}
