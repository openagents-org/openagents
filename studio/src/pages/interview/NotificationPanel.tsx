import React, { useMemo } from "react";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";

const NotificationPanel: React.FC = () => {
  const {
    notifications,
    notificationsLoading,
    notificationsError,
    loadNotifications,
    markNotificationRead,
  } = useInterviewPortalStore();

  const sortedNotifications = useMemo(() => {
    return [...notifications].sort(
      (a, b) => (b.created_at || 0) - (a.created_at || 0)
    );
  }, [notifications]);

  return (
    <aside className="hidden xl:flex xl:w-80 flex-col border-l border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 backdrop-blur">
      <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
              Notifications
            </p>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Notification Center
            </h2>
          </div>
          <button
            onClick={() => loadNotifications(true)}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Refresh
          </button>
        </div>
        {notificationsError && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-300">
            {notificationsError}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {notificationsLoading && notifications.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm animate-pulse space-y-2"
              >
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : sortedNotifications.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 px-4">
            <svg
              className="w-10 h-10 text-gray-400 dark:text-gray-600 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            <p className="text-sm font-medium">Nothing yet</p>
            <p className="text-xs mt-1">
              Stay tuned - updates from the hiring team will appear here.
            </p>
          </div>
        ) : (
          sortedNotifications.map((notification) => (
            <button
              key={notification.notification_id}
              onClick={() =>
                markNotificationRead(notification.notification_id)
              }
              className={`w-full text-left p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow transition hover:shadow-md focus:outline-none ${
                notification.read
                  ? "opacity-80"
                  : "ring-1 ring-blue-100 dark:ring-blue-900/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {notification.level === "warning"
                      ? "Warning"
                      : notification.level === "success"
                      ? "Success"
                      : notification.level === "error"
                      ? "Alert"
                      : "Notice"}
                  </p>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {new Date((notification.created_at || 0) * 1000).toLocaleString()}
                  </p>
                </div>
                {!notification.read && (
                  <span className="w-2 h-2 rounded-full bg-blue-500 mt-1" />
                )}
              </div>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-200 line-clamp-4 whitespace-pre-line">
                {notification.message}
              </p>
            </button>
          ))
        )}
      </div>
    </aside>
  );
};

export default NotificationPanel;

