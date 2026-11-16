'use client';

import { useHumanNames } from '@/hooks/use-team-roster';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import { dmCounterpart as dmCounterpartOf, dmPair, myAddress } from '@/lib/dm';
import type { WorkspaceAgent } from '@/lib/types';

/**
 * DM pair analysis: when the viewer (a human) is part of the pair, the DM is
 * writable and titled by the counterpart alone. Agent↔agent DMs stay a
 * read-only observation view.
 */
export function useThreadDm(currentSessionId: string | null, currentUser: Parameters<typeof myAddress>[0], agents: WorkspaceAgent[]) {
  const t = useT();
  const humanNames = useHumanNames();
  const isDM = currentSessionId?.startsWith('dm:') ?? false;
  const myAddr = myAddress(currentUser);
  const pairAddrs = isDM ? dmPair(currentSessionId) : [];
  const counterpart = isDM ? dmCounterpartOf(pairAddrs, myAddr) : null;
  const writable = isDM && !!counterpart;
  // DM titles show the display label; the session id / addresses stay canonical.
  const addrLabel = (addr: string) => {
    const name = addr.replace(/^openagents:/, '').replace(/^human:/, '');
    if (addr.startsWith('human:') && humanNames[name.toLowerCase()]) return humanNames[name.toLowerCase()];
    const a = agents.find((x) => x.agentName === name);
    return a ? agentLabel(a) : name;
  };
  const title = isDM
    ? (counterpart
        ? counterpart === myAddr ? t('threads.you') : addrLabel(counterpart)
        : pairAddrs.map(addrLabel).join(' ↔ '))
    : null;
  const withPerson = isDM && !!counterpart?.startsWith('human:');
  return { isDM, myAddr, pairAddrs, counterpart, writable, title, withPerson, self: counterpart === myAddr };
}
