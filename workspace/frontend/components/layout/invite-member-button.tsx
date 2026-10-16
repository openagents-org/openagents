'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { currentRouteSearch } from '@/lib/route-search';

/** The existing members invitation flow, kept next to the account avatar. */
export function InviteMemberButton() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const t = useT();
  // Keep the entry point visible while identity loads and for ordinary members.
  // The settings page and invite endpoint enforce invitation permissions.
  if (!workspace) return null;
  return <button type="button" title={t('userMenu.inviteMembers')} aria-label={t('userMenu.inviteMembers')}
    onClick={() => router.push(`/${workspace.slug}/settings/members${currentRouteSearch()}`)}
    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
    <UserPlus className="size-4" />
  </button>;
}
