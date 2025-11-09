import { create } from "zustand";
import { toast } from "sonner";
import type { HttpEventConnector } from "@/services/eventConnector";

const INTERVIEW_DESTINATION = "mod:openagents.mods.workspace.interview";

export interface JobSummary {
  job_id: string;
  title: string;
  company: string;
  location?: string;
  description?: string;
  tags?: string[];
  created_at?: number;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface JobDetail extends JobSummary {
  requirements?: string[];
  responsibilities?: string[];
  salary_range?: string;
  experience_level?: string;
  employment_type?: string;
  remote?: boolean;
  additional_information?: string;
}

export interface NotificationItem {
  notification_id: string;
  message: string;
  created_at: number;
  read?: boolean;
  level?: "info" | "warning" | "success" | "error";
  metadata?: Record<string, unknown>;
}

export interface InterviewRecord {
  interview_id: string;
  job_id?: string;
  job_title?: string;
  scheduled_time?: string;
  interviewer?: string;
  location?: string;
  status?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface AssessmentStatus {
  general_assessment_completed: boolean;
  last_updated?: number;
  [key: string]: unknown;
}

interface InterviewPortalState {
  connection: HttpEventConnector | null;

  jobs: JobSummary[];
  jobsLoading: boolean;
  jobsError: string | null;
  jobsFetched: boolean;

  jobDetails: Record<string, JobDetail>;
  jobDetailLoading: boolean;
  jobDetailError: string | null;
  selectedJobId: string | null;

  assessmentStatus: AssessmentStatus | null;
  assessmentLoading: boolean;
  assessmentError: string | null;
  assessmentFetched: boolean;

  notifications: NotificationItem[];
  notificationsLoading: boolean;
  notificationsError: string | null;
  notificationsFetched: boolean;

  interviews: InterviewRecord[];
  interviewsLoading: boolean;
  interviewsError: string | null;
  interviewsFetched: boolean;

  setConnection: (connection: HttpEventConnector | null) => void;

  loadJobs: (force?: boolean) => Promise<void>;
  loadJobDetail: (jobId: string, force?: boolean) => Promise<void>;
  selectJob: (jobId: string | null) => void;

  fetchAssessmentStatus: (force?: boolean) => Promise<void>;
  startGeneralAssessment: () => Promise<boolean>;

  loadNotifications: (force?: boolean) => Promise<void>;
  addNotification: (message: string) => Promise<boolean>;
  markNotificationRead: (notificationId: string) => void;

