import React from "react";
import { useReadmeStore, HeadingItem } from "@/stores/readmeStore";

/**
 * README Sidebar Component
 * Displays document structure / table of contents based on markdown headings
 */
const ReadmeSidebar: React.FC = () => {
  const headings = useReadmeStore((state) => state.headings);

  const handleHeadingClick = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Calculate indentation based on heading level
  const getIndentClass = (level: number): string => {
    switch (level) {
      case 1:
        return "pl-0";
      case 2:
        return "pl-3";
      case 3:
        return "pl-6";
      case 4:
        return "pl-9";
      case 5:
        return "pl-12";
      case 6:
        return "pl-14";
      default:
        return "pl-0";
    }
  };

  // Get font styling based on heading level
  const getFontClass = (level: number): string => {
    switch (level) {
      case 1:
        return "font-semibold text-gray-900 dark:text-gray-100";
      case 2:
        return "font-medium text-gray-800 dark:text-gray-200";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <svg
            className="w-5 h-5 text-gray-500 dark:text-gray-400"
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
          <span className="font-medium text-gray-700 dark:text-gray-300">
            README Documentation
          </span>
        </div>
      </div>

      {/* Table of Contents */}
      <div className="flex-1 overflow-y-auto p-4">
        {headings.length > 0 ? (
          <nav className="space-y-1">
            {headings.map((heading: HeadingItem, index: number) => (
              <button
                key={`${heading.id}-${index}`}
                onClick={() => handleHeadingClick(heading.id)}
                className={`
                  w-full text-left py-1.5 px-2 rounded-md text-sm
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors duration-150
                  ${getIndentClass(heading.level)}
                  ${getFontClass(heading.level)}
                `}
                title={heading.text}
              >
                <span className="block truncate">{heading.text}</span>
              </button>
            ))}
          </nav>
        ) : (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <svg
              className="w-8 h-8 mx-auto mb-2 text-gray-400"
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
            <p className="text-sm">No document structure</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReadmeSidebar;
