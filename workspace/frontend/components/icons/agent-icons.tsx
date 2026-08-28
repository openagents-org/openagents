'use client';

/* eslint-disable @next/next/no-img-element */

import { cn } from '@/lib/utils';

interface IconProps {
  className?: string;
  size?: number;
}

const ICON_BASE = '/icons/agents';

const NEEDS_BG = new Set([
  'claude', 'codex', 'cline', 'amp', 'goose', 'openclaw', 'copilot',
  'nanoclaw', 'opencode', 'cursor', 'hermes', 'kimi', 'default',
  'xai', 'replicate', 'elevenlabs', 'manus', 'commandcode',
]);

function IconWrapper({ name, size = 20, className }: { name: string } & IconProps) {
  const needsBg = NEEDS_BG.has(name);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md shrink-0',
        needsBg && 'bg-white dark:bg-zinc-200 p-0.5',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={`${ICON_BASE}/${name}.svg`}
        alt={name}
        width={needsBg ? size - 4 : size}
        height={needsBg ? size - 4 : size}
        onError={(e) => {
          (e.target as HTMLImageElement).src = `${ICON_BASE}/default.svg`;
        }}
      />
    </span>
  );
}

export function AgentIcon({ name, className, size = 20 }: { name: string } & IconProps) {
  return <IconWrapper name={name} size={size} className={className} />;
}

export function ProviderIcon({ name, className, size = 20 }: { name: string } & IconProps) {
  return <IconWrapper name={name} size={size} className={className} />;
}
