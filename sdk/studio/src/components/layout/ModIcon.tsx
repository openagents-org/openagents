import React from "react";

interface ModIconProps {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hasNotification?: boolean;
}

const ModIcon: React.FC<ModIconProps> = ({
  isActive,
  onClick,
  icon,
  label,
  hasNotification = false,
}) => {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`
          w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 relative
          hover:scale-105 active:scale-95
          ${
            isActive
              ? "bg-blue-600 text-white shadow-lg"
              : "bg-gray-200 text-gray-600 hover:bg-gray-300 hover:text-gray-800 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white"
          }
        `}
        title={label}
      >
        {icon}
        {hasNotification && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-gray-800"></div>
        )}
      </button>

      {/* Tooltip */}
      <div
        className="
        absolute left-16 top-1/2 transform -translate-y-1/2 px-2 py-1 rounded-md text-sm font-medium
        opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50
        bg-gray-900 text-white dark:bg-gray-800 dark:border dark:border-gray-600
        shadow-lg whitespace-nowrap
      "
      >
        {label}
        <div
          className="
          absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1 w-2 h-2 rotate-45
          bg-gray-900 dark:bg-gray-800 dark:border-l dark:border-b dark:border-gray-600
        "
        ></div>
      </div>
    </div>
  );
};

// Cache ModIcon component
export default React.memo(ModIcon);
