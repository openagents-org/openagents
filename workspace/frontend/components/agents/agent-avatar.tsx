'use client';

import Avatar from 'boring-avatars';
import { cn } from '@/lib/utils';
import { AgentIcon, hasIcon, iconRadius } from '@/components/icons/agent-icons';
import { useAgentType } from './agent-types';

const OA_PALETTE = ['#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B'];

// The built-in Yumi assistant has a fixed brand avatar instead of a generated
// one. Its agent name is reserved/unique (provider "openagents"), so matching
// on the name is sufficient to identify it wherever an avatar is rendered.
const YUMI_AVATAR_SRC = '/yumi-avatar.png';
const isYumi = (name: string) => (name || '').toLowerCase() === 'yumi';

/**
 * The icon an agent of `type` is drawn with: its own for a local agent, its
 * provider's for a cloud one (`cloud:openai`). Null when there is none — no
 * type, one without an icon, or the generic default/custom marks, which would
 * make unrelated agents look alike.
 */
export function avatarIconFor(type: string | null | undefined): string | null {
  const name = (type || '').toLowerCase().replace(/^cloud:/, '');
  if (!name || name === 'default' || name === 'custom') return null;
  return hasIcon(name) ? name : null;
}

interface AgentAvatarProps {
  name: string;
  /** The agent's type. Omit to look it up by name among the agents in scope. */
  type?: string | null;
  size?: number;
  status?: string;
  showStatus?: boolean;
  className?: string;
  square?: boolean;
  /** On the page colour, ringed in it, for avatars stacked over each other. */
  stacked?: boolean;
}

/**
 * An agent's avatar: its type's icon, so agents read as Claude Code, Codex… at
 * a glance. Drawn plain — no frame, and no white behind a mark — so it sits on
 * the workspace's own background; vendor tiles in a colour keep it. Agents of
 * the same type share the icon; their names tell them apart. An agent whose
 * type has no icon gets a pattern generated from its name.
 */
export function AgentAvatar({ name, type, size = 28, status, showStatus = false, className, square = false, stacked = false }: AgentAvatarProps) {
  const knownType = useAgentType(name);
  const icon = isYumi(name) ? null : avatarIconFor(type === undefined ? knownType : type);
  const shape = icon ? iconRadius(size) : square ? 'rounded-lg' : 'rounded-full';
  return (
    // Stacked, the box is filled with the page colour so the icon before it
    // does not show through a mark with no tile of its own.
    <div className={cn('relative flex shrink-0', stacked && ['bg-background ring-2 ring-background', shape], className)} style={{ width: size, height: size }}>
      {icon ? (
        <AgentIcon name={icon} size={size} plain />
      ) : (
        <div className={cn(shape, 'overflow-hidden')} style={{ width: size, height: size }}>
          {isYumi(name) ? (
            <img
              src={YUMI_AVATAR_SRC}
              alt="Yumi"
              width={size}
              height={size}
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            <Avatar name={name} size={size} variant="beam" colors={OA_PALETTE} square={square} />
          )}
        </div>
      )}
      {showStatus && (
        <span className={cn(
          'absolute -bottom-0.5 -right-0.5 rounded-full border-[1.5px] border-background',
          size >= 28 ? 'size-2.5' : 'size-2',
          // Same dots for everyone: green online, amber waiting for a person
          // (a pending approval), grey offline.
          status === 'online' ? 'bg-green-500'
            : status === 'waiting' ? 'bg-amber-400 ring-2 ring-amber-400/30'
            : 'bg-zinc-300 dark:bg-zinc-600'
        )} />
      )}
    </div>
  );
}
