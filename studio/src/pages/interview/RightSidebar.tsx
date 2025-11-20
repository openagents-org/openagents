import React, { useState, useMemo, useEffect } from "react";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";

type Tab = "notifications" | "tasks";

const RightSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>("tasks");
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  const {
    connection,
    notifications,
    notificationsLoading,
    notificationsError,
    loadNotifications,
    markNotificationRead,
    interviews,
    interviewsLoading,
    interviewsError,
    loadInterviews,
    jobs,
    jobDetails,
    loadJobDetail,
    userInfo,
    startTask,
  } = useInterviewPortalStore();

  // Load interviews when connection is available
  useEffect(() => {
    if (!connection) return;
    loadInterviews(true);
  }, [connection, loadInterviews]);

  // Load job details for interviews
  useEffect(() => {
    interviews.forEach((interview) => {
      if (interview.job_id && !jobDetails[interview.job_id]) {
        loadJobDetail(interview.job_id);
      }
    });
  }, [interviews, jobDetails, loadJobDetail]);

  const sortedNotifications = useMemo(() => {
    return [...notifications].sort(
      (a, b) => (b.created_at || 0) - (a.created_at || 0)
    );
  }, [notifications]);

  const jobMap = useMemo(() => {
    const map = new Map<string, (typeof jobs)[number]>();
    jobs.forEach((job) => {
      map.set(job.job_id, job);
    });
    return map;
  }, [jobs]);

  const orderedInterviews = useMemo(() => {
    return [...interviews].sort((a, b) => {
      const timeA = a.updated_at ?? a.created_at ?? 0;
      const timeB = b.updated_at ?? b.created_at ?? 0;
      return timeB - timeA;
    });
  }, [interviews]);

  const unreadCount = useMemo(() => {
    return sortedNotifications.filter((n) => n.status === "unread").length;
  }, [sortedNotifications]);

  const scheduledCount = useMemo(() => {
    return orderedInterviews.filter((i) => i.status === "scheduled").length;
  }, [orderedInterviews]);

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
      case "message":
      case "info":
      default:
        return "Notice";
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

  const getJobInfo = (interview: (typeof interviews)[number]) => {
    if (!interview.job_id) {
      return {
        title: "Unassigned Role",
        company: undefined,
        imageUrl: undefined,
      };
    }

    const jobDetail = jobDetails[interview.job_id];
    const jobSummary = jobMap.get(interview.job_id);
    const imageUrl = jobDetail?.image_url;
    const hasImageError = imageErrors.has(interview.job_id);

    return {
      title: jobDetail?.title || jobSummary?.title || interview.job_id,
      company: jobDetail?.company || jobSummary?.company,
      imageUrl: imageUrl && !hasImageError ? imageUrl : undefined,
    };
  };

  const handleImageError = (jobId: string) => {
    setImageErrors((prev) => new Set(prev).add(jobId));
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200";
      case "cancelled":
        return "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-200";
      case "scheduled":
        return "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200";
      default:
        return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const handleInterviewClick = (interview: (typeof interviews)[number]) => {
    if (interview.interview_url) {
      window.open(interview.interview_url, "_blank");
    }
  };

  const handleTaskClick = async (task: any) => {
    if (task.link) {
      // Task already has a link, open it
      window.open(task.link, "_blank");
    } else if (task.status === "pending") {
      // Generate link and open it
      const result = await startTask(task.task_id);
      if (result.success && result.link) {
        window.open(result.link, "_blank");
      }
    }
  };

  const userTasks = userInfo?.tasks || [];
  const pendingTasksCount = userTasks.filter(
    (t) => t.status === "pending"
  ).length;

  return (
    <aside className="hidden xl:flex xl:w-80 flex-col border-l border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 backdrop-blur">
      {/* Header with Tabs */}
      <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {activeTab === "notifications" ? "Notifications" : "Tasks"}
          </p>
          <button
            onClick={() =>
              activeTab === "notifications"
                ? loadNotifications(true)
                : loadInterviews(true)
            }
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Refresh
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition ${
              activeTab === "tasks"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Tasks
            {pendingTasksCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-blue-600 text-white">
                {pendingTasksCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("notifications")}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition ${
              activeTab === "notifications"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-blue-600 text-white">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Error Messages */}
        {activeTab === "notifications" && notificationsError && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-300">
            {notificationsError}
          </p>
        )}
        {activeTab === "tasks" && interviewsError && (
          <p className="mt-2 text-xs text-red-500 dark:text-red-300">
            {interviewsError}
          </p>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {activeTab === "notifications" ? (
          // Notifications Tab Content
          <>
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
                        {getTypeLabel(notification.type)}
                      </p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(
                          (notification.created_at || 0) * 1000
                        ).toLocaleString()}
                      </p>
                    </div>
                    {notification.status === "unread" && (
                      <span className="w-2 h-2 rounded-full bg-blue-500 mt-1" />
                    )}
                  </div>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-200 line-clamp-4 whitespace-pre-line">
                    {getTypeIcon(notification.type)} {notification.message}
                  </p>
                </button>
              ))
            )}
          </>
        ) : (
          // Tasks Tab Content (User Tasks)
          <>
            {userTasks.length === 0 ? (
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
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
                <p className="text-sm font-medium">No tasks yet</p>
                <p className="text-xs mt-1">
                  Your tasks will appear here once you register.
                </p>
              </div>
            ) : (
              userTasks.map((task) => (
                <button
                  key={task.task_id}
                  onClick={() => handleTaskClick(task)}
                  className="w-full text-left p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow transition hover:shadow-md focus:outline-none"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
                      {task.status === "completed" ? "✓" : task.status === "in_progress" ? "→" : "!"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {task.name}
                        </h3>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${
                            task.status === "completed"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200"
                              : task.status === "in_progress"
                              ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200"
                              : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-200"
                          }`}
                        >
                          {task.status === "in_progress" ? "In Progress" : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                        </span>
                      </div>

                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                        {task.status === "pending"
                          ? "Click to start this task"
                          : task.status === "in_progress"
                          ? "Click to continue"
                          : "Task completed"}
                      </p>

                      <p className="text-xs text-gray-500 dark:text-gray-500">
                        Created:{" "}
                        {new Date(task.created_timestamp * 1000).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  );
};

export default RightSidebar;
