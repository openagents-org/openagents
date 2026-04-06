import { useCallback } from "react";
import { Link, useLocation } from "react-router";
import { MENU_SIDEBAR_RESOURCES } from "@/config/layout-21.config";
import {
  AccordionMenu,
  AccordionMenuIndicator,
  AccordionMenuSub,
  AccordionMenuSubTrigger,
  AccordionMenuSubContent,
  AccordionMenuItem,
} from '@/components/ui/accordion-menu';
import { Badge } from '@/components/ui/badge';

export function SidebarResourcesMenu() {
  const { pathname } = useLocation();

  // Memoize matchPath to prevent unnecessary re-renders
  const matchPath = useCallback(
    (path: string): boolean =>
      path === pathname || (path.length > 1 && pathname.startsWith(path) && path !== '/layout-21'),
    [pathname],
  );

  return (
    <AccordionMenu
      selectedValue="resource-trigger"
      matchPath={matchPath}
      type="single"
      collapsible
      defaultValue="resource-trigger"
      className="space-y-7.5 px-2.5"
      classNames={{
        item: 'h-8.5 px-2.5 text-sm font-normal text-foreground hover:text-primary data-[selected=true]:bg-gray-100 data-[selected=true]:text-foreground [&[data-selected=true]_svg]:opacity-100',
        subTrigger: 'text-xs font-normal text-muted-foreground hover:bg-transparent',
        subContent: 'ps-0',
      }}
    >
      {MENU_SIDEBAR_RESOURCES.map((item, index) => (
        <AccordionMenuSub key={index} value="resources">
          <AccordionMenuSubTrigger value="resource-trigger">
            <span>{item.title}</span>
            <AccordionMenuIndicator />
          </AccordionMenuSubTrigger>

          <AccordionMenuSubContent type="single" collapsible parentValue="resource-trigger">
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
