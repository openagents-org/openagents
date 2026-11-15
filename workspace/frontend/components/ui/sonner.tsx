"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="group toaster [&_[data-type=success]>[data-icon]]:text-success [&_[data-type=success]_[data-title]]:text-success [&_[data-type=info]_[data-title]]:text-info [&_[data-type=error]>[data-icon]]:text-destructive [&_[data-type=error]_[data-title]]:text-destructive"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Padding and border are sonner's own, but the cascade-layers
          // flattening (postcss.config.cjs) lifts Tailwind's preflight reset
          // above sonner's injected styles, leaving the toast with neither.
          // Utilities are lifted further, so restate them here.
          toast:
            "group toast group-[.toaster]:border group-[.toaster]:p-4 group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground! group-[.toaster]:border-border group-[.toaster]:shadow-lg has-[[role=alert]]:border-0! has-[[role=alert]]:shadow-none! has-[[role=alert]]:bg-transparent!",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-md! group-[.toast]:bg-primary group-[.toast]:text-primary-foreground!",
          cancelButton:
            "group-[.toast]:rounded-md! group-[.toast]:bg-secondary group-[.toast]:text-secondary-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
