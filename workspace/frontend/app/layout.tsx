import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { workspaceAnalyticsScript } from '@/lib/posthog-config';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { OpenAgentsAuthProvider } from '@/lib/openagents-auth-context';
import { DialogsProvider } from '@/components/ui/dialogs-provider';
import { I18nProvider } from '@/lib/i18n';
import { MaintenanceBanner } from '@/components/maintenance/maintenance-banner';
import { getServerTranslations, resolveLocale } from '@/lib/i18n/server';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'] });

// Analytics identifiers are injected via Vercel env vars (Project → Settings →
// Environment Variables) rather than hardcoded. NEXT_PUBLIC_* values are inlined
// into the client bundle at build time. When a key is unset the corresponding
// snippet is skipped entirely, so analytics simply no-ops (e.g. local dev or
// preview deploys without the vars configured).
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://d.openagents.org';
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const analyticsScript = workspaceAnalyticsScript(POSTHOG_KEY, POSTHOG_HOST, process.env.VERCEL_ENV);

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslations();
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    ...staticMetadata,
  };
}

const staticMetadata: Metadata = {
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolved per request from the persisted cookie, then `Accept-Language`,
  // then the edge geo header. Doing it here — rather than detecting in the
  // browser — means the first paint is already in the right language and SSR
  // and hydration agree on the markup.
  const { locale, hasStoredLocale } = await resolveLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {analyticsScript && (
          <Script id="posthog-init" strategy="afterInteractive">{analyticsScript}</Script>
        )}
        {GA_ID && (
        <>
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}</Script>
        </>
        )}
      </head>
      {/* `suppressHydrationWarning` here is for the browser, not for us:
          extensions routinely stamp attributes onto <body> (cz-shortcut-listen,
          grammarly-*, …) before React hydrates, and each one raises a mismatch
          that buries real warnings. Scoped to this element — children still
          report normally. */}
      <body
        className={`${inter.className} bg-zinc-100 dark:bg-zinc-900`}
        suppressHydrationWarning
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <I18nProvider initialLocale={locale} hasStoredLocale={hasStoredLocale}>
            <MaintenanceBanner />
            {/* Legacy email/password AuthProvider was removed in v1.0 —
                Firebase (OpenAgentsAuthProvider) is the sole identity path. */}
            <OpenAgentsAuthProvider>
              <DialogsProvider>
                {children}
              </DialogsProvider>
            </OpenAgentsAuthProvider>
            <Toaster />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
