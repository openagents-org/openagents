import React from "react"
import { useTranslation } from "react-i18next"
import { ChevronRight } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Switch } from "@renderer/components/ui/switch"
import { RUNNING_STATES } from "@renderer/lib/agent-state"
import { useUiStore } from "@renderer/store/ui"
import { SettingsCard,
  Row,
  InfoRow,
} from "../components/settings-card"
import type { SettingsValues, Update } from "../use-settings-state"
import type { Agent } from "@renderer/types"

interface Props {
  values: SettingsValues
  update: Update
  agents: Agent[]
}

/**
 * Defaults that apply to every agent. Per-agent configuration (keys, working
 * directory, model) belongs to the agent itself and stays on the Agents page —
 * this section only links there.
 */
export function AgentsSection({
  values,
  update,
  agents,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const goToInstallList = useUiStore((s) => s.goToInstallList)

  const running = agents.filter((a) => RUNNING_STATES.includes(a.state)).length
  const types = new Set(agents.map((a) => a.type).filter(Boolean)).size

  return (
    <>
      <SettingsCard title={t("settings.agents.startupGroup")}>
        <Row
          label={t("settings.agents.autoStart")}
          desc={t("settings.agents.autoStartDesc")}
        >
          <Switch
            checked={values.agentAutoStart}
            onCheckedChange={(v) => update("agentAutoStart", v)}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("settings.agents.overviewGroup")}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => goToInstallList()}
            >
              {t("settings.agents.browseMarketplace")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentTab("agents")}
            >
              {t("settings.agents.openAgents")}
              <ChevronRight />
            </Button>
          </div>
        }
      >
        <InfoRow
          label={t("settings.agents.configured")}
          value={t("settings.agents.agentCount", { count: agents.length })}
        />
        <InfoRow
          label={t("settings.agents.running")}
          value={t("settings.agents.agentCount", { count: running })}
        />
        <InfoRow
          label={t("settings.agents.types")}
          value={t("settings.agents.typeCount", { count: types })}
        />
      </SettingsCard>
    </>
  )
}
