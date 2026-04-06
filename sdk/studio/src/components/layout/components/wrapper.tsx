import { Outlet, useLocation } from 'react-router-dom';
import { useLayout } from './context';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { HeaderBreadcrumbs } from './header-breadcrumbs';

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

export function Wrapper() {
  const {isMobile} = useLayout();
  const location = useLocation();

  // Hide secondary sidebar for all mod pages - use collapsed width for main content margin
  const pathname = location.pathname.replace(/\/$/, ""); // Remove trailing slash
  const hideSecondary = HIDE_SECONDARY_SIDEBAR_ROUTES.some(
    route => pathname === route || pathname.startsWith(route + "/")
  );

  return (
    <>
      <Header />
      {!isMobile && <Sidebar />}

      <div className={`bg-background lg:border-e lg:border-b lg:border-border grow lg:overflow-y-auto lg:rounded-ee-xl pt-(--header-height-mobile) lg:mb-(--page-margin) lg:me-(--page-margin) lg:pt-0 lg:mt-[calc(var(--header-height)+var(--page-margin))] transition-all duration-300 ${
        hideSecondary
          ? "lg:ms-[70px] lg:rounded-es-xl lg:border-s"
          : "lg:ms-(--sidebar-width) lg:in-data-[sidebar-open=false]:ms-(--sidebar-collapsed-width) lg:in-data-[sidebar-open=false]:rounded-es-xl lg:in-data-[sidebar-open=false]:border-s"
      }`}>
        <main className="grow py-5 lg:py-7.5" role="content">
          {isMobile && <HeaderBreadcrumbs />}
          <Outlet />
        </main>
      </div>
    </>
  );
}
