import React from "react"
import { useTranslation } from "react-i18next"

interface Props {
  screenshots: string[]
  demoUrl?: string | null
  altPrefix: string
}

/**
 * Horizontal screenshot strip plus an optional demo link. Images lazy-load so
 * opening the detail page never blocks on a remote asset.
 */
export function DetailScreenshots({
  screenshots,
  demoUrl,
  altPrefix,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  if (screenshots.length === 0 && !demoUrl) return null

  return (
    <div className="flex flex-col gap-2.5">
      {screenshots.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-1.5">
          {screenshots.map((src, i) => (
            <a
              key={`${src}-${i}`}
              href="#"
              title={t("agents.screenshots.openFullSize")}
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal(src)
              }}
              className="block flex-none overflow-hidden rounded-lg border bg-muted transition-colors hover:border-primary"
            >
              <img
                src={src}
                alt={t("agents.screenshots.altScreenshot", {
                  prefix: altPrefix,
                  index: i + 1,
                })}
                loading="lazy"
                className="block h-35 w-auto max-w-65 object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {demoUrl && (
        <a
          href="#"
          className="text-xs"
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal(demoUrl)
          }}
        >
          {t("agents.screenshots.watchDemo")}
        </a>
      )}
    </div>
  )
}
