'use client';

import { useEffect, useState } from 'react';
import {
  Check, KeyRound, LogIn, LogOut, Monitor, Moon, Settings, Shield, Sun, User,
} from 'lucide-react';
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
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { SettingsDialog } from './settings-dialog';

interface UserMenuProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

// System first — it is the default, and the one most people leave it on.
const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const;

export function UserMenu({ side, align = 'end' }: UserMenuProps = {}) {
  const { workspace, token, refreshWorkspace } = useWorkspace();
  const { user, isOpenAgentsDomain, signIn, signOut } = useOpenAgentsAuth();
  const { theme, setTheme } = useTheme();
  const confirm = useConfirm();
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
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

  const isUnclaimed = workspace && !workspace.creatorEmail;
  const isOwnedByUser = workspace && user && workspace.creatorEmail === user.email;

  const handleCopyToken = async () => {
    if (!token) {
      toast.error('No management token available');
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
      toast.success('Management token copied');
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      toast.error('Failed to copy token');
    }
  };

  // Signing out drops the session on this device — cheap to redo, but not
  // something to trigger from a stray click on a menu item that sits one row
  // below "Workspace settings".
  const handleSignOut = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      description: user
        ? `You'll be signed out of ${user.email} on this device. The workspace and its threads stay as they are.`
        : "You'll be signed out on this device.",
      confirmText: 'Sign out',
      destructive: true,
    });
    if (ok) signOut();
  };

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await workspaceApi.claimWorkspace();
      await refreshWorkspace();
      toast.success('Workspace claimed successfully');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to claim workspace');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={user?.email || 'Account'}
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
                    <Shield className="size-3" /> You own this workspace
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ActiveThemeIcon />
              Theme
              <span className="ms-auto pe-1 text-xs text-muted-foreground">
                {activeThemeOption.label}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-36">
                <DropdownMenuRadioGroup value={activeTheme} onValueChange={setTheme}>
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value} className="gap-2">
                      <Icon className="size-4 opacity-60" />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          {token && (
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleCopyToken(); }}>
              {tokenCopied ? <Check /> : <KeyRound />}
              {tokenCopied ? 'Copied!' : 'Copy workspace token'}
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
            <Settings />
            Workspace settings
          </DropdownMenuItem>

          {isOpenAgentsDomain && user && isUnclaimed && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={claiming}
                onSelect={(e) => { e.preventDefault(); handleClaim(); }}
              >
                <Shield />
                {claiming ? 'Claiming…' : 'Claim workspace'}
              </DropdownMenuItem>
            </>
          )}

          {isOpenAgentsDomain && (
            <>
              <DropdownMenuSeparator />
              {user ? (
                <DropdownMenuItem onClick={handleSignOut} variant="destructive">
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={signIn}>
                  <LogIn />
                  Sign in
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        workspace={workspace}
        refreshWorkspace={refreshWorkspace}
      />
    </>
  );
}
