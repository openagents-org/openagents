import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { cn } from "@renderer/lib/utils"
import { useThemeStore } from "@renderer/store/theme"

// Sonner sets `background` as a shorthand, so both layers need `!`.
const OPAQUE_TINT = "bg-card! bg-linear-to-b!"

/**
 * Deviates from the stock shadcn file in one way: the theme comes from the
 * launcher's own store rather than `next-themes` — this is Electron, not
 * Next, and the store already resolves `system` down to a concrete
 * light/dark value. Status toasts keep their soft tint.
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
      //
      // The frame reads `--*-border` rather than a 25% cut of the text colour.
      // Those two are the same colour in the default skin — the tokens were
      // authored at 0.24–0.30 alpha of exactly these hues — so nothing moves
      // here; what it buys is a border a skin can restate, which is how the
      // openagents skin gets an inked frame on a toast without a second
      // `!important` fighting this one.
      //
      // The `--*-bg` tints are 6–12% alpha, so on their own the toast let the
      // page show through — a button underneath read straight through an
      // error. They are laid as a flat gradient over the opaque card colour
      // instead: same tint, solid surface.
      toastOptions={{
        classNames: {
          success: cn(
            OPAQUE_TINT,
            "from-success/10 to-success/10 text-success-foreground! border-success/30!",
          ),
          error: cn(
            OPAQUE_TINT,
            "from-destructive/10 to-destructive/10 text-destructive! border-destructive/30!",
          ),
          warning: cn(
            OPAQUE_TINT,
            "from-warning/10 to-warning/10 text-warning-foreground! border-warning/30!",
          ),
          info: "bg-card! text-foreground! border-border!",
          // Sonner colours the title itself, which would keep it neutral on
          // top of a tinted surface — inherit so it follows the type.
          title: "text-inherit!",
          description: "text-inherit! opacity-80",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
