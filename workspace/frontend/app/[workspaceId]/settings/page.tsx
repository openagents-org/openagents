'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** /settings has no content of its own — land on the General section,
 * preserving any ?token= so token-link visitors keep access. */
export default function SettingsIndexPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);
  const router = useRouter();

  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    router.replace(`/${workspaceId}/settings/general${search}`);
  }, [router, workspaceId]);

  return null;
}
