import { create } from "zustand"
import { toast } from "sonner"
import type { HttpEventConnector } from "@/services/eventConnector"

const INTERVIEW_DESTINATION = "mod:openagents.mods.workspace.interview"

export interface JobSummary {
  job_id: string
  title: string
  company: string
  location?: string
  description?: string
  tags?: string[]
  created_at?: number
  status?: string
  metadata?: Record<string, unknown>
}

export interface JobDetail extends JobSummary {
  requirements?: string[]
  responsibilities?: string[]
  salary_range?: string
  experience_level?: string
  employment_type?: string
  remote?: boolean
  additional_information?: string
  image_url?: string
  contact_info?: string
  posted_date?: number
  posted_agent_id?: string
  application_deadline?: number
  detailed_description?: string
  brief_description?: string
}

export interface NotificationItem {
  notification_id: string
  message: string
  created_at: number
  status: string
  type: string
  recipient_id?: string
  read: boolean
  metadata?: Record<string, unknown>
}

export interface InterviewRecord {
  interview_id: string
  job_id?: string
  status: string
  interview_url?: string | null
  interview_type?: string | null
  duration_minutes?: number | null
  results?: Record<string, unknown>
  created_at?: number
  updated_at?: number
  notes?: string
}

export interface AssessmentStatus {
  general_assessment_completed: boolean
  last_updated?: number
  [key: string]: unknown
}

interface InterviewPortalState {
  connection: HttpEventConnector | null

  jobs: JobSummary[]
  jobsLoading: boolean
  jobsError: string | null
  jobsFetched: boolean

  jobDetails: Record<string, JobDetail>
  jobDetailLoading: boolean
  jobDetailError: string | null
  selectedJobId: string | null

  assessmentStatus: AssessmentStatus | null
  assessmentLoading: boolean
  assessmentError: string | null
  assessmentFetched: boolean
  assessmentSupported: boolean

  notifications: NotificationItem[]
  notificationsLoading: boolean
  notificationsError: string | null
  notificationsFetched: boolean

  interviews: InterviewRecord[]
  interviewsLoading: boolean
  interviewsError: string | null
  interviewsFetched: boolean

  setConnection: (connection: HttpEventConnector | null) => void

  loadJobs: (force?: boolean) => Promise<void>
  loadJobDetail: (jobId: string, force?: boolean) => Promise<void>
  selectJob: (jobId: string | null) => void

  fetchAssessmentStatus: (force?: boolean) => Promise<void>
  startGeneralAssessment: () => Promise<boolean>

  loadNotifications: (force?: boolean) => Promise<void>
  addNotification: (
    message: string,
    options?: { recipientId?: string; type?: string }
  ) => Promise<boolean>
  markNotificationRead: (notificationId: string) => void

  loadInterviews: (force?: boolean) => Promise<void>
  scheduleInterview: (payload: {
    job_id: string
    interview_url: string
    interview_type: string
    duration_minutes?: number
    notes?: string
  }) => Promise<boolean>
  cancelInterview: (interviewId: string) => Promise<boolean>
}

const ensureArray = (value: unknown): any[] => {
  if (Array.isArray(value)) {
    return value
  }
  return []
}

