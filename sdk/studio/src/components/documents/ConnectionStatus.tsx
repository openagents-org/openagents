import React from "react";
import { ConnectionStatus as Status } from "@/services/collaborationService";

interface ConnectionStatusProps {
  status: Status;
  theme: "light" | "dark";
  className?: string;
}

const ConnectionStatusIndicator: React.FC<ConnectionStatusProps> = ({
  status,
  theme,
  className = "",
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case Status.CONNECTED:
        return {
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-100 dark:bg-green-900/20",
          borderColor: "border-green-200 dark:border-green-800/50",
          icon: (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ),
          text: "Connected",
          description: "Real-time collaboration enabled",
          dot: "bg-green-500 animate-pulse",
        };

      case Status.CONNECTING:
        return {
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-100 dark:bg-blue-900/20",
          borderColor: "border-blue-200 dark:border-blue-800/50",
          icon: (
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          ),
          text: "Connecting",
          description: "Establishing connection...",
          dot: "bg-blue-500 animate-pulse",
        };

      case Status.RECONNECTING:
        return {
          color: "text-yellow-600 dark:text-yellow-400",
          bgColor: "bg-yellow-100 dark:bg-yellow-900/20",
          borderColor: "border-yellow-200 dark:border-yellow-800/50",
          icon: (
            <svg
              className="w-4 h-4 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          ),
          text: "Reconnecting",
          description: "Connection interrupted, reconnecting...",
          dot: "bg-yellow-500 animate-pulse",
        };

      case Status.DISCONNECTED:
      default:
        return {
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-100 dark:bg-red-900/20",
          borderColor: "border-red-200 dark:border-red-800/50",
          icon: (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.864-.833-2.634 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          ),
          text: "Disconnected",
          description: "Collaboration feature unavailable",
          dot: "bg-red-500",
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {/* Status dot */}
      <div className="relative">
        <div className={`w-2 h-2 rounded-full ${config.dot}`}></div>
      </div>

      {/* Status text */}
      <div className="flex items-center space-x-1">
        <div className={config.color}>{config.icon}</div>
        <span className={`text-sm font-medium ${config.color}`}>
          {config.text}
        </span>
      </div>

      {/* Detailed status (shown on hover) */}
      <div className="relative group">
        <div
          className={`
          absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 rounded-lg shadow-lg border text-sm
          opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 whitespace-nowrap
          ${config.bgColor} ${config.borderColor} ${config.color}
        `}
        >
          {config.description}

          {/* Arrow */}
          <div
            className={`
            absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0
            border-l-4 border-r-4 border-t-4 border-transparent ${config.borderColor.replace(
              "border-",
              "border-t-"
            )}
          `}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionStatusIndicator;
