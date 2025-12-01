import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { notificationService } from "@/services/notificationService";

interface NotificationPermissionOverlayProps {
  // Optional external control props
  className?: string;
}

const NotificationPermissionOverlay: React.FC<
  NotificationPermissionOverlayProps
> = ({ className = "" }) => {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<NotificationPermission>("default");

  // Check if on /messaging path
  const isMessagingPage =
    location.pathname === "/messaging" ||
    location.pathname.startsWith("/messaging/");

  // Check if user chose "Don't show again"
  const checkNeverShowAgain = () => {
    try {
      const stored = localStorage.getItem("notification-permission-never-show");
      return stored === "true";
    } catch {
      return false;
    }
  };

  // Save "Do not show again" setting
  const saveNeverShowAgain = () => {
    try {
      localStorage.setItem("notification-permission-never-show", "true");
    } catch (error) {
      console.warn("Failed to save never show again preference:", error);
    }
  };

  // Check notification permission status
  const checkPermissionStatus = () => {
    if ("Notification" in window) {
      setPermissionStatus(Notification.permission);
      return Notification.permission;
    }
    // return 'denied';
    return "default";
  };

  // Check display conditions
  useEffect(() => {
    const shouldShowOverlay = () => {
      const never = checkNeverShowAgain();
      const permission = checkPermissionStatus();
      const onMessagingPage = isMessagingPage;

      return (
        onMessagingPage &&
        !never &&
        (permission === "default" || permission === "denied")
      );
    };

    const show = shouldShowOverlay();
    setIsVisible(show);
  }, [isMessagingPage]);

  // Listen for permission status changes
  useEffect(() => {
    const interval = setInterval(() => {
      const newStatus = checkPermissionStatus();
      if (newStatus !== permissionStatus) {
        setPermissionStatus(newStatus);
        if (newStatus === "granted") {
          handleClose();
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [permissionStatus]);

  // Request notification permission
  const requestPermission = async () => {
    try {
      const permission =
        await notificationService.checkSystemNotificationSupport();
      if (permission) {
        setPermissionStatus("granted");
        handleClose();
      } else {
        setPermissionStatus(Notification.permission);
      }
    } catch (error) {
      console.error("Failed to request notification permission:", error);
      setPermissionStatus(Notification.permission);
    }
  };

  // Close overlay
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
    }, 300);
  };

  // Not allow for now
  const handleNotNow = () => {
    handleClose();
  };

  // Do not show again
  const handleNeverShowAgain = () => {
    saveNeverShowAgain();
    handleClose();
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-sm transition-all duration-300 ease-in-out transform ${
        isClosing
          ? "opacity-0 translate-x-full scale-95"
          : "opacity-100 translate-x-0 scale-100"
      } ${className}`}
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-6 relative">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          aria-label="Close"
        >
          <svg
            className="w-5 h-5"
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

        {/* Title */}
        <div className="flex items-center mb-4 pr-6">
          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mr-3">
            <svg
              className="w-4 h-4 text-blue-600 dark:text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 17h5l-5 5v-5zM19 3H5a2 2 0 00-2 2v10a2 2 0 002 2h7l5-5V5a2 2 0 00-2-2z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Enable Message Notifications
          </h3>
        </div>

        {/* Description text */}
        <div className="mb-4 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            Enable notifications to receive timely alerts for:
          </p>
          <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1 ml-4">
            <li className="flex items-start">
              <span className="text-blue-500 mr-2 mt-0.5">•</span>
              Direct messages from others
            </li>
            <li className="flex items-start">
              <span className="text-blue-500 mr-2 mt-0.5">•</span>
              Mentions in channels
            </li>
            <li className="flex items-start">
              <span className="text-blue-500 mr-2 mt-0.5">•</span>
              Replies to your messages
            </li>
          </ul>
        </div>

        {/* Detailed settings guide */}
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md border border-yellow-200 dark:border-yellow-800/30">
          <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
            💡 Two steps to enable notifications:
          </h4>
          <div className="text-xs text-yellow-700 dark:text-yellow-400 space-y-2">
            <div>
              <strong>1. Browser settings:</strong>
              <div className="ml-3">
                Chrome: Settings → Privacy and security → Site Settings → Notifications →
                Ensure this site is set to "Allow"
              </div>
            </div>
            <div>
              <strong>2. System settings:</strong>
              <div className="ml-3">
                macOS: System Preferences → Notifications & Focus → Find Chrome →
                Enable notifications
              </div>
            </div>
          </div>
        </div>

        {/* Permission status hint */}
        {permissionStatus === "denied" && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800/30">
            <p className="text-xs text-red-700 dark:text-red-400">
              <strong>Permission denied:</strong>
              Please click the lock icon in your browser's address bar, set notifications to "Allow", then refresh the page.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col space-y-2">
          <button
            onClick={requestPermission}
            disabled={permissionStatus === "denied"}
            className={`w-full px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              permissionStatus === "denied"
                ? "bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
                : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
            }`}
          >
            {permissionStatus === "denied" ? "Permission Denied" : "Allow Notifications"}
          </button>

          <div className="flex space-x-2">
            <button
              onClick={handleNotNow}
              className="flex-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              Not Now
            </button>
            <button
              onClick={handleNeverShowAgain}
              className="flex-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              Don't Ask Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationPermissionOverlay;
