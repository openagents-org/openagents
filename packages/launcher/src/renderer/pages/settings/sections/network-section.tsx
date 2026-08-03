import React from "react"
import { useTranslation } from "react-i18next"

import { Input } from "@renderer/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { SectionHeading, SettingsCard, Row } from "../components/settings-card"
import type { SettingsValues, Update } from "../use-settings-state"

interface Props {
  values: SettingsValues
  update: Update
  setLocal: Update
  persist: (key: keyof SettingsValues) => void
}

export function NetworkSection({
  values,
  update,
  setLocal,
  persist,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <SectionHeading
        title={t("settings.pages.network.title")}
        desc={t("settings.pages.network.desc")}
      />

      {/* Routes the Node runtime, npm and the agent core through npmmirror. It
          was previously auto-detected from timezone/locale with no way to
          correct a wrong guess — which left users on a slow origin with no
          recourse but a system-wide proxy. */}
      <SettingsCard
        title={t("settings.network.mirrorGroup")}
        desc={t("settings.network.mirrorGroupDesc")}
      >
        <Row
          label={t("settings.network.downloadRegion")}
          desc={t("settings.network.downloadRegionDesc")}
        >
          <Select
            value={values.downloadRegion}
            onValueChange={(v) => update("downloadRegion", v)}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t("settings.network.regionAuto")}</SelectItem>
              <SelectItem value="cn">{t("settings.network.regionCn")}</SelectItem>
              <SelectItem value="global">
                {t("settings.network.regionGlobal")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </SettingsCard>

      <SettingsCard title={t("settings.network.workspaceGroup")}>
        <Row
          stacked
          label={t("settings.network.workspaceUrl")}
          desc={t("settings.network.workspaceUrlDesc")}
        >
          <Input
            value={values.workspaceEndpoint}
            onChange={(e) => setLocal("workspaceEndpoint", e.target.value)}
            onBlur={() => persist("workspaceEndpoint")}
            placeholder={t("settings.network.workspaceUrlPlaceholder")}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("settings.network.proxyGroup")}
        desc={t("settings.network.note")}
      >
        <Row
          stacked
          label={t("settings.network.httpProxy")}
          desc={t("settings.network.httpProxyDesc")}
        >
          <Input
            value={values.httpProxy}
            onChange={(e) => setLocal("httpProxy", e.target.value)}
            onBlur={() => persist("httpProxy")}
            placeholder={t("settings.network.proxyPlaceholder")}
          />
        </Row>
        <Row
          stacked
          label={t("settings.network.httpsProxy")}
          desc={t("settings.network.httpsProxyDesc")}
        >
          <Input
            value={values.httpsProxy}
            onChange={(e) => setLocal("httpsProxy", e.target.value)}
            onBlur={() => persist("httpsProxy")}
            placeholder={t("settings.network.proxyPlaceholder")}
          />
        </Row>
        <Row
          stacked
          label={t("settings.network.noProxy")}
          desc={t("settings.network.noProxyDesc")}
        >
          <Input
            value={values.noProxy}
            onChange={(e) => setLocal("noProxy", e.target.value)}
            onBlur={() => persist("noProxy")}
            placeholder={t("settings.network.noProxyPlaceholder")}
          />
        </Row>
      </SettingsCard>
    </>
  )
}
