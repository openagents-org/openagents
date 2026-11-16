import * as React from "react"

import { Badge } from "@renderer/components/ui/badge"
import { cn } from "@renderer/lib/utils"

export type StatusBadgeTone = "success" | "warning" | "danger" | "neutral"

const DOT: Record<StatusBadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground",
}

const TEXT: Record<StatusBadgeTone, string> = {
  success: "text-foreground",
  warning: "text-foreground",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
}

/**
 * A status chip in the neutral theme: shadcn's outline badge with a dot. The
 * colour sits on the dot alone, never as a tinted block; an error also keeps
 * red words, because it is what a reader scans for. Nothing to act on
 * (`neutral`) drops to muted words.
 */
export function StatusBadge({
  tone,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Badge> & { tone: StatusBadgeTone }): React.JSX.Element {
  return (
    <Badge variant="outline" className={cn("gap-1.5", TEXT[tone], className)} {...props}>
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </Badge>
  )
}
