import React from "react"
import { Trans, useTranslation } from "react-i18next"
import { Globe } from "lucide-react"

/**
 * Deep-link / OAuth jumps are intentionally stubs for now: this just walks the
 * user through opening the workspace landing page and pasting the URL back.
 * Once the workspace site supports a return scheme we can wire it up properly.
 *
 * The "open site" action itself lives in the dialog footer alongside every
 * other tab's primary action — see `WorkspaceQuickConnect`.
 */
export function QuickConnectBrowserTab(): React.JSX.Element {
  const { t } = useTranslation()

  const steps = [
    t("workspaces.quickConnect.step1"),
    t("workspaces.quickConnect.step2"),
    t("workspaces.quickConnect.step3"),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-md border bg-muted p-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Globe className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 text-xs font-semibold">
            {t("workspaces.quickConnect.browserHeading")}
          </div>
          <div className="text-2xs leading-relaxed break-all text-muted-foreground">
            <Trans
              i18nKey="workspaces.quickConnect.browserBody"
              components={[
                <code className="rounded-sm bg-background px-1 py-0.5 font-mono" />,
              ]}
            />
          </div>
        </div>
      </div>

      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step, i) => (
          <li
            key={step}
            className="flex items-start gap-2.5 text-2xs leading-relaxed text-muted-foreground"
          >
            <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-3xs font-semibold text-foreground">
              {i + 1}
            </span>
            <span className="pt-px">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
