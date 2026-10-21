import React from "react"
import { Monitor } from "lucide-react"

import { StatusDot } from "@renderer/components/ui-kit"
import { useDeviceReadout } from "./use-device-readout"

/** This machine at a glance, in the top bar: the daemon's health as a dot. */
export function DeviceStatus(): React.JSX.Element {
  const { hostname, status, statusLabel, version } = useDeviceReadout()
  const title = [hostname, statusLabel, version].filter(Boolean).join(" · ")
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className="relative flex size-8 shrink-0 items-center justify-center text-muted-foreground"
    >
      <Monitor className="size-4" />
      <StatusDot state={status} className="absolute right-1 bottom-1 ring-2 ring-background" />
    </span>
  )
}
