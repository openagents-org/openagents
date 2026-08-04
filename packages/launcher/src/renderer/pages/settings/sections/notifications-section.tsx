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
import { SettingsCard, Row } from "../components/settings-card"
import type { NotifKind } from "@renderer/types"

/**
 * The kinds that something actually emits today, grouped the way users think
 * about them. Labels are reused from the notification centre catalog
 * (`notificationsPanel.kinds.*`) so the two surfaces can never disagree.
 *
 * `NotifKind` declares eleven kinds and the muting pipeline honours all of
 * them, but only `update_available` has a caller — see `pushNotification` in
 * main. Listing the rest gave users switches that changed nothing, so a kind
 * belongs here only once something pushes it.
 */
const KIND_GROUPS: Array<{ id: string; kinds: NotifKind[] }> = [
  {
    id: "system",
    kinds: ["update_available"],
  },
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** Window offered when the user first switches quiet hours on. */
const DEFAULT_QUIET: [number, number] = [22, 7]

export function NotificationsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const { prefs, setPrefs } = useNotificationsStore(
    useShallow((s) => ({ prefs: s.prefs, setPrefs: s.setPrefs })),
  )

  if (!prefs) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
  }

  const off = !prefs.enabled
  const quiet = prefs.quietHours
  // The pickers stay on screen while quiet hours are off, showing the window
  // that would apply — switching it on then reads as resuming, not configuring.
  const window_ = quiet ?? DEFAULT_QUIET

  const toggleKind = (kind: NotifKind, on: boolean): void => {
    const next = new Set(prefs.mutedKinds)
    if (on) next.delete(kind)
    else next.add(kind)
    void setPrefs({ mutedKinds: Array.from(next) })
  }

  return (
    <>
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
        <Row label={t("settings.notifications.quietHours")}>
          <div className="flex items-center gap-2">
            <HourSelect
              value={window_[0]}
              disabled={off || !quiet}
              // Picking a start equal to the current end would empty the
              // window, so move the end on by an hour instead of letting the
              // two collide.
              onChange={(h) =>
                void setPrefs({
                  quietHours: [h, h === window_[1] ? (h + 1) % 24 : window_[1]],
                })
              }
            />
            <span className="text-2xs text-muted-foreground">–</span>
            <HourSelect
              value={window_[1]}
              disabled={off || !quiet}
              // An end equal to the start is an empty window that reads as
              // "all day" — quiet hours would silently do nothing. Take it off
              // the menu rather than letting users configure a no-op.
              excludeHour={window_[0]}
              onChange={(h) => void setPrefs({ quietHours: [window_[0], h] })}
            />
            <Switch
              className="ml-2"
              checked={!!quiet}
              disabled={off}
              onCheckedChange={(v) =>
                void setPrefs({ quietHours: v ? window_ : null })
              }
            />
          </div>
        </Row>
      </SettingsCard>

      <SettingsCard title={t("settings.notifications.eventsGroup")}>
        {KIND_GROUPS.map((group) => (
          <div key={group.id} className="flex gap-6 py-3">
            <div className="w-20 shrink-0 pt-1.5 text-2xs text-muted-foreground">
              {t(`settings.notifications.kindGroups.${group.id}`)}
            </div>

            <div className="min-w-0 flex-1">
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
          </div>
        ))}
      </SettingsCard>
    </>
  )
}

function HourSelect({
  value,
  disabled,
  excludeHour,
  onChange,
}: {
  value: number
  disabled?: boolean
  /** Hour to grey out — used to keep the window from collapsing to nothing. */
  excludeHour?: number
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
          <SelectItem key={h} value={String(h)} disabled={h === excludeHour}>
            {String(h).padStart(2, "0")}:00
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
