import React from "react";
import DefaultSidebar from "@/components/layout/DefaultSidebar";

/**
 * README Sidebar Component
 * Currently uses the default sidebar, can be extended as needed
 */
const ReadmeSidebar: React.FC = () => {
  return (
    <DefaultSidebar
      message="README Documentation"
      icon={
        <svg
          className="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      }
    />
  );
};

export default ReadmeSidebar;

