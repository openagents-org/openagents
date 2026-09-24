import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Download, Loader2, RefreshCw } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Progress } from "@renderer/components/ui/progress"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { ReleaseEntries } from "@renderer/components/whats-new/release-entries"
import { useLauncherUpdate } from "@renderer/hooks/useLauncherUpdate"
import { useUiStore } from "@renderer/store/ui"

/**
 * The manual path's UI: with "Download updates automatically" off, every new
 * version is put to the user here — once per version — before ~140MB is
 * fetched. Nothing is asked when the setting is on; that path downloads in the
 * background and the banner reports it.
 *
 * The setting is a promise about behaviour, and leaving the manual side at a
 * banner made it one the app didn't keep: "you download them yourself" turned
 * into a line of text that could be dismissed without ever being offered a
 * download.
 *
 * Agreeing keeps the dialog up rather than dismissing it: the notes are what
 * someone is most likely to want to read while the bytes come down, and closing
 * on the click would take them away exactly then. It follows the download to
 * "ready", where restarting is one more click.
 *
 * It leads with what the version actually changes (main fetches those notes off
 * the feed — see main/release-notes.ts). A version number alone is not
 * something anyone can answer this question against; releases that published no
 * notes, or whose notes can't be reached, fall back to the plain wording.
 */
export function UpdateOfferDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { state, download, install } = useLauncherUpdate()
  // Closing (Esc, the backdrop, "Later") is final for this run — including
  // while watching a download, which Settings → Updates carries on reporting.
  // Re-opening whenever the update state re-emits would make the dialog
  // impossible to dismiss.
  const [closed, setClosed] = useState(false)
  // Set once the user accepts, so the dialog stays over the download it just
  // started instead of closing on the click.
  const [accepted, setAccepted] = useState(false)
  const setPromptOpen = useUiStore((s) => s.setUpdatePromptOpen)

  const version = state?.latestVersion ?? ""
  // Only ever the notes for the version being offered; main clears them when it
  // moves on to a different one.
  const release =
    state?.pendingRelease?.version === version ? state.pendingRelease : null
  const status = state?.status
  const watching =
    accepted && (status === "downloading" || status === "downloaded")
  const asking = !accepted && status === "available" && !state?.pendingReleaseLoading
  const open =
    !closed && !!state?.supported && !state.autoDownload && (asking || watching)

  // The banner is this same offer in one line; it hides itself while this is up.
  useEffect(() => {
    setPromptOpen(open)
    return () => setPromptOpen(false)
  }, [open, setPromptOpen])

  const dismiss = (): void => setClosed(true)

  const accept = (): void => {
    setAccepted(true)
    void download()
  }

  if (!open) return null

  return (
    <Dialog open onOpenChange={(o) => !o && dismiss()}>
      {/* Wider than the default: with the notes in it this is a list of
          paragraphs, not a one-line question. Matches "What's new". */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status === "downloading" ? (
              <Loader2 className="size-4 animate-spin text-(--accent)" />
            ) : status === "downloaded" ? (
              <RefreshCw className="size-4 text-(--accent)" />
            ) : (
              <Download className="size-4 text-(--accent)" />
            )}
            {t("settings.updates.offerTitle", { version })}
          </DialogTitle>
          <DialogDescription>
            {status === "downloading"
              ? t("settings.updates.downloading", {
                  version: `v${version}`,
                  percent: Math.round(state?.percent ?? 0),
                })
              : status === "downloaded"
                ? t("settings.updates.downloaded", { version: `v${version}` })
                : t("settings.updates.offerSubtitle")}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-4">
          {release ? (
            <>
              <p className="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t("settings.updates.offerWhatsNew")}
              </p>
              <ReleaseEntries release={release} />
            </>
          ) : (
            // Fetch completed without notes; the update is still available.
            <p className="m-0 text-sm text-muted-foreground">
              {t("settings.updates.offerNoNotes")}
            </p>
          )}
          {status === "downloading" && (
            <Progress
              value={Math.round(state?.percent ?? 0)}
              className="h-1.5"
            />
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={dismiss}>
            {t("settings.updates.offerLater")}
          </Button>
          {watching ? (
            // Only once there is something to install; mid-download the dialog
            // is a reading surface, not a decision.
            status === "downloaded" && (
              <Button
                onClick={() => {
                  setClosed(true)
                  void install()
                }}
              >
                {t("settings.updates.actionRestartInstall")}
              </Button>
            )
          ) : (
            <Button onClick={accept}>{t("common.download")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
