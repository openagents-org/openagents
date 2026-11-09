'use client';

/* eslint-disable @next/next/no-img-element */

import { cn } from '@/lib/utils';
import { Wallet } from 'lucide-react';

interface IconProps {
  className?: string;
  size?: number;
}

const ICON_BASE = typeof window !== 'undefined' && (window as unknown as { api?: unknown }).api ? 'icons' : '/icons/agents';

/**
 * Icons whose official form is a bare full-colour mark rather than an app tile
 * (Qwen's blue mark, Gemini's spark, most model providers). They are drawn as
 * they are, with no tile behind them; colour marks stay legible on either theme.
 */
const BARE = new Set([
  'antigravity', 'codearts', 'codex', 'deepseek', 'gemini', 'goose', 'nanoclaw',
  'openclaw', 'qwen-code',
  'cerebras', 'fal', 'fireworks', 'google', 'mistral', 'perplexity', 'sambanova',
  'sensenova', 'stability', 'together',
]);

/**
 * Bare marks that are a single colour. They are drawn as a mask filled with
 * the text colour — black on the light theme, light on the dark one — where an
 * <img> would leave them black and lost on a dark surface.
 */
const MONO = new Set(['goose']);

/**
 * An icon drawn the way the vendor draws it. Most are app tiles — a full-bleed
 * rounded square with its own background (the vendor's app icon, or the mark
 * on white or black where there is none) — and get a hairline so a white
 * tile's edge shows on a white surface. Bare marks get neither.
 */
function IconWrapper({ name, size = 20, chip = false, className }: { name: string; chip?: boolean } & IconProps) {
  const bare = BARE.has(name);
  const src = `${ICON_BASE}/${name}.svg`;
  // A bare mark filling its box reads larger than a tile's mark does, so it
  // is inset — further on a chip, which has a surface of its own.
  const mark = bare ? Math.round(size * (chip ? 0.72 : 0.8)) : size;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        (!bare || chip) && 'overflow-hidden ring-1 ring-black/10 dark:ring-white/10',
        bare && chip && 'bg-background',
        size >= 48 ? 'rounded-xl' : size >= 32 ? 'rounded-lg' : 'rounded-md',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {MONO.has(name) ? (
        <span
          role="img"
          aria-label={name}
          className="bg-foreground"
          style={{
            width: mark,
            height: mark,
            maskImage: `url(${src})`,
            maskSize: 'contain',
            maskRepeat: 'no-repeat',
            maskPosition: 'center',
          }}
        />
      ) : (
        <img
          src={src}
          alt={name}
          width={mark}
          height={mark}
          onError={(e) => {
            (e.target as HTMLImageElement).src = `${ICON_BASE}/default.svg`;
          }}
        />
      )}
    </span>
  );
}

/**
 * `chip` draws every icon on the same rounded chip — for avatars stacked over
 * each other, where a bare mark with nothing behind it would run into its
 * neighbours.
 */
export function AgentIcon({ name, className, size = 20, chip }: { name: string; chip?: boolean } & IconProps) {
  return <IconWrapper name={name} size={size} chip={chip} className={className} />;
}

export function ProviderIcon({ name, className, size = 20 }: { name: string } & IconProps) {
  if (name === 'tokenpay') return <Wallet size={size} className={cn('shrink-0', className)} />;
  return <IconWrapper name={name} size={size} className={className} />;
}