  loadInterviews: (force?: boolean) => Promise<void>;
  scheduleInterview: (payload: {
    job_id?: string;
    job_title?: string;
    scheduled_time?: string;
    interviewer?: string;
    location?: string;
    notes?: string;
  }) => Promise<boolean>;
  cancelInterview: (interviewId: string) => Promise<boolean>;
}

const ensureArray = (value: unknown): any[] => {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
};

const normalizeJob = (job: any): JobDetail => {
  const jobId =
    job?.job_id ||
    job?.id ||
    job?.uuid ||
    job?.slug ||
    `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    job_id: jobId,
    title: job?.title || job?.position || "Untitled Position",
    company: job?.company || job?.company_name || "Unknown Company",
    location: job?.location || job?.city || job?.region || "Remote",
    description:
      job?.description ||
      job?.summary ||
      job?.content ||
      job?.details ||
      "",
    tags:
      ensureArray(job?.tags).map((tag) =>
        typeof tag === "string" ? tag : tag?.name || ""
      ) || [],
    created_at:
      job?.created_at ||
      job?.timestamp ||
      (typeof job?.posted_at === "number" ? job?.posted_at : undefined),
    status: job?.status || job?.state || "open",
    metadata: job?.metadata || {},
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
    additional_information: job?.additional_information || job?.notes,
  };
};

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

    notifications: [],
    notificationsLoading: false,
    notificationsError: null,
    notificationsFetched: false,

    interviews: [],
    interviewsLoading: false,
    interviewsError: null,
    interviewsFetched: false,

    setConnection: (connection) => {
      set({ connection });
    },

    loadJobs: async (force = false) => {
      const { connection, jobsFetched } = get();
      if (!connection) {
        console.warn("InterviewPortal: No connection available for loadJobs");
        set({
          jobsError: "Connection not established",
          jobsLoading: false,
        });
        return;
      }

      if (jobsFetched && !force) {
        return;
      }

      set({ jobsLoading: true, jobsError: null });
      try {
        const response = await connection.sendEvent({
          event_name: "interview.jobs.list",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            limit: 100,
            offset: 0,
          },
        });

        if (response.success) {
          const rawJobs =
            response.data?.jobs ||
            response.data?.items ||
            response.data?.results ||
            [];
          const normalized = ensureArray(rawJobs).map(normalizeJob);
          set({
            jobs: normalized,
            jobsLoading: false,
            jobsFetched: true,
          });
        } else {
          const message =
            response.message || "Failed to load job descriptions";
          set({ jobsError: message, jobsLoading: false });
          toast.error("加载职位列表失败", { description: message });
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadJobs error", error);
        const message = error?.message || "Failed to load job descriptions";
        set({ jobsError: message, jobsLoading: false });
        toast.error("加载职位列表失败", { description: message });
      }
    },

    loadJobDetail: async (jobId: string, force = false) => {
      const { connection, jobDetails } = get();
      if (!connection) {
        console.warn(
          "InterviewPortal: No connection available for loadJobDetail"
        );
        set({
          jobDetailError: "Connection not established",
          jobDetailLoading: false,
        });
        return;
      }

      if (!force && jobDetails[jobId]) {
        set({ selectedJobId: jobId });
        return;
      }

      set({
        jobDetailLoading: true,
        jobDetailError: null,
        selectedJobId: jobId,
      });

      try {
        const response = await connection.sendEvent({
          event_name: "interview.jobs.get",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            job_id: jobId,
          },
        });

        if (response.success) {
          const rawJob =
            response.data?.job ||
            response.data?.detail ||
            response.data ||
            {};
          const normalized = normalizeJob({ ...rawJob, job_id: jobId });

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
          }));
        } else {
          const message =
            response.message || "Failed to load job description";
          set({ jobDetailError: message, jobDetailLoading: false });
          toast.error("加载职位详情失败", { description: message });
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadJobDetail error", error);
        const message = error?.message || "Failed to load job description";
        set({ jobDetailError: message, jobDetailLoading: false });
        toast.error("加载职位详情失败", { description: message });
      }
    },

    selectJob: (jobId) => {
      set({ selectedJobId: jobId });
    },

    fetchAssessmentStatus: async (force = false) => {
      const { connection, assessmentFetched } = get();
      if (!connection) {
        console.warn(
          "InterviewPortal: No connection available for fetchAssessmentStatus"
        );
        set({
          assessmentError: "Connection not established",
          assessmentLoading: false,
        });
        return;
      }

      if (assessmentFetched && !force) {
        return;
      }

      set({ assessmentLoading: true, assessmentError: null });

      try {
        const response = await connection.sendEvent({
          event_name: "interview.status.get",
          destination_id: INTERVIEW_DESTINATION,
          payload: {},
        });

        if (response.success) {
          const status =
            response.data?.status ||
            response.data?.assessment ||
            response.data ||
            {};
          const normalized: AssessmentStatus = {
            general_assessment_completed:
              Boolean(status?.general_assessment_completed) ||
              Boolean(status?.generalAssessmentCompleted) ||
              Boolean(status?.general_assessment_done),
            last_updated:
              status?.last_updated ||
              status?.updated_at ||
              status?.timestamp ||
              Math.floor(Date.now() / 1000),
            ...status,
          };

          set({
            assessmentStatus: normalized,
            assessmentLoading: false,
            assessmentFetched: true,
          });
        } else {
          const message = response.message || "Failed to load assessment status";
          set({
            assessmentError: message,
            assessmentLoading: false,
            assessmentFetched: true,
          });
          toast.error("获取测评状态失败", { description: message });
        }
      } catch (error: any) {
        console.error("InterviewPortal: fetchAssessmentStatus error", error);
        const message = error?.message || "Failed to load assessment status";
        set({
          assessmentError: message,
          assessmentLoading: false,
          assessmentFetched: true,
        });
        toast.error("获取测评状态失败", { description: message });
      }
    },

    startGeneralAssessment: async () => {
      const { connection } = get();
      if (!connection) {
        toast.error("尚未连接到网络，无法启动测评");
        return false;
      }

      try {
        const response = await connection.sendEvent({
          event_name: "interview.status.put",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            action: "start_general_assessment",
          },
        });

        if (response.success) {
          toast.success("已启动通用测评");
          await get().fetchAssessmentStatus(true);
          return true;
        }

        const message = response.message || "Failed to start assessment";
        toast.error("启动测评失败", { description: message });
        return false;
      } catch (error: any) {
        console.error("InterviewPortal: startGeneralAssessment error", error);
        toast.error("启动测评失败", {
          description: error?.message || "Unexpected error",
        });
        return false;
      }
    },

    loadNotifications: async (force = false) => {
      const { connection, notificationsFetched } = get();
      if (!connection) {
        console.warn(
          "InterviewPortal: No connection available for loadNotifications"
        );
        set({
          notificationsError: "Connection not established",
          notificationsLoading: false,
        });
        return;
      }

      if (notificationsFetched && !force) {
        return;
      }

      set({ notificationsLoading: true, notificationsError: null });

      try {
        const response = await connection.sendEvent({
          event_name: "interview.notification.list",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            limit: 100,
            offset: 0,
          },
        });

        if (response.success) {
          const rawNotifications =
            response.data?.notifications ||
            response.data?.items ||
            response.data?.results ||
            [];

          const normalized = ensureArray(rawNotifications).map((item: any) => ({
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
            created_at:
              item?.created_at ||
              item?.timestamp ||
              item?.time ||
              Math.floor(Date.now() / 1000),
            read: Boolean(item?.read),
            level:
              item?.level === "warning" ||
              item?.level === "success" ||
              item?.level === "error"
                ? item.level
                : "info",
            metadata: item?.metadata || {},
          }));

          set({
            notifications: normalized,
            notificationsLoading: false,
            notificationsFetched: true,
          });
        } else {
          const message =
            response.message || "Failed to load notifications";
          set({
            notificationsError: message,
            notificationsLoading: false,
          });
          toast.error("加载通知失败", { description: message });
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadNotifications error", error);
        const message = error?.message || "Failed to load notifications";
        set({
          notificationsError: message,
          notificationsLoading: false,
        });
        toast.error("加载通知失败", { description: message });
      }
    },

    addNotification: async (message: string) => {
      const { connection } = get();
      if (!connection) {
        toast.error("尚未连接到网络，无法发送通知");
        return false;
      }

      try {
        const response = await connection.sendEvent({
          event_name: "interview.notification.add",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            message: message.trim(),
          },
        });

        if (response.success) {
          const createdNotification = response.data?.notification;
          if (createdNotification) {
            const normalized: NotificationItem = {
              notification_id:
                createdNotification.notification_id ||
                createdNotification.id ||
                `notif_${Date.now()}_${Math.random()
                  .toString(36)
                  .slice(2, 8)}`,
              message:
                createdNotification.message ||
                createdNotification.content ||
                message,
              created_at:
                createdNotification.created_at ||
                createdNotification.timestamp ||
                Math.floor(Date.now() / 1000),
              read: Boolean(createdNotification.read),
              level:
                createdNotification.level === "warning" ||
                createdNotification.level === "success" ||
                createdNotification.level === "error"
                  ? createdNotification.level
                  : "info",
              metadata: createdNotification.metadata || {},
            };

            set((state) => ({
              notifications: [normalized, ...state.notifications],
            }));
          } else {
            await get().loadNotifications(true);
          }
          toast.success("通知已发送");
          return true;
        }

        const errorMessage = response.message || "Failed to send notification";
        toast.error("发送通知失败", { description: errorMessage });
        return false;
      } catch (error: any) {
        console.error("InterviewPortal: addNotification error", error);
        toast.error("发送通知失败", {
          description: error?.message || "Unexpected error",
        });
        return false;
      }
    },

    markNotificationRead: (notificationId: string) => {
      set((state) => ({
        notifications: state.notifications.map((notification) =>
          notification.notification_id === notificationId
            ? { ...notification, read: true }
            : notification
        ),
      }));
    },

    loadInterviews: async (force = false) => {
      const { connection, interviewsFetched } = get();
      if (!connection) {
        console.warn(
          "InterviewPortal: No connection available for loadInterviews"
        );
        set({
          interviewsError: "Connection not established",
          interviewsLoading: false,
        });
        return;
      }

      if (interviewsFetched && !force) {
        return;
      }

      set({ interviewsLoading: true, interviewsError: null });

      try {
        const response = await connection.sendEvent({
          event_name: "interview.interviews.list",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            limit: 100,
            offset: 0,
          },
        });

        if (response.success) {
          const rawInterviews =
            response.data?.interviews ||
            response.data?.items ||
            response.data?.results ||
            [];

          const normalized = ensureArray(rawInterviews).map((interview: any) => ({
            interview_id:
              interview?.interview_id ||
              interview?.id ||
              `interview_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 8)}`,
            job_id: interview?.job_id,
            job_title:
              interview?.job_title ||
              interview?.title ||
              interview?.position,
            scheduled_time:
              interview?.scheduled_time ||
              interview?.time ||
              interview?.scheduled_at,
            interviewer: interview?.interviewer,
            location: interview?.location,
            status: interview?.status || "scheduled",
            notes: interview?.notes || interview?.description,
            metadata: interview?.metadata || {},
          }));

          set({
            interviews: normalized,
            interviewsLoading: false,
            interviewsFetched: true,
          });
        } else {
          const message = response.message || "Failed to load interviews";
          set({ interviewsError: message, interviewsLoading: false });
          toast.error("加载面试列表失败", { description: message });
        }
      } catch (error: any) {
        console.error("InterviewPortal: loadInterviews error", error);
        const message = error?.message || "Failed to load interviews";
        set({ interviewsError: message, interviewsLoading: false });
        toast.error("加载面试列表失败", { description: message });
      }
    },

    scheduleInterview: async (payload) => {
      const { connection } = get();
      if (!connection) {
        toast.error("尚未连接到网络，无法安排面试");
        return false;
      }

      try {
        const response = await connection.sendEvent({
          event_name: "interview.interviews.add",
          destination_id: INTERVIEW_DESTINATION,
          payload,
        });

        if (response.success) {
          const interview = response.data?.interview;
          if (interview) {
            const normalized: InterviewRecord = {
              interview_id:
                interview.interview_id ||
                interview.id ||
                `interview_${Date.now()}_${Math.random()
                  .toString(36)
                  .slice(2, 8)}`,
              job_id: interview.job_id || payload.job_id,
              job_title:
                interview.job_title || interview.title || payload.job_title,
              scheduled_time:
                interview.scheduled_time ||
                interview.time ||
                interview.scheduled_at ||
                payload.scheduled_time,
              interviewer: interview.interviewer || payload.interviewer,
              location: interview.location || payload.location,
              status: interview.status || "scheduled",
              notes: interview.notes || payload.notes,
              metadata: interview.metadata || {},
            };

            set((state) => ({
              interviews: [normalized, ...state.interviews],
            }));
          } else {
            await get().loadInterviews(true);
          }

          toast.success("面试已安排");
          return true;
        }

        const message = response.message || "Failed to schedule interview";
        toast.error("安排面试失败", { description: message });
        return false;
      } catch (error: any) {
        console.error("InterviewPortal: scheduleInterview error", error);
        toast.error("安排面试失败", {
          description: error?.message || "Unexpected error",
        });
        return false;
      }
    },

    cancelInterview: async (interviewId: string) => {
      const { connection } = get();
      if (!connection) {
        toast.error("尚未连接到网络，无法取消面试");
        return false;
      }

      try {
        const response = await connection.sendEvent({
          event_name: "interview.interviews.delete",
          destination_id: INTERVIEW_DESTINATION,
          payload: {
            interview_id: interviewId,
          },
        });

        if (response.success) {
          set((state) => ({
            interviews: state.interviews.filter(
              (interview) => interview.interview_id !== interviewId
            ),
          }));
          toast.success("面试已取消");
          return true;
        }

        const message = response.message || "Failed to cancel interview";
        toast.error("取消面试失败", { description: message });
        return false;
      } catch (error: any) {
        console.error("InterviewPortal: cancelInterview error", error);
        toast.error("取消面试失败", {
          description: error?.message || "Unexpected error",
        });
        return false;
      }
    },
  })
);

