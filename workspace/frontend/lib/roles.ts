import type { TranslateFn } from './i18n';
import type { WorkspaceRole } from './types';

/**
 * Role names, in the reader's language.
 *
 * The API speaks `owner`/`admin`/`member`/`viewer` and every surface used to
 * print those verbatim — a Chinese settings page with four English words in it,
 * in a picker, a badge and a sentence.
 *
 * An unknown value comes through untranslated rather than blank: a role the UI
 * has not heard of is still information, and hiding it would leave a member row
 * looking as if it had no role at all.
 */
const ROLE_KEYS = {
  owner: 'admin.roleOwner',
  admin: 'admin.roleAdmin',
  member: 'admin.roleMember',
  viewer: 'admin.roleViewer',
} as const;

export function roleLabel(t: TranslateFn, role?: string | null): string {
  if (!role) return '';
  const key = ROLE_KEYS[role as WorkspaceRole];
  return key ? t(key) : role;
}
