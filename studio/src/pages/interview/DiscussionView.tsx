import React, { useEffect, useMemo, useState } from "react";
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

const InfoTile: React.FC<{ label: string; value?: React.ReactNode }> = ({
  label,
  value,
}) => {
  const displayValue =
    value === undefined || value === null || value === "" ? (
      <span className="text-gray-400 dark:text-gray-500">Not provided</span>
    ) : (
      value
    );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <div className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
        {displayValue}
      </div>
    </div>
  );
};

const DiscussionView: React.FC = () => {
  const [message, setMessage] = useState("");
  const [notificationType, setNotificationType] = useState("message");

  const {
    notifications,
    notificationsLoading,
    notificationsError,
    loadNotifications,
    addNotification,
    interviews,
    interviewsLoading,
    interviewsError,
    loadInterviews,
    jobs,
  } = useInterviewPortalStore();

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    loadInterviews();
  }, [loadInterviews]);

  const sortedInterviews = useMemo(() => {
    return [...interviews].sort((a, b) => {
      const timeA = a.updated_at ?? a.created_at ?? 0;
      const timeB = b.updated_at ?? b.created_at ?? 0;
      return timeB - timeA;
    });
  }, [interviews]);

  const candidateData = useMemo(() => {
    if (sortedInterviews.length === 0) {
      return null;
    }

    const interview = sortedInterviews[0];
    const job = interview.job_id
      ? jobs.find((item) => item.job_id === interview.job_id)
      : undefined;

    const baseRecord =
      interview.results &&
      typeof interview.results === "object" &&
      !Array.isArray(interview.results)
        ? (interview.results as Record<string, unknown>)
        : {};

    const nestedKeys = ["candidate", "candidate_details", "profile", "applicant"];
    const mergedNested = nestedKeys.reduce<Record<string, unknown>>((acc, key) => {
      const candidateSection = baseRecord[key];
      if (
        candidateSection &&
        typeof candidateSection === "object" &&
        !Array.isArray(candidateSection)
      ) {
        return {
          ...acc,
          ...(candidateSection as Record<string, unknown>),
        };
      }
      return acc;
    }, {});

    const combined = {
      ...baseRecord,
      ...mergedNested,
    } as Record<string, unknown>;

    const getString = (keys: string[], fallback?: string) => {
      for (const key of keys) {
        const value = combined[key];
        if (value === undefined || value === null) {
          continue;
        }
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed.length > 0) {
            return trimmed;
          }
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }
      }
      return fallback;
    };

    const getArray = (keys: string[]) => {
      for (const key of keys) {
        const value = combined[key];
        if (Array.isArray(value)) {
          return value
            .map((item) =>
              typeof item === "string" ? item : item != null ? String(item) : ""
            )
            .filter(Boolean);
        }
        if (typeof value === "string") {
          const parts = value
            .split(/[,|]/)
            .map((part) => part.trim())
            .filter(Boolean);
          if (parts.length > 0) {
            return parts;
          }
        }
      }
      return [];
    };

    const name =
      getString(["candidate_name", "name", "full_name", "display_name"]) ||
      "Unknown Candidate";
    const email = getString(["candidate_email", "email", "contact_email"]);
    const phone = getString(["candidate_phone", "phone", "contact_phone", "mobile"]);
    const location =
      getString(["candidate_location", "location", "city", "country"]) ||
      job?.location ||
      "Not provided";
    const experienceRaw = getString([
      "experience_years",
      "years_of_experience",
      "experience",
      "experienceYears",
    ]);
    const experience =
      experienceRaw && /^\d+(\.\d+)?$/.test(experienceRaw)
        ? `${experienceRaw} years`
        : experienceRaw || "Not provided";
    const resumeLink = getString(["resume_url", "resume", "cv_url", "portfolio_url"]);
    const notes =
      interview.notes ||
      getString(["notes", "summary", "overview", "comments", "feedback"]);
    const skills = getArray(["skills", "key_skills", "strengths", "expertise"]);

    const timestamp = interview.updated_at ?? interview.created_at ?? null;
    const lastUpdated =
      typeof timestamp === "number"
        ? new Date(timestamp * 1000).toLocaleString()
        : "Not specified";

    return {
      interview,
      job,
      name,
      email,
      phone,
      location,
      experience,
      resumeLink,
      notes,
      skills,
      status: interview.status || "Not specified",
      interviewType: interview.interview_type || "Not specified",
      duration:
        typeof interview.duration_minutes === "number"
          ? `${interview.duration_minutes} minutes`
          : "Not specified",
      lastUpdated,
    };
  }, [jobs, sortedInterviews]);

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

  const getInitials = (name: string) => {
    if (!name) {
      return "UN";
    }
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className="h-full flex flex-col">
      <section className="px-8 py-6 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80">
        {interviewsLoading && !candidateData ? (
          <div className="animate-pulse space-y-4">
            <div className="h-10 w-2/3 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                />
              ))}
            </div>
          </div>
        ) : !candidateData ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Candidate Profile
              </p>
              <h1 className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">
                Awaiting interview data
              </h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Refresh the interview feed once a candidate joins the pipeline to view their profile here.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {interviewsError && (
                <span className="text-sm text-red-500 dark:text-red-300">
                  {interviewsError}
                </span>
              )}
              <button
                onClick={() => loadInterviews(true)}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
              >
                Refresh Profile
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-200 flex items-center justify-center text-xl font-semibold">
                  {getInitials(candidateData.name)}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-300">
                    Candidate Profile
                  </p>
                  <h1 className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">
                    {candidateData.name}
                  </h1>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    {candidateData.job?.title || "Role pending"}
                    {candidateData.job?.company ? ` · ${candidateData.job.company}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Last updated: {candidateData.lastUpdated}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 text-xs font-semibold uppercase tracking-widest">
                  {candidateData.status}
                </span>
                <button
                  onClick={() => loadInterviews(true)}
                  className="inline-flex items-center px-5 py-3 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition font-medium"
                >
                  Refresh Profile
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <InfoTile
                label="Email"
                value={
                  candidateData.email ? (
                    <a
                      href={`mailto:${candidateData.email}`}
                      className="text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                    >
                      {candidateData.email}
                    </a>
                  ) : undefined
                }
              />
              <InfoTile label="Phone" value={candidateData.phone} />
              <InfoTile label="Location" value={candidateData.location} />
              <InfoTile label="Experience" value={candidateData.experience} />
              <InfoTile label="Interview Type" value={candidateData.interviewType} />
              <InfoTile label="Planned Duration" value={candidateData.duration} />
              <InfoTile
                label="Resume"
                value={
                  candidateData.resumeLink ? (
                    <a
                      href={candidateData.resumeLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                    >
                      View resume
                    </a>
                  ) : undefined
                }
              />
              <InfoTile
                label="Hiring Team Alignment"
                value={
                  candidateData.job?.company ? (
                    <>
                      {candidateData.job.company}
                      {candidateData.job.location ? ` · ${candidateData.job.location}` : ""}
                    </>
                  ) : undefined
                }
              />
              <InfoTile label="Interview ID" value={candidateData.interview.interview_id} />
            </div>

            {candidateData.skills.length > 0 && (
              <div className="mt-6">
                <p className="text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  Core Skills
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {candidateData.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 text-xs font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {candidateData.notes && (
              <div className="mt-6">
                <p className="text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  Interview Notes
                </p>
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                  {candidateData.notes}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-8 py-4 border-b border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                Discussion Feed
              </p>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Collaborative Comments
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Document questions, decisions, and follow-ups so the full team stays aligned.
              </p>
            </div>
            <button
              onClick={() => loadNotifications(true)}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-sm font-medium"
            >
              Refresh Comments
            </button>
          </div>
          {notificationsError && notifications.length > 0 && (
            <p className="mt-2 text-xs text-red-500 dark:text-red-300">{notificationsError}</p>
          )}
        </div>

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
              placeholder="Share an update, decision, or question for the team..."
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
              Post Comment
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
};

export default DiscussionView;

