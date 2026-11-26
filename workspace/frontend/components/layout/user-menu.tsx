'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import {
  Check, EllipsisVertical, KeyRound, LayoutGrid, LayoutList, LogIn, LogOut, Monitor, Moon, Settings, Shield, Sun, User, UserPlus, MessageSquarePlus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useMe } from '@/hooks/use-me';
import { canAdminister } from '@/components/settings/admin-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin, goToCentralLogout } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';
import { currentRouteSearch } from '@/lib/route-search';
import { LanguageMenuSub } from './language-menu';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { FeedbackDialog } from '@/components/feedback/feedback-dialog';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

interface UserMenuProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** `row`: the sidebar footer's account row (avatar, name, email — shadcn
   *  sidebar-07's NavUser); `icon`: the avatar alone, for tight spots. */
  variant?: 'icon' | 'row';
}

// System first — it is the default, and the one most people leave it on.
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
] as const;

export function UserMenu({ side, align = 'end', variant = 'icon' }: UserMenuProps = {}) {
  const { workspace, token, currentUser } = useWorkspace();
  const { user, isOpenAgentsDomain, signIn, signOut } = useOpenAgentsAuth();
  const me = useMe(workspace?.slug || workspace?.workspaceId);
  const isAdmin = canAdminister(me);
  const [showFeedback, setShowFeedback] = useState(false);
  const { theme, setTheme } = useTheme();
  const confirm = useConfirm();
  const router = useRouter();
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // `theme` is undefined until next-themes has read localStorage on the client,
  // so fall back to 'system' — the provider default — until then. Without the
  // mounted guard the trigger would render one value on the server and another
  // after hydration.
  const activeTheme = (mounted && theme) || 'system';
  const activeThemeOption =
    THEME_OPTIONS.find((option) => option.value === activeTheme) ?? THEME_OPTIONS[0];
  const ActiveThemeIcon = activeThemeOption.icon;

  const isOwnedByUser = workspace && user && workspace.creatorEmail === user.email;

  const handleCopyToken = async () => {
    if (!isAdmin) return;
    if (!token) {
      toast.error(t('userMenu.tokenMissing'));
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        // Fallback for in-app browsers / insecure contexts without the Clipboard API
        const ta = document.createElement('textarea');
        ta.value = token;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setTokenCopied(true);
      toast.success(t('userMenu.tokenCopiedToast'));
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      toast.error(t('userMenu.tokenCopyFailed'));
    }
  };

  // Signing out drops the session on this device — cheap to redo, but not
  // something to trigger from a stray click on a menu item that sits one row
  // below "Workspace settings".
  const handleSignOut = async () => {
    const ok = await confirm({
      title: t('userMenu.signOutTitle'),
      description: user
        ? t('userMenu.signOutDescriptionWithEmail', { email: user.email })
        : t('userMenu.signOutDescription'),
      confirmText: t('userMenu.signOut'),
      destructive: true,
    });
    if (ok) goToCentralLogout(signOut);
  };

  // The row names the person: their display name over their email, or just
  // the email when that is all we have. Signed out, the local identity's name.
  const rowName = user ? user.displayName || user.email : currentUser.name || t('userMenu.account');
  const rowEmail = user && user.displayName && user.displayName !== user.email ? user.email : '';

  const menu = (
      <DropdownMenu>
        {variant === 'row' ? (
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              {user ? (
                <HumanAvatar email={user.email} className="size-8" />
              ) : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><User /></span>
              )}
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate font-medium">{rowName}</span>
                {rowEmail && <span className="truncate text-xs text-muted-foreground">{rowEmail}</span>}
              </span>
              <EllipsisVertical className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
        ) : (
          <WithTooltip label={user?.email || t('userMenu.account')}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={user?.email || t('userMenu.account')}
                className="rounded-full text-muted-foreground"
              >
                {user ? (
                  <HumanAvatar email={user.email} className="size-6" />
                ) : (
                  <User />
                )}
              </Button>
            </DropdownMenuTrigger>
          </WithTooltip>
        )}

        <DropdownMenuContent side={side} align={align} sideOffset={8} className="w-60">
          {user && (
            <>
              <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{user.email}</span>
                {isOwnedByUser && (
                  <span className="flex items-center gap-1 text-xs font-normal text-success">
                    <Shield className="size-3" /> {t('userMenu.ownsWorkspace')}
                  </span>
                )}
              </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}

          {user && (
            <>
              <DropdownMenuGroup>
                {isOpenAgentsDomain && (
                  <DropdownMenuItem onClick={() => router.push('/')}>
                    <LayoutGrid />
                    {t('userMenu.switchWorkspace')}
                  </DropdownMenuItem>
                )}
                {/* Jams (OpenAgents Jam) live apart from workspaces. */}
                <DropdownMenuItem onClick={() => router.push('/jams')} data-user-menu-jams="">
                  <LayoutList />
                  {t('jams.myJams')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ActiveThemeIcon />
              {t('theme.label')}
              <span className="flex-1 text-end text-xs text-muted-foreground">
                {t(activeThemeOption.labelKey)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-36">
                <DropdownMenuRadioGroup value={activeTheme} onValueChange={setTheme}>
                  {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value} className="gap-2">
                      <Icon className="size-4 opacity-60" />
                      {t(labelKey)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <LanguageMenuSub />

          {isAdmin && token && (
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleCopyToken(); }}>
              {tokenCopied ? <Check /> : <KeyRound />}
              {tokenCopied ? t('userMenu.tokenCopied') : t('userMenu.copyToken')}
            </DropdownMenuItem>
          )}

          {/* Straight to the Members section's invite box — the most common
              admin action gets its own entry. */}
          {isAdmin && (
            <DropdownMenuItem
              onClick={() => {
                if (!workspace) return;
                router.push(`/${workspace.slug}/settings/members${currentRouteSearch()}`);
              }}
            >
              <UserPlus />
              {t('userMenu.inviteMembers')}
            </DropdownMenuItem>
          )}

          {/* Feedback goes to POST /v1/feedback (stored + forwarded to the
              team) — the cheapest possible path from an annoyed user to us. */}
          <DropdownMenuItem onClick={() => setShowFeedback(true)}>
            <MessageSquarePlus />
            {t('userMenu.sendFeedback')}
          </DropdownMenuItem>

          {/* Full-page admin dashboard (general / members / security / devices /
              integrations / preferences). currentRouteSearch() carries an
              incoming ?token= through so token-link visitors keep access. */}
          <DropdownMenuItem
            onClick={() => {
              if (!workspace) return;
              router.push(`/${workspace.slug}/settings/${isAdmin ? 'general' : 'profile'}${currentRouteSearch()}`);
            }}
          >
            <Settings />
            {isAdmin ? t('userMenu.workspaceSettings') : t('userMenu.personalSettings')}
          </DropdownMenuItem>
          </DropdownMenuGroup>

          {isOpenAgentsDomain && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
              {user ? (
                <DropdownMenuItem onClick={handleSignOut} variant="destructive">
                  <LogOut />
                  {t('userMenu.signOut')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => goToCentralLogin(signIn)}>
                  <LogIn />
                  {t('userMenu.signIn')}
                </DropdownMenuItem>
              )}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
  );

  return (
    <>
      {variant === 'row' ? (
        <SidebarMenu>
          <SidebarMenuItem>{menu}</SidebarMenuItem>
        </SidebarMenu>
      ) : menu}
      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
    </>
  );
}
