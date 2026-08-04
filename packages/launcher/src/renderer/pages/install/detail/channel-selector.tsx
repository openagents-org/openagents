import React from "react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import type { UpdateChannel } from "@renderer/hooks/useAgentChannel"

const CHANNELS: UpdateChannel[] = ["stable", "beta", "nightly"]

/**
 * Per-agent update channel. A 3-up segmented control so all options are
 * visible at once — beta / nightly route the next update through the
 * install-at-version IPC, stable uses the default pipeline.
 */
export function ChannelSelector({
  value,
  onChange,
}: {
  value: UpdateChannel
  onChange: (next: UpdateChannel) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <span className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
        {t("agents.channelSelector.updateChannel")}
      </span>
      <Tabs value={value} onValueChange={(v) => onChange(v as UpdateChannel)}>
        <TabsList className="w-full">
          {CHANNELS.map((c) => (
            <TabsTrigger
              key={c}
              value={c}
              className="text-2xs"
              title={t(`agents.channelSelector.${c}Description`)}
            >
              {t(`agents.channelSelector.${c}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
