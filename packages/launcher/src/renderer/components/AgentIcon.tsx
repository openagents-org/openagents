import React from "react"
import { cn } from "../lib/utils"

const BUNDLED_SLUGS = new Set([
  "aider",
  "amp",
  "antigravity",
  "claude",
  "cline",
  "codearts",
  "codebuddy",
  "codex",
  "commandcode",
  "copilot",
  "cursor",
  "deepseek",
  "default",
  "gemini",
  "goose",
  "hermes",
  "kimi",
  "kiro",
  "mimo-code",
  "nanoclaw",
  "openai",
  "openclaw",
  "opencode",
  "openworker",
  "pi",
  "qoder",
  "qoder-cn",
  "qwen-code",
  "yaml-agent",
])

interface AgentIconProps {
  type: string
  /** The icon's edge, in px. */
  size?: number
  /**
   * Draw every icon on the same rounded chip — for avatars stacked over each
   * other, where a bare mark with nothing behind it would run into its
   * neighbours. Tiles fill the chip; bare marks sit inset on the surface.
   */
  chip?: boolean
  className?: string
}

/**
 * Agents whose official icon is a bare full-colour mark rather than an app
 * tile (Qwen's blue mark, Gemini's spark). They are drawn as they are, with no
 * tile behind them; colour marks stay legible on either theme.
 */
const BARE_SLUGS = new Set([
  "antigravity",
  "codearts",
  "codex",
  "deepseek",
  "gemini",
  "goose",
  "nanoclaw",
  "openclaw",
  "qwen-code",
])

/**
 * Bare marks that are a single colour. They are drawn as a mask filled with
 * the text colour — black on the light theme, light on the dark one — where an
 * <img> would leave them black and lost on a dark surface.
 */
const MONO_SLUGS = new Set(["goose"])

/**
 * An agent's icon, drawn the way the vendor draws it. Most are app tiles — a
 * full-bleed rounded square with its own background (the vendor's app icon, or
 * the mark on white or black where there is none) — and get a hairline so a
 * white tile's edge shows on a white surface. Bare marks get neither.
 */
export default function AgentIcon({
  type,
  size = 24,
  chip = false,
  className,
}: AgentIconProps): React.JSX.Element {
  const slug = (type || "").toLowerCase().replace(/[^a-z0-9-]/g, "")
  const iconSlug = BUNDLED_SLUGS.has(slug) ? slug : "default"
  const src = `icons/${iconSlug}.svg`
  const bare = BARE_SLUGS.has(iconSlug)
  // A bare mark filling its box reads larger than a tile's mark does, so it
  // is inset — further on a chip, which has a surface of its own.
  const mark = bare ? Math.round(size * (chip ? 0.72 : 0.8)) : size
  const image = MONO_SLUGS.has(iconSlug) ? (
    <span
      role="img"
      aria-label={type}
      className="bg-foreground"
      style={{ width: mark, height: mark, maskImage: `url(${src})`, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" }}
    />
  ) : (
    <img src={src} width={mark} height={mark} alt={type} />
  )
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        (!bare || chip) && "overflow-hidden ring-1 ring-black/10 dark:ring-white/10",
        bare && chip && "bg-card",
        size >= 48 ? "rounded-xl" : size >= 32 ? "rounded-lg" : "rounded-md",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {image}
    </span>
  )
}
