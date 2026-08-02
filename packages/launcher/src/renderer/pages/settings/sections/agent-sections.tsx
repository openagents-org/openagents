import React from "react"
import { useTranslation } from "react-i18next"

import { Separator } from "@renderer/components/ui/separator"
import { Switch } from "@renderer/components/ui/switch"
import { SettingsCard, Row } from "../components/settings-card"
import type { SectionId } from "../section-config"
import type { SettingsValues } from "../use-settings-state"

type Update = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) => void
import { Input } from "@renderer/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { NO_DEFAULT_AGENT } from "../section-config"
import type { Agent, NotifPrefs } from "@renderer/types"

interface Props {
  section: SectionId
  values: SettingsValues
  update: Update
  setLocal: Update
  persist: (k: keyof SettingsValues) => void
  agents: Agent[]
  agentTypes: string[]
  notifPrefs: NotifPrefs | null
  setNotifPrefs: (p: Partial<NotifPrefs>) => Promise<void>
}

export function AgentSections({
  section,
  values,
  update,
  setLocal,
  persist,
  agents,
  agentTypes,
  notifPrefs,
  setNotifPrefs,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
          {section === "agents" && (
            <SettingsCard title={t("settings.agents.title")}>
              <Row
                label={`${t("settings.agents.defaultType")} · ${t("common.comingSoon")}`}
                desc={t("settings.agents.defaultTypeDesc")}
              >
                <Select
                  value={values.defaultAgentType || NO_DEFAULT_AGENT}
                  disabled
                  onValueChange={(v) => {
                    const next = v === NO_DEFAULT_AGENT ? "" : v
                    update("defaultAgentType", next)
                  }}
                >
                  <SelectTrigger size="sm" className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_DEFAULT_AGENT}>{t("common.none")}</SelectItem>
                    {agentTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Separator />
              <Row
                stacked
                label={`${t("settings.agents.defaultModel")} · ${t("common.comingSoon")}`}
                desc={t("settings.agents.defaultModelDesc")}
              >
                <Input
                  value={values.defaultModel}
                  disabled
                  onChange={(e) => setLocal("defaultModel", e.target.value)}
                  onBlur={() => persist("defaultModel")}
                  placeholder={t("settings.agents.defaultModelPlaceholder")}
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row
                label={`${t("settings.agents.autoStart")} · ${t("common.comingSoon")}`}
                desc={t("settings.agents.autoStartDesc")}
              >
                <Switch
                  checked={values.agentAutoStart}
                  disabled
                  onCheckedChange={(v) => {
                    update("agentAutoStart", v)
                  }}
                />
              </Row>
            </SettingsCard>
          )}

          {section === "notifications" && (
            <SettingsCard title={t("settings.notifications.title")}>
              <Row
                label={t("settings.notifications.enable")}
                desc={t("settings.notifications.enableDesc")}
              >
                <Switch
                  checked={!!notifPrefs?.enabled}
                  onCheckedChange={(v) => void setNotifPrefs({ enabled: v })}
                />
              </Row>
              <Separator />
              <Row
                label={t("settings.notifications.sound")}
                desc={t("settings.notifications.soundDesc")}
              >
                <Switch
                  checked={!!notifPrefs?.soundEnabled}
                  onCheckedChange={(v) => void setNotifPrefs({ soundEnabled: v })}
                />
              </Row>
              <Separator />
              <p className="text-2xs text-(--text-tertiary) m-0 mt-2">
                {t("settings.notifications.note")}
              </p>
            </SettingsCard>
          )}

          {section === "network" && (
            <SettingsCard title={t("settings.network.title")}>
              {/* Routes the Node runtime, npm and the agent core through
                  npmmirror. It was previously auto-detected from timezone/locale
                  with no way to correct a wrong guess — which left users on a
                  slow origin with no recourse but a system-wide proxy. */}
              <Row
                label={t("settings.network.downloadRegion")}
                desc={t("settings.network.downloadRegionDesc")}
              >
                <Select
                  value={values.downloadRegion}
                  onValueChange={(v) => {
                    update("downloadRegion", v)
                  }}
                >
                  <SelectTrigger size="sm" className="w-50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("settings.network.regionAuto")}</SelectItem>
                    <SelectItem value="cn">{t("settings.network.regionCn")}</SelectItem>
                    <SelectItem value="global">{t("settings.network.regionGlobal")}</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
              <Separator />
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
                  className="w-full"
                />
              </Row>
              <Separator />
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
                  className="w-full"
                />
              </Row>
              <Separator />
              <Row stacked label={t("settings.network.httpsProxy")} desc={t("settings.network.httpsProxyDesc")}>
                <Input
                  value={values.httpsProxy}
                  onChange={(e) => setLocal("httpsProxy", e.target.value)}
                  onBlur={() => persist("httpsProxy")}
                  placeholder={t("settings.network.proxyPlaceholder")}
                  className="w-full"
                />
              </Row>
              <Separator />
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
                  className="w-full"
                />
              </Row>
              <p className="text-2xs text-(--text-tertiary) m-0 mt-3">
                {t("settings.network.note")}
              </p>
            </SettingsCard>
          )}

    </>
  )
}
