import React, { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useInterviewPortalStore } from "@/stores/interviewPortalStore"

const JobListSkeleton: React.FC = () => {
  return (
    <div className="space-y-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm animate-pulse"
        >
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-6" />
          <div className="space-y-2">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/6" />
          </div>
        </div>
      ))}
    </div>
  )
}

const JobListView: React.FC = () => {
  const navigate = useNavigate()
  const {
    connection,
    jobs,
    jobsLoading,
    jobsError,
    loadJobs,
    assessmentStatus,
    assessmentLoading,
    assessmentFetched,
    assessmentSupported,
    fetchAssessmentStatus,
    startGeneralAssessment,
  } = useInterviewPortalStore()

  useEffect(() => {
    if (!connection) {
      return
    }
    loadJobs(true)
  }, [connection, loadJobs])

  useEffect(() => {
    if (
      !connection ||
      !assessmentSupported ||
      assessmentFetched ||
      assessmentLoading
    ) {
      return
    }
    fetchAssessmentStatus()
  }, [
    connection,
    assessmentSupported,
    assessmentFetched,
    assessmentLoading,
    fetchAssessmentStatus,
  ])

  const showAssessmentButton =
    assessmentSupported && !assessmentStatus?.general_assessment_completed

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <header className="px-8 py-6 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-600 uppercase tracking-wide">
              Interview Portal
            </p>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Job Description
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm md:text-base">
              Review current openings. Complete the general assessment before
              you apply.
            </p>
          </div>
          {showAssessmentButton && (
            <button
              onClick={startGeneralAssessment}
              className="inline-flex items-center justify-center px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md transition-transform duration-200 hover:-translate-y-0.5"
            >
              Start General Assessment
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6 bg-gray-50/80 dark:bg-gray-900/50">
        {jobsLoading && jobs.length === 0 ? (
          <JobListSkeleton />
        ) : jobsError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800/40 dark:bg-red-900/30 p-6">
            <h2 className="text-red-600 dark:text-red-300 font-semibold text-lg mb-2">
              Failed to Load Jobs
            </h2>
            <p className="text-red-500 dark:text-red-200 text-sm mb-4">
              {jobsError}
            </p>
            <button
              onClick={() => loadJobs(true)}
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-white dark:bg-red-900/60 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/80 transition"
            >
              Retry
            </button>
          </div>
        ) : jobs.length === 0 ? (
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
                d="M9 5l7 7-7 7"
              />
            </svg>
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
              No Roles Available
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No positions are currently published. Please check back later or
              contact an administrator.
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl mx-auto">
            {jobs.map((job) => (
              <button
                key={job.job_id}
                onClick={() => navigate(`/interview/jobs/${job.job_id}`)}
                className="group w-full text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow hover:shadow-lg transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600">
                        {job.title}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {job.company} · {job.location || "Remote friendly"}
                      </p>
                      {job.description && (
                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-3 leading-relaxed">
                          {job.description}
                        </p>
                      )}
                      {job.tags && job.tags.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {job.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200 shrink-0">
                      {job.status === "open" ? "Open" : job.status || "Pending"}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default JobListView
