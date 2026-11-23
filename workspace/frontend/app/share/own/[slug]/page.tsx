'use client';

import { use } from 'react';
import { OwnerRoom } from '@/components/share/owner-room';

/**
 * The owner's light room for a workspace made by OpenAgents Share:
 * `/share/own/<slug>?token=<workspace token>`. One thread, the guest link,
 * and "Keep this conversation" — not the full workspace UI.
 */
export default function OwnerRoomPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { slug } = use(params);
  const query = use(searchParams);
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  return <OwnerRoom slug={slug} token={token || ''} />;
}
