import React, { useMemo } from 'react';
import { ThemeProvider } from 'next-themes';

import { Toaster } from '@/components/ui/sonner';
import { DialogsProvider } from '@/components/ui/dialogs-provider';
import { OpenAgentsAuthProvider } from '@/lib/openagents-auth-context';
import { I18nProvider, detectBrowserLocale } from '@/lib/i18n';

import Home from '@/app/page';
import NotFound from '@/app/not-found';
import WorkspacePage from '@/app/[workspaceId]/page';
import SettingsLayout from '@/app/[workspaceId]/settings/layout';
import SettingsIndex from '@/app/[workspaceId]/settings/page';
import SettingsApiCredits from '@/app/[workspaceId]/settings/api-credits/page';
import SettingsDevices from '@/app/[workspaceId]/settings/devices/page';
import SettingsGeneral from '@/app/[workspaceId]/settings/general/page';
import SettingsIntegrations from '@/app/[workspaceId]/settings/integrations/page';
import SettingsMembers from '@/app/[workspaceId]/settings/members/page';
import SettingsModelAccess from '@/app/[workspaceId]/settings/model-access/page';
import SettingsPreferences from '@/app/[workspaceId]/settings/preferences/page';
import SettingsProfile from '@/app/[workspaceId]/settings/profile/page';
import SettingsSecurity from '@/app/[workspaceId]/settings/security/page';
import InvitePage from '@/app/invite/[token]/page';
import SharePage from '@/app/share/[token]/page';

import { DesktopRouter, type RouteTable } from './router';

/**
 * The desktop build's root.
 *
 * Stands in for `app/layout.tsx`, which cannot be reused as-is: it is a Server
 * Component that resolves the locale from request headers and renders <html>
 * and <body>. Everything BELOW that — the provider stack — is the same, in the
 * same order, and every page component underneath is imported from `app/`
 * untouched.
 *
 * The analytics snippets the web layout injects are deliberately absent: a
 * signed desktop binary should not fetch and run third-party script at start-up.
 */

/**
 * Next's page components take `params` as a promise and unwrap it with `use()`.
 * The promise has to be stable across renders — a fresh one each time would
 * suspend forever — so it is memoised on the values it carries.
 */
function Page({
  params,
  children,
}: {
  params: Record<string, string>;
  children: (params: Promise<Record<string, string>>) => React.ReactNode;
}): React.JSX.Element {
  const key = JSON.stringify(params);
  const promise = useMemo(() => Promise.resolve(params), [key]);
  return <>{children(promise)}</>;
}

/** A settings page, inside the layout that gives it its rail and header. */
function settingsRoute(
  pattern: string,
  Component: React.ComponentType,
): RouteTable[number] {
  return {
    pattern,
    render: (params) => (
      <Page params={params}>
        {(promise) => (
          <SettingsLayout params={promise as Promise<{ workspaceId: string }>}>
            <Component />
          </SettingsLayout>
        )}
      </Page>
    ),
  };
}

/**
 * The app's routes, mirroring the `app/` directory. Most specific first: the
 * matcher takes the first pattern that fits, and `/:workspaceId` would
 * otherwise swallow `/invite/abc`.
 */
const ROUTES: RouteTable = [
  { pattern: '/', render: () => <Home /> },
  {
    pattern: '/invite/:token',
    render: (params) => (
      <Page params={params}>
        {(promise) => <InvitePage params={promise as Promise<{ token: string }>} />}
      </Page>
    ),
  },
  {
    pattern: '/share/:token',
    render: (params) => (
      <Page params={params}>
        {(promise) => <SharePage params={promise as Promise<{ token: string }>} />}
      </Page>
    ),
  },
  settingsRoute('/:workspaceId/settings', SettingsIndex),
  settingsRoute('/:workspaceId/settings/api-credits', SettingsApiCredits),
  settingsRoute('/:workspaceId/settings/devices', SettingsDevices),
  settingsRoute('/:workspaceId/settings/general', SettingsGeneral),
  settingsRoute('/:workspaceId/settings/integrations', SettingsIntegrations),
  settingsRoute('/:workspaceId/settings/members', SettingsMembers),
  settingsRoute('/:workspaceId/settings/model-access', SettingsModelAccess),
  settingsRoute('/:workspaceId/settings/preferences', SettingsPreferences),
  settingsRoute('/:workspaceId/settings/profile', SettingsProfile),
  settingsRoute('/:workspaceId/settings/security', SettingsSecurity),
  {
    pattern: '/:workspaceId',
    render: (params) => (
      <Page params={params}>
        {(promise) => (
          <WorkspacePage params={promise as Promise<{ workspaceId: string }>} />
        )}
      </Page>
    ),
  },
];

export default function App(): React.JSX.Element {
  // The web build resolves this on the server from cookie and Accept-Language;
  // here there is only the machine the app is running on.
  // `null` means nothing on this machine points at a supported locale; the
  // provider's own default covers that.
  const locale = useMemo(() => detectBrowserLocale() ?? undefined, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider initialLocale={locale} hasStoredLocale={false}>
        <OpenAgentsAuthProvider>
          <DialogsProvider>
            <DesktopRouter routes={ROUTES} notFound={<NotFound />} />
          </DialogsProvider>
        </OpenAgentsAuthProvider>
        <Toaster />
      </I18nProvider>
    </ThemeProvider>
  );
}
