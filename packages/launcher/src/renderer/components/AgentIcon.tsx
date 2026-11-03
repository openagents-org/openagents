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
  /** The tile's edge, in px; the mark sits inside it with a margin. */
  size?: number
  className?: string
}

/**
 * An agent's mark on a light tile, the same in both themes — white, and
 * zinc-200 in dark mode, as the workspace web app draws them.
 *
 * Most of the marks are near-black (several are drawn in `currentColor`, which
 * an <img> can only resolve to black), so on the dark theme's surfaces they
 * all but disappeared. A tile of its own keeps every mark legible on any
 * surface without a second set of artwork per theme.
 */
export default function AgentIcon({
  type,
  size = 24,
  className,
}: AgentIconProps): React.JSX.Element {
  const slug = (type || "").toLowerCase().replace(/[^a-z0-9-]/g, "")
  const iconSlug = BUNDLED_SLUGS.has(slug) ? slug : "default"
  // The larger the tile, the more room around the mark: at a tenth a side, a
  // 64px banner tile was filled edge to edge by a black blob. Roughly half the
  // tile at hero sizes, as the workspace draws it, and close to full in a row.
  const mark = Math.round(size * (size >= 48 ? 0.56 : size >= 32 ? 0.66 : 0.8))
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border bg-white dark:bg-zinc-200",
        size >= 48 ? "rounded-xl" : size >= 32 ? "rounded-lg" : "rounded-md",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img src={`icons/${iconSlug}.svg`} width={mark} height={mark} alt={type} />
    </span>
  )
}
