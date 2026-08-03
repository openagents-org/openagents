import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { PlugZap } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Spinner } from "@renderer/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { cn } from "@renderer/lib/utils"
import { SettingsCard, Row } from "../components/settings-card"
import type { SettingsValues, Update } from "../use-settings-state"

interface Props {
  values: SettingsValues
  update: Update
  setLocal: Update
  persist: (key: keyof SettingsValues) => void
}

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "done"; ok: boolean; code?: string }

export function NetworkSection({
  values,
  update,
  setLocal,
  persist,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [test, setTest] = useState<TestState>({ phase: "idle" })

  const endpoint = values.workspaceEndpoint.trim()

  const runTest = async (): Promise<void> => {
    setTest({ phase: "testing" })
    const res = await window.api
      .testWorkspaceEndpoint(endpoint)
      .catch(() => ({ ok: false, error: "unreachable" as const }))
    setTest({ phase: "done", ok: res.ok, code: res.error })
  }

  return (
    <>
      {/* Routes the Node runtime, npm and the agent core through npmmirror. It
          was previously auto-detected from timezone/locale with no way to
          correct a wrong guess — which left users on a slow origin with no
          recourse but a system-wide proxy. */}
      <SettingsCard title={t("settings.network.mirrorGroup")}>
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
              <SelectItem value="auto">
                {t("settings.network.regionAuto")}
              </SelectItem>
              <SelectItem value="cn">
                {t("settings.network.regionCn")}
              </SelectItem>
              <SelectItem value="global">
                {t("settings.network.regionGlobal")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("settings.network.workspaceGroup")}
        action={
          <div className="flex items-center gap-2">
            {test.phase === "done" && (
              <span
                className={cn(
                  "text-2xs",
                  test.ok ? "text-(--success-text)" : "text-destructive",
                )}
              >
                {test.ok
                  ? t("settings.network.testOk")
                  : t(
                      `settings.network.testError.${test.code ?? "unreachable"}`,
                    )}
              </span>
            )}
            {/* Only a self-hosted address is ours to probe: with the field
                empty the app talks to the hosted workspace, and there is
                nothing here to point a test at. */}
            <Button
              variant="ghost"
              size="sm"
              className="text-primary"
              disabled={!endpoint || test.phase === "testing"}
              onClick={() => void runTest()}
            >
              {test.phase === "testing" ? <Spinner /> : <PlugZap />}
              {t("settings.network.testConnection")}
            </Button>
          </div>
        }
      >
        <Row
          stacked
          label={t("settings.network.workspaceUrl")}
          desc={t("settings.network.workspaceUrlDesc")}
        >
          <Input
            value={values.workspaceEndpoint}
            onChange={(e) => {
              setLocal("workspaceEndpoint", e.target.value)
              setTest({ phase: "idle" })
            }}
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
          label={t("settings.network.httpProxy")}
          desc={t("settings.network.httpProxyDesc")}
        >
          <Input
            className="w-96"
            value={values.httpProxy}
            onChange={(e) => setLocal("httpProxy", e.target.value)}
            onBlur={() => persist("httpProxy")}
            placeholder={t("settings.network.proxyPlaceholder")}
          />
        </Row>

        <Row
          label={t("settings.network.httpsProxy")}
          desc={t("settings.network.httpsProxyDesc")}
        >
          <Input
            className="w-96"
            value={values.httpsProxy}
            onChange={(e) => setLocal("httpsProxy", e.target.value)}
            onBlur={() => persist("httpsProxy")}
            placeholder={t("settings.network.proxyPlaceholder")}
          />
        </Row>

        <Row
          label={t("settings.network.noProxy")}
          desc={t("settings.network.noProxyDesc")}
        >
          <Input
            className="w-96"
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
