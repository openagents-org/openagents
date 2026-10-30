"use client";

import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from './human-avatar';

/** The counterpart, or both participants when observing an agent-to-agent DM. */
export function DmAvatars({ addresses }: { addresses: string[] }) {
  return <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
    {addresses.map(address => address.startsWith('human:')
      ? <HumanAvatar key={address} email={address.slice('human:'.length)} className="size-6" />
      : <AgentAvatar key={address} name={address.replace(/^openagents:/, '')} size={24} />)}
  </span>;
}