const normalizeJob = (job: any): JobDetail => {
  const jobId =
    job?.job_id ||
    job?.id ||
    job?.uuid ||
    job?.slug ||
    `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const postedDate =
    typeof job?.posted_date === "number"
      ? job.posted_date
      : typeof job?.posted_at === "number"
      ? job.posted_at
      : undefined

  const statusValue =
    job?.status || job?.state || job?.job_status || job?.hiring_status || "open"

  const description =
    job?.description ||
    job?.detailed_description ||
    job?.brief_description ||
    job?.summary ||
    job?.content ||
    job?.details ||
    ""

  return {
    job_id: jobId,
    title: job?.title || job?.position || "Untitled Position",
    company: job?.company || job?.company_name || "Unknown Company",
    location:
      job?.location ||
      job?.city ||
      job?.region ||
      job?.work_location ||
      "Remote",
    description,
    tags: [
      ...ensureArray(job?.tags).map((tag) =>
        typeof tag === "string" ? tag : tag?.name || ""
      ),
      ...ensureArray(job?.skills).map((tag) =>
        typeof tag === "string" ? tag : tag?.name || ""
      ),
    ].filter(Boolean),
    created_at: job?.created_at || job?.timestamp || postedDate,
    status: statusValue,
    metadata: {
      ...(job?.metadata || {}),
      ...(job?.posted_agent_id ? { posted_agent_id: job.posted_agent_id } : {}),
    },
    requirements: ensureArray(job?.requirements).map((req) =>
      typeof req === "string" ? req : req?.text || ""
    ),
    responsibilities: ensureArray(job?.responsibilities).map((item) =>
      typeof item === "string" ? item : item?.text || ""
    ),
    salary_range:
      job?.salary_range ||
      job?.salary ||
      (job?.salary_min && job?.salary_max
        ? `${job.salary_min} - ${job.salary_max}`
        : undefined),
    experience_level: job?.experience_level || job?.level,
    employment_type: job?.employment_type || job?.type,
    remote:
      typeof job?.remote === "boolean"
        ? job.remote
        : job?.work_mode === "remote",
    additional_information:
      job?.additional_information || job?.notes || job?.additional_info,
    image_url: job?.image_url,
    contact_info: job?.contact_info,
    posted_date: postedDate,
    posted_agent_id: job?.posted_agent_id,
    application_deadline:
      typeof job?.application_deadline === "number"
        ? job.application_deadline
        : undefined,
    detailed_description: job?.detailed_description,
    brief_description: job?.brief_description,
  }
}

export const useInterviewPortalStore = create<InterviewPortalState>(
  (set, get) => ({
    connection: null,

    jobs: [],
    jobsLoading: false,
    jobsError: null,
    jobsFetched: false,

    jobDetails: {},
    jobDetailLoading: false,
    jobDetailError: null,
    selectedJobId: null,

    assessmentStatus: null,
    assessmentLoading: false,
    assessmentError: null,
    assessmentFetched: false,
    assessmentSupported: false,

    notifications: [],
    notificationsLoading: false,
    notificationsError: null,
    notificationsFetched: false,

    interviews: [],
    interviewsLoading: false,
    interviewsError: null,
    interviewsFetched: false,

    setConnection: (connection) => {
      set({ connection })
    },

    loadJobs: async (force = false) => {
      const { connection, jobsFetched } = get()
      console.log("connection", connection)
      if (!connection) {
        console.warn("InterviewPortal: No connection available for loadJobs")
        set({
          jobsError: "Connection not established",
          jobsLoading: false,
        })
        return
      }

      if (jobsFetched && !force) {
        return
      }

      set({ jobsLoading: true, jobsError: null })
      try {
        const response = await connection.sendEvent({
          event_name: "interview.jobs.list",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            limit: 100,
            offset: 0,
          },
        })

        if (response.success) {
          const rawJobs =
            response.data?.jobs ||
            response.data?.items ||
            response.data?.results ||
            []
          const normalized = ensureArray(rawJobs).map(normalizeJob)

          set({
            jobs: normalized,
            jobsLoading: false,
            jobsFetched: true,
          })
        } else {
          const message = response.message || "Failed to load job descriptions"
          set({ jobsError: message, jobsLoading: false })
          toast.error("加载职位列表失败", { description: message })
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadJobs error", error)
        const message = error?.message || "Failed to load job descriptions"
        set({ jobsError: message, jobsLoading: false })
        toast.error("加载职位列表失败", { description: message })
      }
    },

    loadJobDetail: async (jobId: string, force = false) => {
      const { connection, jobDetails } = get()
      if (!connection) {
        console.warn(
          "InterviewPortal: No connection available for loadJobDetail"
        )
        set({
          jobDetailError: "Connection not established",
          jobDetailLoading: false,
        })
        return
      }

      if (!force && jobDetails[jobId]) {
        set({ selectedJobId: jobId })
        return
      }

      set({
        jobDetailLoading: true,
        jobDetailError: null,
        selectedJobId: jobId,
      })

      try {
        const response = await connection.sendEvent({
          event_name: "interview.jobs.get",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            job_id: jobId,
          },
        })

        if (response.success) {
          const rawJob =
            response.data?.job || response.data?.detail || response.data || {}
          const normalized = normalizeJob({ ...rawJob, job_id: jobId })

          set((state) => ({
            jobDetails: {
              ...state.jobDetails,
              [normalized.job_id]: normalized,
            },
            jobs: state.jobs.some((job) => job.job_id === normalized.job_id)
              ? state.jobs.map((job) =>
                  job.job_id === normalized.job_id ? normalized : job
                )
              : [...state.jobs, normalized],
            jobDetailLoading: false,
          }))
        } else {
          const message = response.message || "Failed to load job description"
          set({ jobDetailError: message, jobDetailLoading: false })
          toast.error("load job detail failed", { description: message })
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadJobDetail error", error)
        const message = error?.message || "Failed to load job description"
        set({ jobDetailError: message, jobDetailLoading: false })
        toast.error("load job detail failed", { description: message })
      }
    },

    selectJob: (jobId) => {
      set({ selectedJobId: jobId })
    },

    fetchAssessmentStatus: async (force = false) => {
      const { assessmentFetched, assessmentSupported } = get()

      if (assessmentFetched && !force) {
        return
      }

      if (!assessmentSupported) {
        console.info(
          "InterviewPortal: General assessment API is not supported by the current backend; skipping fetch."
        )
        set({
          assessmentStatus: null,
          assessmentLoading: false,
          assessmentError: null,
          assessmentFetched: true,
        })
        return
      }
      console.warn(
        "InterviewPortal: Assessment support is enabled but no handler is implemented."
      )
      set({
        assessmentLoading: false,
        assessmentFetched: true,
      })
    },

    startGeneralAssessment: async () => {
      toast.info(
        "no general assessment API is supported by the current backend"
      )
      return false
    },

    loadNotifications: async (force = false) => {
      const { connection, notificationsFetched } = get()
      if (!connection) {
        console.warn(
          "InterviewPortal: No connection available for loadNotifications"
        )
        set({
          notificationsError: "Connection not established",
          notificationsLoading: false,
        })
        return
      }

      if (notificationsFetched && !force) {
        return
      }

      set({ notificationsLoading: true, notificationsError: null })

      try {
        const response = await connection.sendEvent({
          event_name: "interview.notification.list",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            limit: 100,
            offset: 0,
          },
        })

        if (response.success) {
          const rawNotifications =
            response.data?.notifications ||
            response.data?.items ||
            response.data?.results ||
            []

          const normalized = ensureArray(rawNotifications).map((item: any) => {
            const status =
              typeof item?.status === "string" ? item.status : "unread"
            const type =
              typeof item?.type === "string"
                ? item.type
                : typeof item?.notification_type === "string"
                ? item.notification_type
                : "info"
            const createdAtRaw =
              item?.created_at ?? item?.timestamp ?? item?.time
            const createdAt =
              typeof createdAtRaw === "number"
                ? createdAtRaw
                : Math.floor(Date.now() / 1000)

            return {
              notification_id:
                item?.notification_id ||
                item?.id ||
                `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              message:
                item?.message ||
                item?.content ||
                item?.text ||
                item?.title ||
                "",
              created_at: createdAt,
              status,
              type,
              recipient_id:
                typeof item?.recipient_id === "string"
                  ? item.recipient_id
                  : undefined,
              read: status !== "unread",
              metadata: item?.metadata || {},
            } as NotificationItem
          })

          set({
            notifications: normalized,
            notificationsLoading: false,
            notificationsFetched: true,
          })
        } else {
          const message = response.message || "Failed to load notifications"
          set({
            notificationsError: message,
            notificationsLoading: false,
          })
          toast.error("load notifications failed", { description: message })
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadNotifications error", error)
        const message = error?.message || "Failed to load notifications"
        set({
          notificationsError: message,
          notificationsLoading: false,
        })
        toast.error("加载通知失败", { description: message })
      }
    },

    addNotification: async (message: string, options) => {
      const { connection } = get()
      if (!connection) {
        toast.error("no connection available for addNotification")
        return false
      }

      const trimmedMessage = message.trim()
      if (!trimmedMessage) {
        toast.error("notification content cannot be empty")
        return false
      }

      const recipientId =
        options?.recipientId ||
        (typeof connection.getAgentId === "function"
          ? connection.getAgentId()
          : undefined)

      if (!recipientId) {
        toast.error("missing notification recipient information")
        return false
      }

      const notificationType = options?.type || "message"

      try {
        const response = await connection.sendEvent({
          event_name: "interview.notification.add",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            recipient_id: recipientId,
            type: notificationType,
            message: trimmedMessage,
          },
        })

        if (response.success) {
          const createdNotification = response.data?.notification
          if (createdNotification) {
            const status =
              typeof createdNotification.status === "string"
                ? createdNotification.status
                : "unread"
            const createdAt =
              typeof createdNotification.created_at === "number"
                ? createdNotification.created_at
                : Math.floor(Date.now() / 1000)

            const normalized: NotificationItem = {
              notification_id:
                createdNotification.notification_id ||
                createdNotification.id ||
                `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              message:
                createdNotification.message ||
                createdNotification.content ||
                trimmedMessage,
              created_at: createdAt,
              status,
              type:
                createdNotification.type ||
                createdNotification.notification_type ||
                notificationType,
              recipient_id: createdNotification.recipient_id || recipientId,
              read: status !== "unread",
              metadata: createdNotification.metadata || {},
            }

            set((state) => ({
              notifications: [normalized, ...state.notifications],
            }))
          } else {
            const normalized: NotificationItem = {
              notification_id:
                response.data?.notification_id ||
                response.data?.id ||
                `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              message: trimmedMessage,
              created_at:
                typeof response.data?.created_at === "number"
                  ? response.data.created_at
                  : Math.floor(Date.now() / 1000),
              status: "unread",
              type: notificationType,
              recipient_id: recipientId,
              read: false,
              metadata: {},
            }

            set((state) => ({
              notifications: [normalized, ...state.notifications],
            }))
          }

          toast.success("notification sent")
          return true
        }

        const errorMessage = response.message || "Failed to send notification"
        toast.error("send notification failed", { description: errorMessage })
        return false
      } catch (error: any) {
        console.error("InterviewPortal: addNotification error", error)
        toast.error("send notification failed", {
          description: error?.message || "Unexpected error",
        })
        return false
      }
    },

    markNotificationRead: (notificationId: string) => {
      set((state) => ({
        notifications: state.notifications.map((notification) =>
          notification.notification_id === notificationId
            ? { ...notification, read: true, status: "read" }
            : notification
        ),
      }))
    },

    loadInterviews: async (force = false) => {
      const { connection, interviewsFetched } = get()
      if (!connection) {
        console.warn(
          "InterviewPortal: No connection available for loadInterviews"
        )
        set({
          interviewsError: "Connection not established",
          interviewsLoading: false,
        })
        return
      }

      if (interviewsFetched && !force) {
        return
      }

      set({ interviewsLoading: true, interviewsError: null })

      try {
        const response = await connection.sendEvent({
          event_name: "interview.interviews.list",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            limit: 100,
            offset: 0,
          },
        })

        if (response.success) {
          const rawInterviews =
            response.data?.interviews ||
            response.data?.items ||
            response.data?.results ||
            []

          const normalized = ensureArray(rawInterviews).map(
            (interview: any) => {
              const createdAt =
                typeof interview?.created_at === "number"
                  ? interview.created_at
                  : undefined
              const updatedAt =
                typeof interview?.updated_at === "number"
                  ? interview.updated_at
                  : createdAt
              const durationMinutes =
                typeof interview?.duration_minutes === "number"
                  ? interview.duration_minutes
                  : typeof interview?.duration === "number"
                  ? interview.duration
                  : undefined
              const results =
                interview?.results && typeof interview.results === "object"
                  ? interview.results
                  : {}

              return {
                interview_id:
                  interview?.interview_id ||
                  interview?.id ||
                  `interview_${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`,
                job_id: interview?.job_id,
                status: interview?.status || "scheduled",
                interview_url:
                  interview?.interview_url ?? interview?.url ?? interview?.link,
                interview_type:
                  interview?.interview_type ?? interview?.type ?? null,
                duration_minutes:
                  typeof durationMinutes === "number" ? durationMinutes : null,
                results,
                created_at: createdAt,
                updated_at: updatedAt,
                notes:
                  typeof interview?.notes === "string"
                    ? interview.notes
                    : interview?.description,
              } as InterviewRecord
            }
          )

          set({
            interviews: normalized,
            interviewsLoading: false,
            interviewsFetched: true,
          })
        } else {
          const message = response.message || "Failed to load interviews"
          set({ interviewsError: message, interviewsLoading: false })
          toast.error("load interviews failed", { description: message })
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadInterviews error", error)
        const message = error?.message || "Failed to load interviews"
        set({ interviewsError: message, interviewsLoading: false })
        toast.error("load interviews failed", { description: message })
      }
    },

    scheduleInterview: async (payload) => {
      const { connection } = get()
      if (!connection) {
        toast.error("no connection available for scheduleInterview")
        return false
      }

      if (
        !payload.job_id ||
        !payload.interview_url ||
        !payload.interview_type
      ) {
        toast.error("missing required interview information")
        return false
      }

      const normalizedPayload = {
        job_id: payload.job_id,
        interview_url: payload.interview_url,
        interview_type: payload.interview_type,
        duration_minutes:
          typeof payload.duration_minutes === "number"
            ? payload.duration_minutes
            : undefined,
        notes: payload.notes,
      }

      try {
        const response = await connection.sendEvent({
          event_name: "interview.interviews.add",
          destination_id: INTERVIEW_DESTINATION,
          payload: normalizedPayload,
        })

        if (response.success) {
          const interview = response.data?.interview
          const responseData = interview || response.data || {}
          const createdAt =
            typeof responseData.created_at === "number"
              ? responseData.created_at
              : Math.floor(Date.now() / 1000)
          const updatedAt =
            typeof responseData.updated_at === "number"
              ? responseData.updated_at
              : createdAt

          const normalized: InterviewRecord = {
            interview_id:
              responseData.interview_id ||
              responseData.id ||
              `interview_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 8)}`,
            job_id: responseData.job_id || payload.job_id,
            status: responseData.status || "scheduled",
            interview_url:
              responseData.interview_url ?? payload.interview_url ?? null,
            interview_type:
              responseData.interview_type ?? payload.interview_type ?? null,
            duration_minutes:
              typeof responseData.duration_minutes === "number"
                ? responseData.duration_minutes
                : payload.duration_minutes ?? null,
            results:
              responseData.results && typeof responseData.results === "object"
                ? responseData.results
                : {},
            created_at: createdAt,
            updated_at: updatedAt,
            notes: responseData.notes || payload.notes,
          }

          set((state) => ({
            interviews: [normalized, ...state.interviews],
          }))

          toast.success("interview scheduled")
          return true
        }

        const message = response.message || "Failed to schedule interview"
        toast.error("schedule interview failed", { description: message })
        return false
      } catch (error: any) {
        console.error("InterviewPortal: scheduleInterview error", error)
        toast.error("schedule interview failed", {
          description: error?.message || "Unexpected error",
        })
        return false
      }
    },

    cancelInterview: async (interviewId: string) => {
      const { connection } = get()
      if (!connection) {
        toast.error("no connection available for cancelInterview")
        return false
      }

      try {
        const response = await connection.sendEvent({
          event_name: "interview.interviews.delete",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            interview_id: interviewId,
          },
        })

        if (response.success) {
          set((state) => ({
            interviews: state.interviews.filter(
              (interview) => interview.interview_id !== interviewId
            ),
          }))
          toast.success("interview cancelled")
          return true
        }

        const message = response.message || "Failed to cancel interview"
        toast.error("cancel interview failed", { description: message })
        return false
      } catch (error: any) {
        console.error("InterviewPortal: cancelInterview error", error)
        toast.error("cancel interview failed", {
          description: error?.message || "Unexpected error",
        })
        return false
      }
    },
  })
)
