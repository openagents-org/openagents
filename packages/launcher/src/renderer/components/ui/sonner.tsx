import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useThemeStore } from "@renderer/store/theme"

/**
 * Deviates from the stock shadcn file in two ways, both required here:
 *
 * 1. Theme comes from the launcher's own store rather than `next-themes` —
 *    this is Electron, not Next, and the store already resolves `system` down
 *    to a concrete light/dark value.
 * 2. The custom properties point at the launcher's raw colour tokens. Sonner
 *    reads these as real colours, but this project's `--popover` holds bare
 *    HSL channels (`0 0% 100%`) meant to be wrapped in `hsl()`, so passing it
 *    through unwrapped would yield an invalid colour.
 */
const Toaster = ({ ...props }: ToasterProps): React.JSX.Element => {
  const resolved = useThemeStore((s) => s.resolved)

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // Sonner ships one neutral surface for every type and only varies the
      // icon, which made success/warning/error read identically. Each type gets
      // the tint it already has elsewhere in the app; `!` is needed because
      // Sonner's own `[data-sonner-toast]` rule sets the background.
      toastOptions={{
        classNames: {
          success:
            "bg-(--success-bg)! text-(--success-text)! border-(--success-text)/25!",
          error:
            "bg-(--danger-bg)! text-(--danger-text)! border-(--danger-text)/25!",
          warning:
            "bg-(--warning-bg)! text-(--warning-text)! border-(--warning-text)/25!",
          info: "bg-(--bg-card)! text-(--text-primary)! border-(--border)!",
          // Sonner colours the title itself, which would keep it neutral on
          // top of a tinted surface — inherit so it follows the type.
          title: "text-inherit!",
          description: "text-inherit! opacity-80",
        },
      }}
      style={
        {
          "--normal-bg": "var(--bg-card)",
          "--normal-text": "var(--text-primary)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
