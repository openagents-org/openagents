'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check, KeyRound, LayoutGrid, LogIn, LogOut, Monitor, Moon, Settings, Shield, Sun, User, UserPlus, MessageSquarePlus } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
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
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin, goToCentralLogout } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';
import { LanguageMenuSub } from './language-menu';
import { FeedbackDialog } from '@/components/feedback/feedback-dialog';

interface UserMenuProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

// System first — it is the default, and the one most people leave it on.
const THEME_OPTIONS = [
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
] as const;

export function UserMenu({ side, align = 'end' }: UserMenuProps = {}) {
  const { workspace, token } = useWorkspace();
  const { user, isOpenAgentsDomain, signIn, signOut } = useOpenAgentsAuth();
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={user?.email || t('userMenu.account')}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {user ? (
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {user.email[0].toUpperCase()}
              </span>
            ) : (
              <User className="size-4" />
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side={side} align={align} sideOffset={8} className="w-60">
          {user && (
            <>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{user.email}</span>
                {isOwnedByUser && (
                  <span className="flex items-center gap-1 text-[11px] font-normal text-emerald-600">
                    <Shield className="size-3" /> {t('userMenu.ownsWorkspace')}
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}

          {isOpenAgentsDomain && user && (
            <>
              <DropdownMenuItem onClick={() => { window.location.href = '/'; }}>
                <LayoutGrid />
                {t('userMenu.switchWorkspace')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ActiveThemeIcon />
              {t('theme.label')}
              <span className="ms-auto pe-1 text-xs text-muted-foreground">
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

          {token && (
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleCopyToken(); }}>
              {tokenCopied ? <Check /> : <KeyRound />}
              {tokenCopied ? t('userMenu.tokenCopied') : t('userMenu.copyToken')}
            </DropdownMenuItem>
          )}

          {/* Straight to the Members section's invite box — the most common
              admin action gets its own entry. */}
          <DropdownMenuItem
            onClick={() => {
              if (!workspace) return;
              router.push(`/${workspace.slug}/settings/members${window.location.search}`);
            }}
          >
            <UserPlus />
            {t('userMenu.inviteMembers')}
          </DropdownMenuItem>

          {/* Feedback goes to POST /v1/feedback (stored + forwarded to the
              team) — the cheapest possible path from an annoyed user to us. */}
          <DropdownMenuItem onClick={() => setShowFeedback(true)}>
            <MessageSquarePlus />
            {t('userMenu.sendFeedback')}
          </DropdownMenuItem>

          {/* Full-page admin dashboard (general / members / security / devices /
              integrations / preferences). window.location.search carries an
              incoming ?token= through so token-link visitors keep access. */}
          <DropdownMenuItem
            onClick={() => {
              if (!workspace) return;
              router.push(`/${workspace.slug}/settings${window.location.search}`);
            }}
          >
            <Settings />
            {t('userMenu.workspaceSettings')}
          </DropdownMenuItem>

          {isOpenAgentsDomain && (
            <>
              <DropdownMenuSeparator />
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
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {showFeedback && <FeedbackDialog onClose={() => setShowFeedback(false)} />}
    </>
  );
}
