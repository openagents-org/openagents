import React from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { BrandMark } from "@renderer/components/ui-kit"
import { SettingsCard,
  Row,
  InfoRow,
} from "../components/settings-card"
import type { RuntimeInfo, SystemInfo } from "@renderer/types"

const REPO = "https://github.com/openagents-org/openagents"

const LINKS = [
  { id: "docs", url: "https://openagents.org/docs" },
  { id: "repo", url: REPO },
  { id: "issues", url: `${REPO}/issues` },
  { id: "releases", url: `${REPO}/releases` },
] as const

interface Props {
  launcherVersion: string
  runtimeInfo: RuntimeInfo | null
  systemInfo: SystemInfo | null
}

export function AboutSection({
  launcherVersion,
  runtimeInfo,
  systemInfo,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      {/* This page is about the app you are running — the launcher — not the
          OpenAgents platform as a whole. The version badge belongs to it, so
          the name has to say "launcher" too, and the platform gets one line of
          context underneath rather than top billing. */}
      <Card className="mb-5 flex-row items-center gap-5 px-6 py-6">
        <BrandMark className="size-14" />
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight">
            {t("settings.about.productName")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("settings.about.tagline")}
          </div>
          <div className="mt-1 text-2xs text-muted-foreground">
            {t("settings.about.copyright", { year: new Date().getFullYear() })}
          </div>
        </div>
        <Badge variant="muted" className="ml-auto shrink-0 font-mono">
          {launcherVersion}
        </Badge>
      </Card>

      <SettingsCard title={t("settings.about.versionGroup")}>
        <InfoRow
          label={t("settings.runtime.coreLibrary")}
          value={
            runtimeInfo?.coreVersion
              ? `v${runtimeInfo.coreVersion}`
              : t("common.notInstalled")
          }
          mono
        />
        <InfoRow
          label={t("settings.about.buildType")}
          value={
            systemInfo
              ? systemInfo.packaged
                ? t("settings.about.buildPackaged")
                : t("settings.about.buildDev")
              : "—"
          }
        />
        <InfoRow
          label={t("settings.runtime.electron")}
          value={
            systemInfo
              ? `Electron ${systemInfo.electronVersion} · Chrome ${systemInfo.chromeVersion}`
              : "—"
          }
          mono
        />
      </SettingsCard>

      <SettingsCard title={t("settings.about.resourcesGroup")}>
        {LINKS.map((link) => (
          <Row
            key={link.id}
            label={t(`settings.about.links.${link.id}`)}
            // The URL reads as the link it is; the button next to it is what
            // actually opens the browser.
            desc={<span className="text-(--accent)">{link.url}</span>}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.api.openExternal(link.url)}
            >
              {t("settings.about.open")}
              <ExternalLink />
            </Button>
          </Row>
        ))}
        {/* The licence is stated here, next to the way to read it, instead of
            as a bare "MIT" row in the version card. */}
        <Row
          label={t("settings.about.licenseFile")}
          desc={t("settings.about.licenseFileDesc")}
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              window.api.openExternal(`${REPO}/blob/develop/LICENSE`)
            }
          >
            {t("settings.about.view")}
            <ExternalLink />
          </Button>
        </Row>
      </SettingsCard>
    </>
  )
}
