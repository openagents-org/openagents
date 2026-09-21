import React from "react"
import { useTranslation } from "react-i18next"
import { Sparkles } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { type Release } from "@renderer/lib/changelog"
import { ReleaseEntries } from "./release-entries"

export interface WhatsNewDialogProps {
  open: boolean
  /** Newest first. One release after an update, all of them in history view. */
  releases: Release[]
  onClose: () => void
}

/**
 * The release notes, in the reader's language.
 *
 * Purely presentational — App mounts one to announce an update (see
 * `useWhatsNew`), Settings → Updates mounts another to browse the history.
 */
export function WhatsNewDialog({
  open,
  releases,
  onClose,
}: WhatsNewDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const newest = releases[0]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* Wider than the default dialog: this one is a list of paragraphs, and
          at `lg` the English text wrapped to four or five lines per entry —
          the whole release read as a wall rather than as a handful of items. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-(--accent)" />
            {newest
              ? t("whatsNew.title", { version: newest.version })
              : t("whatsNew.titleEmpty")}
          </DialogTitle>
          {/* Fixed copy, not the release's own headline: this line explains
              what the dialog is, and that does not change from version to
              version. Each release's summary is the title on its entries. */}
          <DialogDescription>{t("whatsNew.subtitle")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-6">
          {releases.length === 0 && (
            <p className="m-0 text-sm text-muted-foreground">
              {t("whatsNew.empty")}
            </p>
          )}
          {releases.map((release, i) => (
            <ReleaseEntries
              key={release.version}
              release={release}
              // A single release is already named in the dialog title; a
              // catch-up spanning several needs each one labelled.
              showHeading={releases.length > 1 || i > 0}
            />
          ))}
        </DialogBody>

        <DialogFooter>
          <Button onClick={onClose}>{t("whatsNew.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
