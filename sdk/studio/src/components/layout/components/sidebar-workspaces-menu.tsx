import { useCallback } from "react";
import { Link, useLocation } from "react-router";
import { MENU_SIDEBAR_WORKSPACES } from "@/config/layout-21.config";
import {
  AccordionMenu,
  AccordionMenuIndicator,
  AccordionMenuSub,
  AccordionMenuSubTrigger,
  AccordionMenuSubContent,
  AccordionMenuItem,
} from '@/components/ui/accordion-menu';
import { Badge } from '@/components/ui/badge';
import { Minus, Plus } from "lucide-react";

export function SidebarWorkspacesMenu() {
  const { pathname } = useLocation();

  // Memoize matchPath to prevent unnecessary re-renders
  const matchPath = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path) && path !== '/layout-21'),
    [pathname],
  );

  return (
    <AccordionMenu
      selectedValue="workspace-trigger"
      matchPath={matchPath}
      type="single"
      collapsible
      defaultValue="workspace-trigger"
      className="space-y-7.5 px-2.5"
      classNames={{
        item: 'h-8.5 px-2.5 text-sm font-normal text-foreground hover:text-primary hover:bg-background data-[selected=true]:bg-gray-100 data-[selected=true]:text-foreground [&[data-selected=true]_svg]:opacity-100',
        subTrigger: 'text-xs font-normal text-muted-foreground hover:bg-transparent group [&_[data-slot="accordion-menu-sub-indicator"]]:hidden',
        subContent: 'ps-0',
        indicator: 'ms-auto flex items-center font-medium',
      }}
    >
      {MENU_SIDEBAR_WORKSPACES.map((item, index) => (
        <AccordionMenuSub key={index} value="workspaces">
          <AccordionMenuSubTrigger value="workspace-trigger">
            <span>{item.title}</span>
            <AccordionMenuIndicator>
              <Plus className="size-3.5 shrink-0 transition-transform duration-200 hidden group-data-[state=open]:block" />
              <Minus className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:hidden" />
            </AccordionMenuIndicator>
          </AccordionMenuSubTrigger>

          <AccordionMenuSubContent type="single" collapsible parentValue="workspace-trigger">
            {item.children?.map((child, index) => (
              <AccordionMenuItem key={index} value={child.path || '#'}>
                <Link to={child.path || '#'}>
                  {child.icon && <child.icon />}
                  <span>{child.title}</span>
                  {child.badge == 'Pro' && <Badge size="sm" variant="success" appearance="light">{child.badge}</Badge>}
                </Link>
              </AccordionMenuItem>
            ))}
          </AccordionMenuSubContent>
        </AccordionMenuSub>
      ))}
    </AccordionMenu>
  );
}
