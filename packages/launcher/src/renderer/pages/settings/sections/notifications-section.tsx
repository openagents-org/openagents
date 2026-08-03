import React from "react"
import { useTranslation } from "react-i18next"
import { useShallow } from "zustand/react/shallow"

import { Switch } from "@renderer/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { useNotificationsStore } from "@renderer/store/notifications"
import { SectionHeading, SettingsCard, Row } from "../components/settings-card"
import type { NotifKind } from "@renderer/types"

/**
 * Every kind the notification pipeline can emit, grouped the way users think
 * about them. Labels are reused from the notification centre catalog
 * (`notificationsPanel.kinds.*`) so the two surfaces can never disagree.
 */
const KIND_GROUPS: Array<{ id: string; kinds: NotifKind[] }> = [
  {
    id: "agents",
    kinds: [
      "agent_error",
      "agent_finished",
      "agent_mention",
      "agent_waiting_input",
    ],
  },
  {
    id: "workspace",
    kinds: ["workspace_mention", "workspace_message", "workspace_error"],
  },
  {
    id: "system",
    kinds: ["platform_error", "github", "update_available", "system"],
  },
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** Default quiet window offered when the user first switches it on. */
const DEFAULT_QUIET: [number, number] = [22, 7]

export function NotificationsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const { prefs, setPrefs } = useNotificationsStore(
    useShallow((s) => ({ prefs: s.prefs, setPrefs: s.setPrefs })),
  )

  if (!prefs) {
    return (
      <>
        <SectionHeading
          title={t("settings.pages.notifications.title")}
          desc={t("settings.pages.notifications.desc")}
        />
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      </>
    )
  }

  const off = !prefs.enabled
  const quiet = prefs.quietHours

  const toggleKind = (kind: NotifKind, on: boolean): void => {
    const next = new Set(prefs.mutedKinds)
    if (on) next.delete(kind)
    else next.add(kind)
    void setPrefs({ mutedKinds: Array.from(next) })
  }

  return (
    <>
      <SectionHeading
        title={t("settings.pages.notifications.title")}
        desc={t("settings.pages.notifications.desc")}
      />

      <SettingsCard title={t("settings.notifications.deliveryGroup")}>
        <Row
          label={t("settings.notifications.enable")}
          desc={t("settings.notifications.enableDesc")}
        >
          <Switch
            checked={prefs.enabled}
            onCheckedChange={(v) => void setPrefs({ enabled: v })}
          />
        </Row>
        <Row
          label={t("settings.notifications.sound")}
          desc={t("settings.notifications.soundDesc")}
        >
          <Switch
            checked={prefs.soundEnabled}
            disabled={off}
            onCheckedChange={(v) => void setPrefs({ soundEnabled: v })}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("settings.notifications.quietGroup")}
        desc={t("settings.notifications.quietGroupDesc")}
      >
        <Row
          label={t("settings.notifications.quietHours")}
          desc={t("settings.notifications.quietHoursDesc")}
        >
          <Switch
            checked={!!quiet}
            disabled={off}
            onCheckedChange={(v) =>
              void setPrefs({ quietHours: v ? DEFAULT_QUIET : null })
            }
          />
        </Row>
        {quiet && (
          <Row label={t("settings.notifications.quietWindow")}>
            <div className="flex items-center gap-2">
              <HourSelect
                value={quiet[0]}
                disabled={off}
                onChange={(h) => void setPrefs({ quietHours: [h, quiet[1]] })}
              />
              <span className="text-2xs text-muted-foreground">→</span>
              <HourSelect
                value={quiet[1]}
                disabled={off}
                onChange={(h) => void setPrefs({ quietHours: [quiet[0], h] })}
              />
            </div>
          </Row>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("settings.notifications.eventsGroup")}
        desc={t("settings.notifications.eventsGroupDesc")}
      >
        {KIND_GROUPS.map((group) => (
          <div key={group.id} className="py-2">
            <div className="py-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
              {t(`settings.notifications.kindGroups.${group.id}`)}
            </div>
            {group.kinds.map((kind) => (
              <div
                key={kind}
                className="flex items-center justify-between gap-4 py-1.5"
              >
                <span className="text-xs">
                  {t(`notificationsPanel.kinds.${kind}`)}
                </span>
                <Switch
                  checked={!prefs.mutedKinds.includes(kind)}
                  disabled={off}
                  onCheckedChange={(v) => toggleKind(kind, v)}
                />
              </div>
            ))}
          </div>
        ))}
      </SettingsCard>
    </>
  )
}

function HourSelect({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled?: boolean
  onChange: (hour: number) => void
}): React.JSX.Element {
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger size="sm" className="w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HOURS.map((h) => (
          <SelectItem key={h} value={String(h)}>
            {String(h).padStart(2, "0")}:00
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
