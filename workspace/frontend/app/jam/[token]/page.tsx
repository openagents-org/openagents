'use client';

import { use, useCallback, useMemo, useRef, useState } from 'react';
import { AddAgentDialog } from '@/components/guest-thread/add-agent-dialog';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
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
  const { user, idToken, loading, signIn, signOut } = useOpenAgentsAuth();
  const idTokenRef = useRef(idToken);
  idTokenRef.current = idToken;
  const getIdToken = useCallback(() => idTokenRef.current, []);
  // Invite-only jams: the signed-in account is the guest (its bearer goes on every call).
  const thread = useGuestThread(token, {
    preview,
    auth: { idToken: getIdToken, signedIn: !!user && !!idToken, ready: !loading, displayName: user?.displayName || user?.email || null },
  });
  const resourceSource = useMemo(() => guestResourceSource(token), [token]);
  const [addAgentOpen, setAddAgentOpen] = useState(false);

  if (thread.status !== 'ready' || !thread.info) {
    return (
      <GuestLinkState
        state={thread.status === 'ready' ? 'loading' : thread.status}
        onRetry={() => { void thread.reload(); }}
        email={thread.deniedEmail}
        preview={preview}
        onSignIn={() => goToCentralLogin(() => { void signIn(); })}
        onSwitchAccount={() => { void signOut().finally(() => goToCentralLogin(() => { void signIn(); })); }}
      />
    );
  }

  const info = thread.info;
  // Guests may bring their own agent when the owner allows it (and remove what they brought).
  const canBring = !preview && !thread.removed && info.canPost && !!info.allowGuestAgents;
  const openAddAgent = () => {
    if (thread.needsName()) thread.requestName(() => setAddAgentOpen(true));
    else setAddAgentOpen(true);
  };
  return (
    <>
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
      agentActions={preview ? undefined : {
        canAdd: canBring,
        onAdd: openAddAgent,
        canRemove: (agent) => !!agent.mine,
        onRemove: thread.removeAgent,
      }}
    />
    {canBring && (
      <AddAgentDialog open={addAgentOpen} onOpenChange={setAddAgentOpen} viewer="guest" firstAgent={info.agents[0]?.name ?? null}
        onAdd={thread.bringAgent} onNeedName={() => { setAddAgentOpen(false); thread.requestName(() => setAddAgentOpen(true)); }} />
    )}
    </>
  );
}
