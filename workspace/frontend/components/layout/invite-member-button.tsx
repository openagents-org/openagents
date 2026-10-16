'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/use-me';
import { canAdminister } from '@/components/settings/admin-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { currentRouteSearch } from '@/lib/route-search';

/** The existing members invitation flow, kept next to the account avatar. */
export function InviteMemberButton() {
  const { workspace } = useWorkspace();
  const me = useMe(workspace?.slug || workspace?.workspaceId);
  const router = useRouter();
  const t = useT();
  if (!workspace || !canAdminister(me)) return null;
  return <button type="button" title={t('userMenu.inviteMembers')} aria-label={t('userMenu.inviteMembers')}
    onClick={() => router.push(`/${workspace.slug}/settings/members${currentRouteSearch()}`)}
    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
    <UserPlus className="size-4" />
  </button>;
}
