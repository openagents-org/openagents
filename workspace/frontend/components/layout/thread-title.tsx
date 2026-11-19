"use client"
import { useRef, useState } from "react"
import { Hash } from "lucide-react"
import { useWorkspace } from "@/lib/workspace-context"
import { addressName, dmCounterpart, dmPair, myAddress } from "@/lib/dm"
import { useHumanNames } from "@/hooks/use-team-roster"
import { useT } from "@/lib/i18n"
import { DmAvatars } from "@/components/chat/dm-avatars"
import { ThreadParticipantCount } from "@/components/chat/thread-participant-count"
import { ForkTag } from "@/components/chat/fork-thread"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WithTooltip } from "@/components/ui/with-tooltip"

/** Editable thread title — click to rename, Enter/blur to commit. */
export function ThreadTitle() {
  const { sessions, currentSessionId, renameSession, currentUser } = useWorkspace()
  const humanNames = useHumanNames()
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const isDM = currentSessionId?.startsWith("dm:") ?? false
  const session = sessions.find((s) => s.sessionId === currentSessionId)

  if (isDM) {
    // Title the DM by the counterpart alone. A pair that includes the human
    // viewer is a writable conversation (no read-only badge); agent↔agent
    // pairs stay a read-only observation view with both names.
    const pair = dmPair(currentSessionId)
    const counterpart = dmCounterpart(pair, myAddress(currentUser))
    const hasHuman = !!counterpart
    const nameLabel = (addr: string) => {
      const n = addressName(addr)
      return addr.startsWith("human:") ? (humanNames[n.toLowerCase()] ?? n) : n
    }
    const title = counterpart
      ? nameLabel(counterpart)
      : pair.map(nameLabel).join(" ↔ ")
    return (
      <h3 className="font-heading flex w-0 flex-1 items-center gap-1.5 truncate text-base font-medium text-foreground">
        <DmAvatars addresses={counterpart ? [counterpart] : pair} />
        {title}
        {!hasHuman && (
          <Badge variant="secondary" className="shrink-0">
            {t("header.readOnly")}
          </Badge>
        )}
      </h3>
    )
  }

  const startEditing = () => {
    setDraft(session?.title || "")
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && currentSessionId && trimmed !== session?.title) {
      renameSession(currentSessionId, trimmed)
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") setEditing(false)
        }}
        aria-label={t("threads.renameTitle")}
        className="h-8 w-0 min-w-0 flex-1 font-semibold"
        autoFocus
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {session?.isChannel && <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("threads.channel")} />}
      <h3 className="flex min-w-0">
        <WithTooltip label={t("header.clickToRename")}>
          <Button variant="ghost" size="sm" onClick={startEditing} className="-mx-1 min-w-0 shrink px-1 text-base font-medium">
            <span className="truncate">{session?.title || t("header.untitledThread")}</span>
          </Button>
        </WithTooltip>
      </h3>
      {session?.forkedFrom && <ForkTag forkedFrom={session.forkedFrom} />}
      {currentSessionId && <ThreadParticipantCount channelName={currentSessionId} />}
    </div>
  )
}
