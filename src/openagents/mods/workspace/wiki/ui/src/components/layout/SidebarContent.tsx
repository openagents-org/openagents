import React from "react";
import { useLocation } from "react-router-dom";
import DefaultSidebar from "./DefaultSidebar";
import WikiSidebar from "../../pages/WikiSidebar";

// SidebarContent component - dynamically displays different sidebar content based on route
// For Wiki UI, we only need WikiSidebar
const SidebarContent: React.FC = () => {
  const location = useLocation();

  // Decide which sidebar content to display based on current route
  const renderContent = () => {
    const pathname = location.pathname;

    if (pathname.startsWith("/wiki")) {
      // WikiSidebar gets needed data through hooks itself
      return <WikiSidebar />;
    }

    // Default case
    return <DefaultSidebar />;
  };

  return <div className="h-full overflow-y-auto">{renderContent()}</div>;
};

export default React.memo(SidebarContent);

