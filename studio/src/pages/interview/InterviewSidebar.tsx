import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";
import { isInterviewHubMode } from "@/config/interviewHubConfig";

interface NavigationItem {
  label: string;
  description: string;
  to: string;
  icon: React.ReactNode;
}

const navItems: NavigationItem[] = [
  {
    label: "Job Description",
    description: "Browse available openings",
    to: "/interview",
    icon: (
      <svg
        className="w-5 h-5"
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
    ),
  },
  {
    label: "Interviewer Hub",
    description: "Stay in sync with recruiters",
    to: "/interview/interviewer-hub",
    icon: (
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2V6a2 2 0 012-2h6a2 2 0 012 2v2z"
        />
      </svg>
    ),
  },
];

const InterviewSidebar: React.FC = () => {
  const location = useLocation();
  const { assessmentStatus, userInfo } =
    useInterviewPortalStore();

  return (
    <div className="h-full flex flex-col bg-white/60 dark:bg-gray-900/60 backdrop-blur">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        {!isInterviewHubMode() && (
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
            Interview Workspace
          </p>
        )}
        <h2 className={`${isInterviewHubMode() ? "" : "mt-1 "}text-xl font-bold text-gray-900 dark:text-gray-100`}>
          {isInterviewHubMode() ? "AI Interview Hub" : "Interview Hub"}
        </h2>
        {assessmentStatus && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20 px-3 py-2">
            <p className="text-xs text-blue-700 dark:text-blue-200 leading-relaxed">
              General Assessment:&nbsp;
              {assessmentStatus.general_assessment_completed
                ? "Completed"
                : "Pending"}
            </p>
          </div>
        )}
      </div>

      <nav className="px-3 py-4 space-y-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            item.to === "/interview"
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`group flex items-start gap-3 px-3 py-3 rounded-xl border transition hover:-translate-y-0.5 hover:shadow ${
                isActive
                  ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/30 dark:text-blue-200"
                  : "border-transparent bg-white dark:bg-gray-900/40 text-gray-700 dark:text-gray-200 hover:border-blue-100 dark:hover:border-blue-800/40 hover:bg-blue-50/40 dark:hover:bg-blue-900/20"
              }`}
            >
              <span
                className={`mt-0.5 p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200 shadow-sm`}
              >
                {item.icon}
              </span>
              <span>
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                  {item.description}
                </span>
              </span>
            </NavLink>
          );
        })}
      </nav>

      <div className="mt-auto space-y-0">
        {userInfo && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              User Information
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-md">
                  {userInfo.first_name.charAt(0).toUpperCase()}
                  {userInfo.last_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {userInfo.first_name} {userInfo.last_name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {userInfo.email}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default React.memo(InterviewSidebar);
