import React, { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  useInterviewPortalStore,
  type JobDetail,
} from "@/stores/interviewPortalStore"

const MyInterviewsView: React.FC = () => {
  const navigate = useNavigate()
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())

  const {
    connection,
    interviews,
    interviewsLoading,
    interviewsError,
    loadInterviews,
    jobs,
    jobDetails,
    loadJobDetail,
  } = useInterviewPortalStore()

  const jobMap = useMemo(() => {
    const map = new Map<string, (typeof jobs)[number]>()
    jobs.forEach((job) => {
      map.set(job.job_id, job)
    })
    return map
  }, [jobs])

  useEffect(() => {
    if (!connection) {
      return
    }
    loadInterviews(true)
  }, [connection, loadInterviews])

  // Load job details for interviews that have job_id
  useEffect(() => {
    interviews.forEach((interview) => {
      if (interview.job_id && !jobDetails[interview.job_id]) {
        loadJobDetail(interview.job_id)
      }
    })
  }, [interviews, jobDetails, loadJobDetail])

  const orderedInterviews = useMemo(() => {
    return [...interviews].sort((a, b) => {
      const timeA = a.updated_at ?? a.created_at ?? 0
      const timeB = b.updated_at ?? b.created_at ?? 0
      return timeB - timeA
    })
  }, [interviews])

  const getJobInfo = (interview: (typeof interviews)[number]) => {
    if (!interview.job_id) {
      return {
        title: "Unassigned Role",
        company: undefined,
        imageUrl: undefined,
      }
    }

    const jobDetail = jobDetails[interview.job_id] as JobDetail | undefined
    const jobSummary = jobMap.get(interview.job_id)
    const imageUrl = jobDetail?.image_url
    const hasImageError = imageErrors.has(interview.job_id)

    return {
      title: jobDetail?.title || jobSummary?.title || interview.job_id,
      company: jobDetail?.company || jobSummary?.company,
      imageUrl: imageUrl && !hasImageError ? imageUrl : undefined,
    }
  }

  const handleImageError = (jobId: string) => {
    setImageErrors((prev) => new Set(prev).add(jobId))
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200"
      case "cancelled":
        return "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-200"
      case "scheduled":
        return "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-200"
      default:
        return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
    }
  }

  const handleStartInterview = (interviewId: string) => {
    // Navigate to discussion view to start the interview
    navigate("/interview/discussion")
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80">
        <div>
          <span className="text-sm font-semibold text-green-600 uppercase tracking-wide">
            My Interviews
          </span>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-2">
            My Interviews
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400 text-sm md:text-base">
            Review and manage your interview sessions
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6 bg-gray-50/80 dark:bg-gray-900/50">
        {interviewsLoading && interviews.length === 0 ? (
          <div className="space-y-4 max-w-4xl mx-auto">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm animate-pulse"
              >
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                  </div>
                  <div className="w-24 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        ) : interviewsError && interviews.length === 0 ? (
          <div className="max-w-4xl mx-auto rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 p-6">
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
          <div className="h-full flex flex-col items-center justify-center text-center p-12 max-w-4xl mx-auto">
            <svg
              className="w-16 h-16 text-gray-400 dark:text-gray-500 mb-4"
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
            <p className="text-sm text-gray-500 dark:text-gray-400">
              You don't have any scheduled interviews at the moment.
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl mx-auto">
            {orderedInterviews.map((interview) => {
              const jobInfo = getJobInfo(interview)
              const status = interview.status || "scheduled"

              return (
                <div
                  key={interview.interview_id}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:shadow-md transition duration-200"
                >
                  <div className="p-6">
                    <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                      {/* Job Image */}
                      <div className="flex-shrink-0">
                        {jobInfo.imageUrl ? (
                          <img
                            src={jobInfo.imageUrl}
                            alt={jobInfo.title}
                            className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-gray-700"
                            onError={() =>
                              handleImageError(interview.job_id || "")
                            }
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                            {jobInfo.title.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* Job Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {jobInfo.title}
                        </h3>
                        {jobInfo.company && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {jobInfo.company}
                          </p>
                        )}
                        <div className="mt-2">
                          <span
                            className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(
                              status
                            )}`}
                          >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                          </span>
                        </div>
                      </div>

                      {/* Start Interview Button */}
                      <div className="flex-shrink-0 w-full sm:w-auto mt-4 sm:mt-0">
                        <button
                          disabled={
                            status === "completed" || status === "cancelled"
                          }
                          className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium text-sm transition shadow-sm hover:shadow"
                        >
                          Start Interview
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default MyInterviewsView
