import React, { useEffect, useState } from "react";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";

const EmptyState: React.FC = () => (
  <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 space-y-3">
    <svg
      className="w-12 h-12 text-gray-400 dark:text-gray-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M7 8h10M7 12h6m5 8H6a2 2 0 01-2-2V6a2 2 0 012-2h12a2 2 0 012 2v8l-4 4z"
      />
    </svg>
    <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">
      No Conversations Yet
    </h3>
    <p className="text-sm text-gray-500 dark:text-gray-400">
      Start the first conversation to share updates with the hiring team.
    </p>
  </div>
);

const DiscussionView: React.FC = () => {
  const [message, setMessage] = useState("");
  const [notificationType, setNotificationType] = useState("message");

  const {
    notifications,
    notificationsLoading,
    notificationsError,
    loadNotifications,
    addNotification,
  } = useInterviewPortalStore();

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim()) {
      return;
    }

    const success = await addNotification(message.trim(), {
      type: notificationType,
    });
    if (success) {
      setMessage("");
    }
  };

  const getTypeLabel = (type: string) => {
    const normalized = type?.toLowerCase();
    switch (normalized) {
      case "warning":
        return "Warning";
      case "success":
        return "Success";
      case "error":
      case "alert":
        return "Alert";
      case "info":
        return "Info";
      case "message":
      default:
        return "Message";
    }
  };

  const getTypeIcon = (type: string) => {
    const normalized = type?.toLowerCase();
    switch (normalized) {
      case "warning":
        return "⚠️";
      case "success":
        return "✅";
      case "error":
      case "alert":
        return "⛔";
      default:
        return "💬";
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <span className="text-sm font-semibold text-purple-600 uppercase tracking-wide">
              Discussion
            </span>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Interview Discussion
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm md:text-base">
              Share updates, questions, and feedback to stay aligned with the hiring team.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4 bg-gray-50/80 dark:bg-gray-900/50">
          {notificationsLoading && notifications.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm animate-pulse"
                >
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6 mb-2" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
                </div>
              ))}
            </div>
          ) : notificationsError && notifications.length === 0 ? (
            <div className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 p-6">
              <h2 className="text-lg font-semibold text-red-600 dark:text-red-300 mb-2">
                Failed to Load Discussions
              </h2>
              <p className="text-sm text-red-500 dark:text-red-200 mb-4">
                {notificationsError}
              </p>
              <button
                onClick={() => loadNotifications(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-white dark:bg-red-900/60 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/80 transition"
              >
                Retry
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {notifications.map((notification) => (
                <article
                  key={notification.notification_id}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow hover:shadow-lg transition duration-200"
                >
                  <div className="px-6 py-5 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-200 flex items-center justify-center font-semibold">
                          {getTypeIcon(notification.type)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {getTypeLabel(notification.type)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(
                              (notification.created_at || 0) * 1000
                            ).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                      {notification.message}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 px-8 py-5">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col md:flex-row md:items-center gap-3"
          >
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Share your update or question..."
              className="flex-1 min-h-[96px] md:min-h-[72px] rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            />
            <select
              value={notificationType}
              onChange={(event) => setNotificationType(event.target.value)}
              className="md:w-40 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition"
            >
              <option value="message">Message</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="alert">Alert</option>
              <option value="success">Success</option>
            </select>
            <button
              type="submit"
              disabled={!message.trim()}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              Send
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
};

export default DiscussionView;

