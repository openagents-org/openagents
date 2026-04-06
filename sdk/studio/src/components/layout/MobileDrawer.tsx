import React, { useEffect } from "react";
import Sidebar from "./Sidebar";
import { SidebarSecondary } from "./components/sidebar-secondary";
import { LayoutProvider } from "./components/context";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Mobile drawer component that contains Sidebar (primary) and SidebarSecondary
 * Used for mobile responsive layout
 */
const MobileDrawer: React.FC<MobileDrawerProps> = ({ isOpen, onClose }) => {
  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Completely hide: only render when open
  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="
          fixed top-0 left-0 h-full z-50
          flex transition-transform duration-300 ease-in-out
          bg-white dark:bg-gray-800
          w-[85%] max-w-[400px]
          shadow-xl
        "
      >
        <LayoutProvider>
          {/* Primary Sidebar */}
          <div className="flex-shrink-0">
            <Sidebar />
          </div>

          {/* Secondary Sidebar */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <SidebarSecondary />
          </div>
        </LayoutProvider>

        {/* Close button */}
        <button
          onClick={onClose}
          className="
            absolute top-4 right-4 p-2 rounded-lg
            bg-white dark:bg-gray-800
            hover:bg-gray-100 dark:hover:bg-gray-700
            transition-colors duration-200
            shadow-lg
            z-10
            border border-gray-200 dark:border-gray-700
          "
          aria-label="Close drawer"
        >
          <svg
            className="w-5 h-5 text-gray-600 dark:text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </>
  );
};

export default MobileDrawer;

