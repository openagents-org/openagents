import React from "react"

/** Longer than this, an argument may break inside itself rather than overflow. */
const UNBROKEN_MAX = 40

/**
 * A shell command that wraps between its arguments only. Browsers also break
 * after a hyphen, which split "@anthropic-ai/claude-code" into
 * "@anthropic-" / "ai/claude-code". Each argument stays whole unless it is too
 * long to fit a line (a deep --prefix path), where it may break anywhere
 * instead of widening its container. Copying still yields the plain command.
 */
export function CommandText({ command }: { command: string }): React.JSX.Element {
  return (
    <>
      {command.split(/(\s+)/).map((part, i) =>
        part.trim() && part.length <= UNBROKEN_MAX
          ? <span key={i} className="whitespace-nowrap">{part}</span>
          : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  )
}
