import React, { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useInterviewPortalStore } from "@/stores/interviewPortalStore";
import type { JobDetail } from "@/stores/interviewPortalStore";

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
      {title}
    </h2>
    <div className="mt-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-3">
      {children}
    </div>
  </section>
);

const InfoItem: React.FC<{ label: string; value?: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="flex flex-col">
    <span className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
      {label}
    </span>
    <span className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
      {value || "Not provided"}
    </span>
  </div>
);

const JobDetailView: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const {
    jobs,
    jobDetails,
    jobDetailLoading,
    jobDetailError,
    loadJobDetail,
    selectJob,
  } = useInterviewPortalStore();

  const jobDetail = jobId ? jobDetails[jobId] : undefined;
  const jobSummary = jobs.find((item) => item.job_id === jobId);
  const summaryDetail = jobSummary as Partial<JobDetail> | undefined;
  const job = jobDetail || jobSummary || null;

  const employmentType =
    jobDetail?.employment_type ?? summaryDetail?.employment_type;
  const experienceLevel =
    jobDetail?.experience_level ?? summaryDetail?.experience_level;
  const salaryRange = jobDetail?.salary_range ?? summaryDetail?.salary_range;
  const remoteFlag = jobDetail?.remote ?? summaryDetail?.remote ?? undefined;
  const requirements =
    jobDetail?.requirements ?? summaryDetail?.requirements ?? [];
  const responsibilities =
    jobDetail?.responsibilities ?? summaryDetail?.responsibilities ?? [];
  const additionalInformation =
    jobDetail?.additional_information ?? summaryDetail?.additional_information;

  useEffect(() => {
    if (!jobId) {
      return;
    }
    selectJob(jobId);
    loadJobDetail(jobId);
  }, [jobId, selectJob, loadJobDetail]);

  if (!jobId) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            No job information found.
          </p>
          <button
            onClick={() => navigate("/interview")}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Back to Job List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <header className="px-8 py-6 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-blue-600 font-semibold uppercase tracking-wide mb-2">
              Job Detail
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 break-words">
              {job?.title || "Loading..."}
            </h1>
            {job?.company && (
              <p className="mt-2 text-gray-600 dark:text-gray-300 text-sm md:text-base">
                {job.company} · {job.location || "Remote friendly"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/interview")}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              Back to List
            </button>
            <button className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium shadow">
              Apply Now
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6 bg-gray-50/80 dark:bg-gray-900/50 space-y-6">
        {jobDetailLoading && !job ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 animate-pulse space-y-4">
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          </div>
        ) : jobDetailError && !job ? (
          <div className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 p-6">
            <h2 className="text-lg font-semibold text-red-600 dark:text-red-300 mb-2">
              Failed to Load Job Details
            </h2>
            <p className="text-sm text-red-500 dark:text-red-200">
              {jobDetailError}
            </p>
          </div>
        ) : job ? (
          <>
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <InfoItem label="Company" value={job.company} />
              <InfoItem label="Location" value={job.location || "Remote friendly"} />
              <InfoItem label="Employment Type" value={employmentType} />
              <InfoItem label="Experience Level" value={experienceLevel} />
              <InfoItem label="Salary Range" value={salaryRange} />
              <InfoItem
                label="Work Style"
                value={
                  remoteFlag === undefined
                    ? "Not specified"
                    : remoteFlag
                    ? "Remote available"
                    : "On-site required"
                }
              />
            </section>

            {job?.description && (
              <Section title="Overview">
                <p>{job.description}</p>
              </Section>
            )}

            {requirements && requirements.length > 0 && (
              <Section title="Requirements">
                <ul className="list-disc list-inside space-y-2">
                  {requirements.map((requirement, index) => (
                    <li key={`${requirement}-${index}`}>{requirement}</li>
                  ))}
                </ul>
              </Section>
            )}

            {responsibilities && responsibilities.length > 0 && (
              <Section title="Responsibilities">
                <ul className="list-disc list-inside space-y-2">
                  {responsibilities.map((responsibility, index) => (
                    <li key={`${responsibility}-${index}`}>
                      {responsibility}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {additionalInformation && (
              <Section title="Additional Information">
                <p>{additionalInformation}</p>
              </Section>
            )}

            {job.tags && job.tags.length > 0 && (
              <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-3">
                  Skill Tags
                </h2>
                <div className="flex flex-wrap gap-2">
                  {job.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center text-gray-500 dark:text-gray-400">
            No additional details found for this role.
          </div>
        )}
      </div>
    </div>
  );
};

export default JobDetailView;

