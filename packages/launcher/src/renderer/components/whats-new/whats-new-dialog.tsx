import React from "react"
import { useTranslation } from "react-i18next"
import { Sparkles } from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
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
import { localized, type Release, type ReleaseEntryType } from "@renderer/lib/changelog"

/**
 * Entry type → chip tint. Three distinct hues rather than a grey for fixes:
 * the neutral chip sat at the same lightness as the dialog behind it and read
 * as disabled text.
 */
const TONE: Record<ReleaseEntryType, "default" | "success" | "warning"> = {
  feature: "default",
  improvement: "success",
  fix: "warning",
}

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
  const { t, i18n } = useTranslation()
  const newest = releases[0]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
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
            <ReleaseBlock
              key={release.version}
              release={release}
              language={i18n.language}
              // A single release is already named in the dialog title; a
              // catch-up spanning several needs each one labelled.
              showHeading={releases.length > 1 || i > 0}
              typeLabel={(type) => t(`whatsNew.types.${type}`)}
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

function ReleaseBlock({
  release,
  language,
  showHeading,
  typeLabel,
}: {
  release: Release
  language: string
  showHeading: boolean
  typeLabel: (type: ReleaseEntryType) => string
}): React.JSX.Element {
  return (
    <section>
      {showHeading && (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold">
            v{release.version}
          </span>
          <span className="text-2xs text-muted-foreground">{release.date}</span>
        </div>
      )}
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {release.entries.map((entry, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <Badge variant={TONE[entry.type]} size="sm" className="mt-0.5">
              {typeLabel(entry.type)}
            </Badge>
            {/* Two levels: the change in a few words, then the detail. A single
                paragraph made every line weigh the same, so scanning the list
                meant reading all of it. */}
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {localized(entry.title, language)}
              </div>
              {entry.description && (
                <p className="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
                  {localized(entry.description, language)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
