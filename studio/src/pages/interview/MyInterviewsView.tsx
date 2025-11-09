import React, { useEffect, useMemo, useState } from "react";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";

interface ScheduleFormState {
  job_title: string;
  scheduled_time: string;
  interviewer: string;
  location: string;
  notes: string;
}

const defaultFormState: ScheduleFormState = {
  job_title: "",
  scheduled_time: "",
  interviewer: "",
  location: "",
  notes: "",
};

const MyInterviewsView: React.FC = () => {
  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState<ScheduleFormState>(
    defaultFormState
  );

  const {
    interviews,
    interviewsLoading,
    interviewsError,
    loadInterviews,
    scheduleInterview,
    cancelInterview,
    jobs,
  } = useInterviewPortalStore();

  useEffect(() => {
    loadInterviews();
  }, [loadInterviews]);

  const orderedInterviews = useMemo(() => {
    return [...interviews].sort((a, b) => {
      const timeA = a.scheduled_time
        ? new Date(a.scheduled_time).getTime()
        : 0;
      const timeB = b.scheduled_time
        ? new Date(b.scheduled_time).getTime()
        : 0;
      return timeB - timeA;
    });
  }, [interviews]);

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!formState.job_title || !formState.scheduled_time) {
      return;
    }

    const selectedJob = jobs.find(
      (job) => job.title === formState.job_title || job.job_id === formState.job_title
    );

    const success = await scheduleInterview({
      job_id: selectedJob?.job_id,
      job_title: selectedJob ? selectedJob.title : formState.job_title,
      scheduled_time: formState.scheduled_time,
      interviewer: formState.interviewer || undefined,
      location: formState.location || undefined,
      notes: formState.notes || undefined,
    });

    if (success) {
      setFormState(defaultFormState);
      setShowForm(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <span className="text-sm font-semibold text-green-600 uppercase tracking-wide">
              My Interviews
            </span>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Interview Schedule
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm md:text-base">
              Review your interview plan, create new sessions, or cancel the ones you no longer need.
            </p>
          </div>
          <button
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex items-center justify-center px-5 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium shadow transition"
          >
            {showForm ? "Close Form" : "Schedule Interview"}
          </button>
        </div>
      </header>

      {showForm && (
        <div className="border-b border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 px-8 py-6">
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Role Title
              </label>
              <input
                name="job_title"
                list="job-options"
                value={formState.job_title}
                onChange={handleInputChange}
                placeholder="Select or enter the role"
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                required
              />
              <datalist id="job-options">
                {jobs.map((job) => (
                  <option key={job.job_id} value={job.title} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Interview Time
              </label>
              <input
                type="datetime-local"
                name="scheduled_time"
                value={formState.scheduled_time}
                onChange={handleInputChange}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                required
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Interviewer
              </label>
              <input
                name="interviewer"
                value={formState.interviewer}
                onChange={handleInputChange}
                placeholder="Optional"
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Interview Location
              </label>
              <input
                name="location"
                value={formState.location}
                onChange={handleInputChange}
                placeholder="Meeting link or onsite location"
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
              />
            </div>

            <div className="md:col-span-2 flex flex-col">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Notes
              </label>
              <textarea
                name="notes"
                value={formState.notes}
                onChange={handleInputChange}
                placeholder="Add relevant context for the interview"
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition min-h-[96px]"
              />
            </div>

            <div className="md:col-span-2 flex justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => {
                  setFormState(defaultFormState);
                  setShowForm(false);
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition"
              >
                Save Interview
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-8 py-6 bg-gray-50/80 dark:bg-gray-900/50">
        {interviewsLoading && interviews.length === 0 ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm animate-pulse space-y-3"
              >
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : interviewsError && interviews.length === 0 ? (
          <div className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 p-6">
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-300 mb-2">
              Failed to Load Interviews
            </h2>
            <p className="text-sm text-red-500 dark:text-red-200 mb-4">
              {interviewsError}
            </p>
            <button
              onClick={() => loadInterviews(true)}
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-white dark:bg-red-900/60 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/80 transition"
            >
              Retry
            </button>
          </div>
        ) : orderedInterviews.length === 0 ? (
          <div className="h-full rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col items-center justify-center text-center p-12">
            <svg
              className="w-12 h-12 text-gray-400 dark:text-gray-500 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10m-9 4h6m-9 6h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
              No Interviews Yet
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Click "Schedule Interview" to add your first session.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {orderedInterviews.map((interview) => (
              <div
                key={interview.interview_id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow hover:shadow-lg transition duration-200"
              >
                <div className="px-6 py-5 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                        {interview.job_title || "Untitled Role"}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Scheduled:&nbsp;
                        {interview.scheduled_time
                          ? new Date(interview.scheduled_time).toLocaleString()
                          : "Not set"}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold ${
                        interview.status === "completed"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200"
                          : interview.status === "cancelled"
                          ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-200"
                          : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200"
                      }`}
                    >
                      {interview.status || "Scheduled"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600 dark:text-gray-300">
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-4 h-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                      Interviewer:&nbsp;{interview.interviewer || "Not set"}
                    </div>
                    <div className="flex items-center gap-2">
                      <svg
                        className="w-4 h-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M17.657 16.657L13.414 12l4.243-4.243M6.343 7.343L10.586 12l-4.243 4.243"
                        />
                      </svg>
                      Location：{interview.location || "TBD"}
                    </div>
                  </div>

                  {interview.notes && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 leading-relaxed">
                      {interview.notes}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => cancelInterview(interview.interview_id)}
                      className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    >
                      Cancel Interview
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyInterviewsView;

