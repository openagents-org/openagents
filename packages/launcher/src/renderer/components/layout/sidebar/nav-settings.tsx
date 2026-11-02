import React from "react"
import { ChevronRight, Settings } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible"
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@renderer/components/ui/sidebar"
import { useAccountStore } from "@renderer/store/account"
import { useSidebarStore } from "@renderer/store/sidebar"
import { useUiStore } from "@renderer/store/ui"
import { cn } from "@renderer/lib/utils"
import {
  DEFAULT_SECTION,
  SECTION_GROUPS,
  type SectionId,
} from "@renderer/pages/settings/section-config"

/** Leave the Workspace if needed, then show one settings module. */
function openSection(id: SectionId): void {
  useAccountStore.getState().exitWorkspace()
  useUiStore.getState().openSettingsSection(id)
}

/**
 * Settings, as an entry that opens in place: its modules list under it while it
 * is open and fold away again with a second click, so the sidebar is only as
 * long as what the user is doing. Opening it also shows Settings, on the
 * module last seen there.
 *
 * In the icon rail there is nowhere to list the modules, so the gear widens
 * the sidebar first.
 */
export function NavSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const { state, isMobile } = useSidebar()
  const open = useSidebarStore((s) => s.settingsOpen)
  const setOpen = useSidebarStore((s) => s.setSettingsOpen)
  const { onSettings, visible, deepLinkSignal } = useUiStore(
    useShallow((s) => ({
      onSettings: s.currentTab === "settings",
      visible: s.visibleSettingsSection,
      deepLinkSignal: s.settingsSectionSignal,
    })),
  )
  const inLauncher = useAccountStore((s) => s.mode === "launcher")
  const showing = inLauncher && onSettings

  // Arriving from elsewhere — the update banner, the command palette — opens
  // the group, so the module on screen is also the one lit in the list.
  React.useEffect(() => {
    if (deepLinkSignal > 0) setOpen(true)
  }, [deepLinkSignal, setOpen])

  const onToggle = (next: boolean): void => {
    const fromRail = state === "collapsed" && !isMobile
    if (fromRail) useSidebarStore.getState().setOpen(true)
    setOpen(fromRail || next)
    if ((fromRail || next) && !showing) openSection((visible as SectionId | null) ?? DEFAULT_SECTION)
  }

  const label = t("nav.items.settings.label")

  return (
    <Collapsible asChild open={open} onOpenChange={onToggle} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            // Lit while folded, so the group still says where the user is.
            isActive={showing && !open}
            tooltip={label}
            data-testid="nav-settings"
          >
            <Settings />
            <span>{label}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {SECTION_GROUPS.map((group, index) => (
              <React.Fragment key={group.id}>
                {index > 0 && <li aria-hidden className="mx-2 my-1 h-px bg-sidebar-border" />}
                {group.sections.map((section) => {
                  const active = showing && visible === section.id
                  return (
                    <SidebarMenuSubItem key={section.id}>
                      <SidebarMenuSubButton asChild isActive={active} className={cn(active && "font-medium")}>
                        <button type="button" data-testid={`settings-nav-${section.id}`} onClick={() => openSection(section.id)}>
                          <span>{t(`settings.sections.${section.id}`)}</span>
                        </button>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )
                })}
              </React.Fragment>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
