"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { cn } from "@/lib/utils"
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
      className="group toaster [&_[data-type=success]>[data-icon]]:text-success [&_[data-type=info]>[data-icon]]:text-info [&_[data-type=warning]>[data-icon]]:text-warning [&_[data-type=error]>[data-icon]]:text-destructive"
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
        // Padding, borders and button styles are sonner's own, but the
        // cascade-layers flattening (postcss.config.cjs) lifts Tailwind's
        // preflight reset above sonner's injected styles, which wipes them.
        // Utilities are lifted further, so everything is restated here.
        //
        // Layout: sonner puts the icon, the text and the buttons on one flex
        // row, so a toast with a description and two buttons squeezed its
        // text into a narrow column (English wrapped every two words) and
        // clipped the buttons' padding. A standard toast is a grid instead:
        //
        //   [icon] [title + description ...................]
        //                              [cancel]  [action]
        //
        // The text gets the full width, the buttons get their own row, end
        // aligned with the main action last, as in a dialog footer. Grid
        // columns follow the writing direction, so RTL mirrors it. Only
        // toasts with sonner's own content element get the grid, so a
        // `toast.custom` keeps the layout it brings.
        //
        // The status colour sits on the icon only; the title stays in the
        // text colour, so a success toast is not a paragraph of green.
        classNames: {
          toast: cn(
            "group toast group-[.toaster]:border group-[.toaster]:p-4 group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground! group-[.toaster]:border-border group-[.toaster]:shadow-lg has-[[role=alert]]:border-0! has-[[role=alert]]:shadow-none! has-[[role=alert]]:bg-transparent!",
            "has-[>[data-content]]:grid! has-[>[data-content]]:grid-cols-[auto_minmax(0,1fr)_auto_auto] has-[>[data-content]]:items-start! has-[>[data-content]]:gap-x-0! has-[>[data-content]]:gap-y-3!",
          ),
          icon: "col-start-1 row-start-1 m-0! me-2.5! mt-0.5! [&_svg]:m-0!",
          content: "col-start-2 col-end-[-1] row-start-1 min-w-0 gap-0.5!",
          title: "text-sm! leading-5! font-medium! text-foreground!",
          description: "text-sm! leading-5! text-muted-foreground!",
          // Project Button `sm`: the main action filled, the other outlined.
          actionButton:
            "col-start-4 row-start-2 m-0! h-7! rounded-md! border! border-transparent! px-2.5! text-[0.8rem]! font-medium! bg-primary! text-primary-foreground! hover:bg-primary/90! focus-visible:ring-3! focus-visible:ring-ring/50! transition-colors!",
          cancelButton:
            "col-start-3 row-start-2 m-0! me-2! h-7! rounded-md! border! border-border! px-2.5! text-[0.8rem]! font-medium! bg-background! text-foreground! hover:bg-muted! dark:bg-input/30! dark:border-input! dark:hover:bg-input/50! focus-visible:ring-3! focus-visible:ring-ring/50! transition-colors!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
