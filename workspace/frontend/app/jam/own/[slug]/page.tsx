'use client';

import { use } from 'react';
import { OwnerJam } from '@/components/share/owner-jam';

/**
 * The owner page for a workspace made by OpenAgents Jam:
 * `/jam/own/<slug>?token=<workspace token>`. One thread, the guest link,
 * and "Keep this conversation" — not the full workspace UI.
 */
export default function OwnerJamPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { slug } = use(params);
  const query = use(searchParams);
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  return <OwnerJam slug={slug} token={token || ''} />;
}
