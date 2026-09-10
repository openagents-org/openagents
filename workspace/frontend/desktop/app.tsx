import React, { useEffect, useMemo } from 'react';
import { ThemeProvider, useTheme } from 'next-themes';

import { Toaster } from '@/components/ui/sonner';
import { DialogsProvider } from '@/components/ui/dialogs-provider';
import { OpenAgentsAuthProvider } from '@/lib/openagents-auth-context';
import { I18nProvider, isLocale, useI18n, detectBrowserLocale } from '@/lib/i18n';

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
import { reportLocale, reportTheme, useHostAppearance } from './host';

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
 * A promise `use()` can read without waiting.
 *
 * React reads `status`/`value` off a thenable and returns it synchronously
 * when they are there — the convention Next.js itself follows for the params
 * it hands a page. A bare `Promise.resolve()` has neither, so `use()` suspends
 * instead; see Page below for why that is fatal here.
 */
type Fulfilled<T> = Promise<T> & { status: 'fulfilled'; value: T };

function fulfilled<T>(value: T): Fulfilled<T> {
  const promise = Promise.resolve(value) as Fulfilled<T>;
  promise.status = 'fulfilled';
  promise.value = value;
  return promise;
}

/**
 * Next's page components take `params` as a promise and unwrap it with `use()`.
 *
 * Handing them a plain resolved promise suspends the first render of every
 * page that takes params, and there is no Suspense boundary above the router
 * to catch it: React ends the render with "an unknown Component is an async
 * Client Component" and the window goes blank. Every route except `/` takes
 * params, so that was the whole app.
 *
 * Memoised on the values it carries — a fresh promise per render would be a
 * fresh identity for `use()` on every pass.
 */
function Page({
  params,
  children,
}: {
  params: Record<string, string>;
  children: (params: Promise<Record<string, string>>) => React.ReactNode;
}): React.JSX.Element {
  const key = JSON.stringify(params);
  const promise = useMemo(() => fulfilled(params), [key]);
  return <>{children(promise)}</>;
}

/**
 * A settings page, inside the layout that gives it its rail and header.
 *
 * The page gets `params` as well as the layout. Most settings pages ignore it
 * — they read the workspace from context — but the index page takes it and
 * unwraps it with `use()`, and `use(undefined)` throws hard enough to blank
 * the window. It only showed once the layout had LOADED, since a failing
 * layout never renders its children, which is why "open workspace settings"
 * was a white screen while every other route looked fine.
 *
 * Passing it to all of them costs nothing: a component that does not name the
 * prop never sees it.
 */
function settingsRoute(
  pattern: string,
  Component: React.ComponentType<{ params: Promise<{ workspaceId: string }> }>,
): RouteTable[number] {
  return {
    pattern,
    render: (params) => (
      <Page params={params}>
        {(promise) => {
          const workspaceParams = promise as Promise<{ workspaceId: string }>;
          return (
            <SettingsLayout params={workspaceParams}>
              <Component params={workspaceParams} />
            </SettingsLayout>
          );
        }}
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
  const host = useHostAppearance();

  // The host's language when there is one; otherwise the machine's, since
  // there is no server here to resolve it from a cookie and Accept-Language.
  // `undefined` lets the provider fall back to its own default.
  const initialLocale = useMemo(() => {
    const fromHost = host?.locale;
    if (fromHost && isLocale(fromHost)) return fromHost;
    return detectBrowserLocale() ?? undefined;
    // Deliberately only the first value: this is an INITIAL locale, and later
    // changes are applied by AppearanceSync rather than by remounting the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider initialLocale={initialLocale} hasStoredLocale={!!host}>
        <AppearanceSync />
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

/**
 * Keeps the two halves of the window agreeing about theme and language.
 *
 * Both directions, so a change made in the launcher's menu and one made in
 * this app's own menu have the same effect. Each side only acts on a value
 * that differs from what it already holds, which is what stops the two from
 * handing a change back and forth forever.
 *
 * Renders nothing; it exists for the effects. On the web `useHostAppearance`
 * returns null and every branch here is skipped.
 */
function AppearanceSync(): null {
  const host = useHostAppearance();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useI18n();

  // Host → app.
  useEffect(() => {
    if (!host) return;
    if (host.theme && host.theme !== theme) setTheme(host.theme);
    if (host.locale && host.locale !== locale && isLocale(host.locale)) {
      setLocale(host.locale);
    }
  }, [host, theme, locale, setTheme, setLocale]);

  // App → host. `theme` is undefined until next-themes has read storage.
  useEffect(() => {
    if (!host || !theme || theme === host.theme) return;
    reportTheme(theme);
  }, [host, theme]);

  useEffect(() => {
    if (!host || locale === host.locale) return;
    reportLocale(locale);
  }, [host, locale]);

  return null;
}
