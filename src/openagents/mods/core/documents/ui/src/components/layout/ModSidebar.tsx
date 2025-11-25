import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import ModIcon from "./ModIcon";

// Documents module icon
const DocumentsIcon = () => (
  <svg
    className="w-6 h-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

const ModSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Documents module navigation
  const documentsRoute = "/documents";
  const isDocumentsActive = location.pathname.startsWith(documentsRoute);

  // Handle navigation click
  const handleNavigation = (route: string) => {
    navigate(route);
  };

  return (
    <div
      className="
      w-16 h-full flex flex-col items-center py-4 border-r transition-colors duration-200
      bg-gray-100 border-gray-200 dark:bg-gray-900 dark:border-gray-700
    "
    >
      {/* Logo/Brand Icon */}
      <div className="mb-6">
        <div
          className="
          w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg
          bg-gradient-to-br from-blue-600 to-indigo-600 text-white
          shadow-lg
        "
        >
          📄
        </div>
      </div>

      {/* Documents Icon */}
      <div className="flex flex-col space-y-3 flex-1">
        <ModIcon
          isActive={isDocumentsActive}
          onClick={() => handleNavigation(documentsRoute)}
          label="Documents"
          icon={<DocumentsIcon />}
        />
      </div>
    </div>
  );
};

// Cache entire ModSidebar component
export default React.memo(ModSidebar);
