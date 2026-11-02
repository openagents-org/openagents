import React from "react"
import { MessagesSquare, Monitor, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useSidebar } from "@renderer/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@renderer/components/ui/tooltip"
import { useAccountStore } from "@renderer/store/account"
import { cn } from "@renderer/lib/utils"

interface ButtonProps extends Omit<React.ComponentProps<"button">, "onClick"> {
  icon: LucideIcon
  label: string
  active: boolean
  testId: string
  onClick: () => void
}

// The rest of the props (and the ref) go through to the button: a Radix
// tooltip trigger `asChild` attaches its hover handlers that way, and without
// them the rail's tooltips never opened.
function ModeButton({ icon: Icon, label, active, testId, onClick, className, ...rest }: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "titlebar-no-drag flex h-7 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors",
        // 28px squares in the sidebar's icon rail, where the pair stack.
        "group-data-[collapsible=icon]:size-7 group-data-[collapsible=icon]:px-0",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="group-data-[collapsible=icon]:hidden">{label}</span>
    </button>
  )
}

/** The button with its name beside it while the sidebar is the icon rail. */
function RailTooltipButton(props: ButtonProps): React.JSX.Element {
  const { state, isMobile } = useSidebar()
  return (
    <Tooltip>
      <TooltipTrigger asChild><ModeButton {...props} /></TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>{props.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * This Computer | Workspace — the window's two halves. The same control in the
 * same spot on both: the title-bar row, right after the macOS traffic lights.
 * On This Computer it sits at the top of the sidebar; on the Workspace side,
 * which has no sidebar, at the start of its tab bar. Only the lit half moves.
 *
 * The labels never truncate: the sidebar widens to fit the switch beside the
 * lights instead (see `ref`, and AppFrame).
 *
 * `inSidebar` gives the buttons their tooltips for the icon rail, where the
 * pair stack as icons; it needs the sidebar's context, so only the sidebar
 * sets it.
 */
export function ModeSwitch({ inSidebar = false, ref }: {
  inSidebar?: boolean
  ref?: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const { t } = useTranslation()
  const mode = useAccountStore((s) => s.mode)
  const Button = inSidebar ? RailTooltipButton : ModeButton
  return (
    <div ref={ref} role="tablist" aria-label={t("nav.modeSwitch")}
      className="inline-grid shrink-0 grid-cols-2 gap-0.5 rounded-lg bg-muted p-0.5 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:justify-items-center">
      <Button icon={Monitor} label={t("nav.modeLauncher")} active={mode === "launcher"} testId="mode-launcher"
        onClick={() => useAccountStore.getState().exitWorkspace()} />
      <Button icon={MessagesSquare} label={t("nav.modeWorkspace")} active={mode === "workspace"} testId="mode-workspace"
        onClick={() => useAccountStore.getState().enterWorkspaceMode()} />
    </div>
  )
}
