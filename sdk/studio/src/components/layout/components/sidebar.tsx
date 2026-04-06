import { useLocation } from "react-router-dom";
import { SidebarPrimary } from "./sidebar-primary";
import { SidebarSecondary } from "./sidebar-secondary";

// Routes that should hide the secondary sidebar (mod pages)
const HIDE_SECONDARY_SIDEBAR_ROUTES = [
  "/user-dashboard",
  "/readme",
  "/messaging",
  "/feed",
  "/project",
  "/forum",
  "/artifact",
  "/wiki",
  "/documents",
  "/agentworld",
  "/profile",
  "/mod-management",
  "/service-agents",
  "/llm-logs",
];

export function Sidebar() {
  const location = useLocation();

  // Hide secondary sidebar for all mod pages - use collapsed width
  const pathname = location.pathname.replace(/\/$/, ""); // Remove trailing slash
  const hideSecondary = HIDE_SECONDARY_SIDEBAR_ROUTES.some(
    route => pathname === route || pathname.startsWith(route + "/")
  );

  return (
    <aside className={`fixed overflow-hidden top-(--page-margin) bottom-(--page-margin) start-0 z-20 transition-all duration-300 flex items-stretch flex-shrink-0 bg-white dark:bg-zinc-950 ${
      hideSecondary
        ? "w-[70px]"
        : "w-(--sidebar-width) in-data-[sidebar-open=false]:w-(--sidebar-collapsed-width)"
    }`}>
      <SidebarPrimary />
      {!hideSecondary && <SidebarSecondary />}
    </aside>
  );
}
