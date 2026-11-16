'use client';

import Link from 'next/link';
import {
  CircleUser, ClipboardCheck, Globe, KeyRound, Lock, MonitorSmartphone, Plug, Settings2,
  ShieldCheck, SlidersHorizontal, Users, type LucideIcon,
} from 'lucide-react';
import { canAccessSettingsSection } from '@/components/settings/admin-context';
import type { WorkspaceMe } from '@/lib/types';
import { useT, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Section = { slug: string; labelKey: MessageKey; icon: LucideIcon };

/** Personal settings first (every member has them), then the workspace's own,
 * which only owners and admins see. */
const GROUPS: { labelKey: MessageKey; sections: Section[] }[] = [
  {
    labelKey: 'admin.navGroupPersonal',
    sections: [
      { slug: 'profile', labelKey: 'admin.navProfile', icon: CircleUser },
      { slug: 'preferences', labelKey: 'admin.navPreferences', icon: SlidersHorizontal },
      { slug: 'connected-apps', labelKey: 'admin.navConnectedApps', icon: Plug },
    ],
  },
  {
    labelKey: 'admin.navGroupWorkspace',
    sections: [
      { slug: 'general', labelKey: 'admin.navGeneral', icon: Settings2 },
      { slug: 'members', labelKey: 'admin.navMembers', icon: Users },
      { slug: 'security', labelKey: 'admin.navSecurity', icon: ShieldCheck },
      { slug: 'approvals', labelKey: 'admin.navApprovals', icon: ClipboardCheck },
      { slug: 'private-threads', labelKey: 'adminThreads.navLabel', icon: Lock }, // v1.1 permission model (admin)
      { slug: 'devices', labelKey: 'admin.navDevices', icon: MonitorSmartphone },
      { slug: 'model-access', labelKey: 'admin.navModelAccess', icon: KeyRound },
      { slug: 'integrations', labelKey: 'admin.navIntegrations', icon: Globe },
    ],
  },
];

export function SettingsNav({
  workspaceId,
  me,
  pathname,
  query,
}: {
  workspaceId: string;
  me: WorkspaceMe | null;
  pathname: string | null;
  query: string;
}) {
  const t = useT();
  const groups = GROUPS
    .map((group) => ({ ...group, sections: group.sections.filter(({ slug }) => canAccessSettingsSection(me, slug)) }))
    .filter((group) => group.sections.length > 0);

  return (
    <nav className="flex shrink-0 gap-4 overflow-x-auto md:w-52 md:flex-col md:gap-6 md:overflow-visible">
      {groups.map((group) => (
        <div key={group.labelKey} className="flex shrink-0 gap-1 md:flex-col">
          <p className="hidden px-3 pb-1 text-xs font-medium text-muted-foreground md:block">{t(group.labelKey)}</p>
          {group.sections.map(({ slug, labelKey, icon: Icon }) => {
            const active = pathname?.endsWith(`/settings/${slug}`);
            return (
              <Link
                key={slug}
                href={`/${workspaceId}/settings/${slug}${query}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap transition-colors',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {t(labelKey)}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
