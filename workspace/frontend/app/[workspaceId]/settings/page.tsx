'use client';

import { use, useEffect } from 'react';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { useRouter } from 'next/navigation';
import { currentRouteSearch } from '@/lib/route-search';

/** /settings has no content of its own — land on the General section,
 * preserving any ?token= so token-link visitors keep access. */
export default function SettingsIndexPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);
  const router = useRouter();
  const { me } = useAdminSettings();
  const section = canAdminister(me) ? 'general' : 'profile';

  useEffect(() => {
    router.replace(`/${workspaceId}/settings/${section}${currentRouteSearch()}`);
  }, [router, workspaceId, section]);

  return null;
}
