'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readWorkspaceCookie, setWorkspaceCookie } from '@/lib/workspace-cookie';
import { resolveWorkspaceToken } from '@/lib/workspace-token';
import { currentRouteSearch } from '@/lib/route-search';
import { WorkspaceAccessGate } from './workspace-access-gate';
import { useT } from '@/lib/i18n';

export function SelfHostedEntry() {
  const router = useRouter();
  const t = useT();
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<'invalid' | 'unavailable' | null>(null);
  useEffect(() => {
    let active = true;
    const token = new URLSearchParams(currentRouteSearch()).get('token')?.trim();
    if (token) {
      // An explicit token takes precedence over a previous workspace cookie.
      void resolveWorkspaceToken(token).then((slug) => {
        if (!active) return;
        setWorkspaceCookie(slug, token);
        router.replace(`/${encodeURIComponent(slug)}`);
      }).catch((failure) => {
        if (!active) return;
        setError(failure instanceof Error && failure.message === 'invalid' ? 'invalid' : 'unavailable');
        setResolved(true);
      });
    } else {
      const saved = readWorkspaceCookie();
      if (saved) router.replace(`/${encodeURIComponent(saved.slug)}`);
      else setResolved(true);
    }
    return () => { active = false; };
  }, [router]);
  return resolved ? <WorkspaceAccessGate error={error} /> : (
    <div className="flex min-h-screen items-center justify-center" role="status">{t('workspaceGate.opening')}</div>
  );
}
