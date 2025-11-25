import React from "react";
import { useLocation } from "react-router-dom";
import DefaultSidebar from "./DefaultSidebar";
import DocumentsSidebar from "../../pages/DocumentsSidebar";

// SidebarContent component - dynamically displays different sidebar content based on route
// Each specific sidebar component manages its own data, no need to pass from outside
const SidebarContent: React.FC = () => {
  const location = useLocation();

  // Decide which sidebar content to display based on current route
  const renderContent = () => {
    const pathname = location.pathname;

    if (pathname.startsWith("/documents")) {
      // DocumentsSidebar gets needed data through hooks itself
      return <DocumentsSidebar />;
    }

    // Default case
    return <DefaultSidebar />;
  };

  return <div className="h-full overflow-y-auto">{renderContent()}</div>;
};

export default React.memo(SidebarContent);

