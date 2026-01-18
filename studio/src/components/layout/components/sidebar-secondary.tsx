import { useLocation } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarHeader } from "./sidebar-header";
import SidebarContent from "../SidebarContent";

export function SidebarSecondary() {
  const location = useLocation();

  // Hide completely for user-dashboard
  const pathname = location.pathname.replace(/\/$/, "");
  if (pathname === "/user-dashboard" || pathname.startsWith("/user-dashboard/")) {
    return null;
  }

  return (
    <div className="lg:rounded-s-xl bg-white dark:bg-zinc-950 overflow-hidden border-t border-l border-b md:border-r border-gray-200 dark:border-gray-700 flex flex-col w-full h-full">
      <SidebarHeader />
      <ScrollArea className="shrink-0 flex-1 mt-0 mb-2.5 h-full">
        <div className="h-full">
          {/* Dynamic content based on route */}
          <SidebarContent />
        </div>
      </ScrollArea>
    </div>
  );
}
