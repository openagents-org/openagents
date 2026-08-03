import React from "react"
import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import {
  SUPPORTED_LANGUAGES,
  changeLanguage,
  type LanguageCode,
} from "@renderer/i18n"
import { SettingsCard,
  Row,
  InfoRow,
} from "../components/settings-card"

/**
 * Language plus a read-only view of the regional formats the app derives from
 * the OS. Dates and times are formatted with the *display* language, so this
 * preview changes the moment the picker above it does.
 */
export function LanguageSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const current = (i18n.resolvedLanguage ?? i18n.language) as LanguageCode

  const resolved = Intl.DateTimeFormat().resolvedOptions()
  const now = new Date()
  const dateSample = now.toLocaleDateString(current, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  })
  const timeSample = now.toLocaleTimeString(current, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  return (
    <>
      <SettingsCard title={t("settings.language.languageGroup")}>
        <Row
          label={t("settings.language.displayLanguage")}
          desc={t("settings.language.displayLanguageDesc")}
        >
          <Select
            value={current}
            onValueChange={(v) => void changeLanguage(v as LanguageCode)}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </SettingsCard>

      <SettingsCard title={t("settings.language.formatGroup")}>
        <InfoRow
          label={t("settings.language.systemLocale")}
          value={resolved.locale}
          mono
        />
        <InfoRow
          label={t("settings.language.timezone")}
          value={resolved.timeZone}
          mono
        />
        <InfoRow label={t("settings.language.dateSample")} value={dateSample} />
        <InfoRow label={t("settings.language.timeSample")} value={timeSample} />
      </SettingsCard>
    </>
  )
}
