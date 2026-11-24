'use client';

import { use, useMemo } from 'react';
import { guestResourceSource } from '@/lib/share-resources';
import { GuestLinkState } from '@/components/guest-thread/guest-link-state';
import { GuestThreadView } from '@/components/guest-thread/guest-thread-view';
import { ContinueInWorkspace } from '@/components/guest-thread/continue-in-workspace';
import { useGuestThread } from '@/components/guest-thread/use-guest-thread';

/**
 * Guest view of one shared thread. Opened from a link without an account:
 * no workspace provider, no auth token, only the public thread-link API.
 */
export default function SharedThreadPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ preview?: string | string[] }>;
}) {
  const { token } = use(params);
  const query = searchParams ? use(searchParams) : {};
  // `?preview=1`: the owner's preview — read only, no name prompt, nothing posts.
  const preview = (Array.isArray(query.preview) ? query.preview[0] : query.preview) === '1';
  const thread = useGuestThread(token, { preview });
  const resourceSource = useMemo(() => guestResourceSource(token), [token]);

  if (thread.status !== 'ready' || !thread.info) {
    return <GuestLinkState state={thread.status === 'ready' ? 'loading' : thread.status} onRetry={() => { void thread.reload(); }} />;
  }

  return (
    <GuestThreadView
      info={thread.info}
      messages={thread.messages}
      hasOlder={thread.hasOlder}
      olderState={thread.olderState}
      onLoadOlder={thread.loadOlder}
      guest={thread.guest}
      nameRequest={thread.nameRequest}
      sendTick={thread.sendTick}
      send={thread.send}
      retry={thread.retry}
      join={preview ? undefined : thread.join}
      cancelName={preview ? undefined : thread.cancelName}
      headerActions={preview ? undefined : <ContinueInWorkspace token={token} />}
      resourceSource={resourceSource}
      removed={!preview && thread.removed}
      preview={preview}
      pinStorageKey={`oa-share-pin-closed:${token}`}
    />
  );
}
