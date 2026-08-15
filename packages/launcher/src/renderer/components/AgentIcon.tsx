import React from "react"
import { cn } from "../lib/utils"

const BUNDLED_SLUGS = new Set([
  "aider",
  "amp",
  "claude",
  "cline",
  "codex",
  "copilot",
  "cursor",
  "default",
  "gemini",
  "goose",
  "hermes",
  "kimi",
  "nanoclaw",
  "openai",
  "openclaw",
  "opencode",
  "pi",
  "yaml-agent",
])

interface AgentIconProps {
  type: string
  size?: number
  className?: string
}

export default function AgentIcon({
  type,
  size = 24,
  className,
}: AgentIconProps): React.JSX.Element {
  const slug = (type || "").toLowerCase().replace(/[^a-z0-9-]/g, "")
  const iconSlug = BUNDLED_SLUGS.has(slug) ? slug : "default"
  return (
    <img
      src={`icons/${iconSlug}.svg`}
      width={size}
      height={size}
      alt={type}
      className={cn("rounded-md shrink-0", className)}
    />
  )
}
