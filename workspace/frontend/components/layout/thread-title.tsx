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
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t("header.readOnly")}
          </span>
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
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") setEditing(false)
        }}
        className="w-0 min-w-0 flex-1 border-b border-primary bg-transparent text-sm font-semibold outline-none"
        autoFocus
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {session?.isChannel && <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("threads.channel")} />}
      <h3
        onClick={startEditing}
        title={t("header.clickToRename")}
        className="min-w-0 cursor-pointer truncate text-base font-medium text-foreground transition-colors hover:text-muted-foreground"
      >
        {session?.title || t("header.untitledThread")}
      </h3>
      {session?.forkedFrom && <ForkTag forkedFrom={session.forkedFrom} />}
      {currentSessionId && <ThreadParticipantCount channelName={currentSessionId} />}
    </div>
  )
}
