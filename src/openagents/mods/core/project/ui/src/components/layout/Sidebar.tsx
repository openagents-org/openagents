import React from "react";
import ProjectSidebar from "../../pages/ProjectSidebar";

const Sidebar: React.FC = () => {
  return (
    <aside className="w-80 h-full border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <ProjectSidebar />
    </aside>
  );
};

export default Sidebar;

