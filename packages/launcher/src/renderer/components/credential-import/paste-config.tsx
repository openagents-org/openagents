import React, { useState } from "react"
import { ChevronDown, ClipboardPaste } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@renderer/components/ui/input-group"
import { cn } from "@renderer/lib/utils"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** False when nothing this agent can use was in the text. */
  onRecognize: (text: string) => Promise<boolean>
}

/**
 * The other way in: the snippet a relay's dashboard hands out. Folded away while
 * there are keys to pick from, so it doesn't push the list off screen, and its
 * action sits inside the box it acts on instead of on a line of its own.
 */
export function PasteConfig({
  open,
  onOpenChange,
  onRecognize,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState("")
  const [miss, setMiss] = useState(false)
  const [busy, setBusy] = useState(false)

  const recognize = async (): Promise<void> => {
    setBusy(true)
    const found = await onRecognize(text)
    setBusy(false)
    setMiss(!found)
    // Recognised means it is in the list now — no reason to leave a key sitting
    // on screen in plain text.
    if (found) {
      setText("")
      onOpenChange(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="inline-flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ClipboardPaste className="size-3.5" />
        {t("credentialImport.paste.label")}
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <InputGroup>
          <InputGroupTextarea
            aria-label={t("credentialImport.paste.label")}
            value={text}
            spellCheck={false}
            placeholder={t("credentialImport.paste.placeholder")}
            className="min-h-20 font-mono text-xs"
            onChange={(e) => {
              setText(e.target.value)
              setMiss(false)
            }}
          />
          <InputGroupAddon align="block-end">
            <InputGroupText
              className={cn("text-2xs", miss && "text-(--danger-text)")}
            >
              {miss
                ? t("credentialImport.paste.notFound")
                : t("credentialImport.paste.formats")}
            </InputGroupText>
            <InputGroupButton
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={!text.trim() || busy}
              onClick={() => void recognize()}
            >
              {t("credentialImport.paste.recognize")}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}
    </div>
  )
}
