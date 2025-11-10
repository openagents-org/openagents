import { create } from "zustand"
import { eventRouter } from "@/services/eventRouter"

// Types
export interface InterviewTopic {
  topic_id: string
  title: string
  content: string
  resume_url: string // PDF resume URL (required)
  resume_blob?: string // Optional base64 blob for preview
  owner_id: string
  timestamp: number
  comment_count: number
  visibility: "private" // Always private
}

export interface InterviewComment {
  comment_id: string
  topic_id: string
  content: string
  author_id: string
  timestamp: number
  parent_comment_id?: string
  thread_level: number
  replies?: InterviewComment[]
}

export interface CreateTopicData {
  title: string
  content: string
  resume_url: string // PDF resume URL (required)
  resume_blob?: string // Optional base64 blob for preview
}

// Helper function to recursively update comment in nested structure
const updateCommentRecursively = (
  comments: InterviewComment[],
  targetId: string,
  updateFn: (comment: InterviewComment) => InterviewComment
): InterviewComment[] => {
  return comments.map((comment) => {
    if (comment.comment_id === targetId) {
      return updateFn(comment)
    } else if (comment.replies && comment.replies.length > 0) {
      const updatedReplies = updateCommentRecursively(
        comment.replies,
        targetId,
        updateFn
      )
      if (updatedReplies !== comment.replies) {
        return { ...comment, replies: updatedReplies }
      }
    }
    return comment
  })
}

interface InterviewState {
  // Topic list
  topics: InterviewTopic[]
  topicsLoading: boolean
  topicsError: string | null

  // Current topic details
  selectedTopic: InterviewTopic | null
  comments: InterviewComment[]
  commentsLoading: boolean
  commentsError: string | null

  // Connection service
  connection: any | null

  // Permission groups
  groupsData: Record<string, string[]> | null
  agentId: string | null

  // Event handler reference for cleanup
  eventHandler?: ((event: any) => void) | null

  // Actions
  setConnection: (connection: any | null) => void
  setGroupsData: (groups: Record<string, string[]>) => void
  setAgentId: (agentId: string) => void
  loadTopics: () => Promise<void>
  loadTopicDetail: (topicId: string) => Promise<void>
  createTopic: (data: CreateTopicData) => Promise<string | null> // Returns topic_id on success, null on failure
  addComment: (
    topicId: string,
    content: string,
    parentId?: string
  ) => Promise<boolean>

  // Real-time updates
  addTopicToList: (topic: InterviewTopic) => void
  addCommentToTopic: (topicId: string, comment: InterviewComment) => void
  countAllComments: (comments: InterviewComment[]) => number
  refreshTopicInList: (topicId: string) => Promise<void>

  // Computed
  getTotalComments: () => number
  getRecentTopics: (limit?: number) => InterviewTopic[]

  // Reset
  resetSelectedTopic: () => void

  // Event handling
  setupEventListeners: () => void
  cleanupEventListeners: () => void

  // Permission check helper
  canViewTopic: (topic: InterviewTopic) => boolean
}

export const useInterviewStore = create<InterviewState>((set, get) => ({
  // Initial state
  topics: [],
  topicsLoading: false,
  topicsError: null,
  selectedTopic: null,
  comments: [],
  commentsLoading: false,
  commentsError: null,
  connection: null,
  groupsData: null,
  agentId: null,
  eventHandler: null,

  // Actions
  setConnection: (connection) => set({ connection }),
  setGroupsData: (groups) => set({ groupsData: groups }),
  setAgentId: (agentId) => set({ agentId }),

  loadTopics: async () => {
    const { connection } = get()
    if (!connection) {
      console.warn("InterviewStore: No connection available for loadTopics")
      set({ topicsError: "No connection available" })
      return
    }

    console.log("InterviewStore: Loading topics...")
    set({ topicsLoading: true, topicsError: null })

    try {
      const response = await connection.sendEvent({
        event_name: "interview.topic.list",
        destination_id: "mod:openagents.mods.workspace.interview",
        payload: {
          query_type: "list_topics",
          limit: 50,
          offset: 0,
        },
      })

      if (response.success && response.data) {
        console.log(
          "InterviewStore: API success, loaded topics:",
          response.data.topics?.length || 0
        )
        set({
          topics: response.data.topics || [],
          topicsLoading: false,
        })
      } else {
        console.warn(
          "InterviewStore: API failed to load topics. Response:",
          response
        )
        set({
          topics: [],
          topicsLoading: false,
          topicsError: "Failed to load topics",
        })
      }
    } catch (error) {
      console.error("InterviewStore: Failed to load topics:", error)
      set({
        topicsError: "Failed to load topics",
        topicsLoading: false,
      })
    }
  },

  loadTopicDetail: async (topicId: string) => {
    const { connection, topics } = get()

    console.log("InterviewStore: Loading topic detail for ID:", topicId)
    set({ commentsLoading: true, commentsError: null })

    // First try to find from loaded topics
    const existingTopic = topics.find((t) => t.topic_id === topicId)

    if (existingTopic) {
      console.log(
        "InterviewStore: Found existing topic in memory:",
        existingTopic.title
      )
      set({
        selectedTopic: existingTopic,
        comments: [],
        commentsLoading: false,
      })

      // Fetch latest comment data from API in background
      if (connection) {
        try {
          const response = await connection.sendEvent({
            event_name: "interview.topic.get",
            destination_id: "mod:openagents.mods.workspace.interview",
            payload: {
              topic_id: topicId,
            },
          })

          if (response.success && response.data) {
            // Backend returns: data={"topic": topic.to_dict(...)}
            const apiTopic = response.data.topic || response.data

            if (apiTopic && apiTopic.topic_id) {
              console.log("InterviewStore: Updated comments from API")
              const comments = apiTopic.comments || []

              const updatedTopics = get().topics.map((t) =>
                t.topic_id === topicId
                  ? {
                      ...t,
                      comment_count: apiTopic.comment_count || comments.length,
                    }
                  : t
              )

              set({
                selectedTopic: apiTopic, // Update with full API data (includes resume_blob!)
                comments: comments,
                topics: updatedTopics,
              })
            }
          }
        } catch (error) {
          console.warn(
            "InterviewStore: Failed to update comments from API:",
            error
          )
        }
      }

      return
    }

    // If not found and no connection, display error
    if (!connection) {
      console.warn(
        "InterviewStore: No connection available and topic not found in memory"
      )
      set({
        commentsError: "Topic not found and no network connection",
        commentsLoading: false,
      })
      return
    }

    // Try to load topic details from API
    try {
      const response = await connection.sendEvent({
        event_name: "interview.topic.get",
        destination_id: "mod:openagents.mods.workspace.interview",
        payload: {
          topic_id: topicId,
        },
      })

      if (response.success && response.data) {
        console.log("InterviewStore: API success, topic data:", response.data)

        // Backend returns: data={"topic": topic.to_dict(...)}
        const topic = response.data.topic || response.data

        if (topic && topic.topic_id) {
          const comments = topic.comments || []

          // Update topic in list if it exists
          const updatedTopics = get().topics.map((t) =>
            t.topic_id === topicId
              ? {
                  ...t,
                  comment_count: topic.comment_count || comments.length,
                }
              : t
          )

          // If topic not in list, add it
          const topicExists = updatedTopics.some((t) => t.topic_id === topicId)
          if (!topicExists) {
            updatedTopics.unshift(topic)
          }

          set({
            selectedTopic: topic,
            comments: comments,
            topics: updatedTopics,
            commentsLoading: false,
          })
          return
        }
      }

      console.warn(
        "InterviewStore: API failed to load topic details. Response:",
        response
      )
      set({
        selectedTopic: null,
        comments: [],
        commentsError: "Failed to load topic details",
        commentsLoading: false,
      })
    } catch (error) {
      console.error("InterviewStore: Failed to load topic details:", error)
      set({
        commentsError: "Failed to load topic details",
        commentsLoading: false,
      })
    }
  },

  createTopic: async (data: CreateTopicData) => {
    const { connection } = get()
    if (!connection) return null

    // Validate PDF URL (accept both file:// URLs from server and .pdf URLs)
    if (
      !data.resume_url ||
      (!data.resume_url.startsWith("file://") &&
        !data.resume_url.toLowerCase().endsWith(".pdf"))
    ) {
      console.error("InterviewStore: Invalid or missing PDF resume URL")
      return null
    }

    try {
      const payload: any = {
        action: "create",
        title: data.title.trim(),
        content: data.content.trim(),
        resume_url: data.resume_url,
      }

      // Include blob if provided
      if (data.resume_blob) {
        payload.resume_blob = data.resume_blob
      }

      const response = await connection.sendEvent({
        event_name: "interview.topic.create",
        destination_id: "mod:openagents.mods.workspace.interview",
        payload,
      })

      if (response.success) {
        // Use the topic data returned from the backend
        const topicData = response.data?.topic || response.data
        const topicId = response.data?.topic_id || topicData?.topic_id

        if (!topicId) {
          console.error(
            "InterviewStore: No topic_id in response:",
            response.data
          )
          return null
        }

        const newTopic: InterviewTopic = {
          topic_id: topicId,
          title: topicData?.title || data.title.trim(),
          content: topicData?.content || data.content.trim(),
          resume_url: topicData?.resume_url || data.resume_url,
          resume_blob: topicData?.resume_blob || data.resume_blob,
          owner_id: topicData?.owner_id || connection.getAgentId() || "unknown",
          timestamp: topicData?.timestamp || Date.now() / 1000,
          comment_count: topicData?.comment_count || 0,
          visibility: topicData?.visibility || "private",
        }

        console.log("InterviewStore: Creating topic with data:", newTopic)
        get().addTopicToList(newTopic)
        return topicId
      }
      return null
    } catch (error) {
      console.error("Failed to create topic:", error)
      return null
    }
  },

  addComment: async (topicId: string, content: string, parentId?: string) => {
    const { connection } = get()
    if (!connection) return false

    try {
      const response = await connection.sendEvent({
        event_name: parentId
          ? "interview.comment.reply"
          : "interview.comment.create",
        destination_id: "mod:openagents.mods.workspace.interview",
        payload: {
          action: parentId ? "reply" : "post",
          topic_id: topicId,
          content: content.trim(),
          ...(parentId && { parent_comment_id: parentId }),
        },
      })

      if (response.success && response.data?.comment) {
        console.log(
          "InterviewStore: Comment posted successfully, using incremental update"
        )

        const comment = response.data.comment
        const interviewComment: InterviewComment = {
          comment_id: comment.comment_id,
          topic_id: comment.topic_id,
          content: comment.content,
          author_id: comment.author_id,
          timestamp: comment.timestamp,
          parent_comment_id: comment.parent_comment_id,
          thread_level: comment.thread_level || (parentId ? 1 : 0),
          replies: [],
        }

        get().addCommentToTopic(topicId, interviewComment)
        return true
      } else if (response.success) {
        console.log(
          "InterviewStore: Comment posted but no comment data returned, falling back to reload"
        )
        await get().loadTopicDetail(topicId)
        return true
      }
      return false
    } catch (error) {
      console.error("Failed to add comment:", error)
      return false
    }
  },

  getTotalComments: () => {
    const { comments } = get()
    return get().countAllComments(comments)
  },

  getRecentTopics: (limit = 10) => {
    const { topics, canViewTopic } = get()

    // Filter accessible topics and sort by timestamp descending (newest first)
    return topics
      .filter((topic) => canViewTopic(topic))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  },

  resetSelectedTopic: () => {
    set({
      selectedTopic: null,
      comments: [],
      commentsError: null,
    })
  },

  // Real-time updates
  addTopicToList: (newTopic: InterviewTopic) => {
    set((state) => {
      const exists = state.topics.some(
        (topic) => topic.topic_id === newTopic.topic_id
      )
      if (exists) {
        console.log(
          "InterviewStore: Topic already exists in list, skipping:",
          newTopic.topic_id
        )
        return state
      }

      console.log("InterviewStore: Adding new topic to list:", newTopic.title)
      return {
        ...state,
        topics: [newTopic, ...state.topics],
      }
    })
  },

  // Event handling - set up event listeners
  setupEventListeners: () => {
    const { connection } = get()
    if (!connection) return

    console.log("InterviewStore: Setting up interview event listeners")

    const interviewEventHandler = (event: any) => {
      console.log(
        "🔔 InterviewStore: Received interview event:",
        event.event_name,
        event
      )
      console.log("🔔 InterviewStore: Event payload:", event.payload)

      // Handle topic creation event
      if (
        event.event_name === "interview.topic.created" &&
        event.payload?.topic
      ) {
        console.log(
          "InterviewStore: Received interview.topic.created event:",
          event
        )
        const topic = event.payload.topic

        const interviewTopic: InterviewTopic = {
          topic_id: topic.topic_id,
          title: topic.title,
          content: topic.content || "",
          resume_url: topic.resume_url,
          owner_id: topic.owner_id,
          timestamp: topic.timestamp,
          comment_count: topic.comment_count || 0,
          visibility: "private",
        }

        // Permission check: only show to creator, interviewer group, and admin group
        const { agentId, groupsData } = get()

        // Check if current agent is the owner
        if (agentId && topic.owner_id === agentId) {
          console.log("InterviewStore: Agent is owner, adding topic to list")
          get().addTopicToList(interviewTopic)
          return
        }

        // Check if current agent is in interviewer or admin groups
        if (agentId && groupsData) {
          const interviewerMembers = groupsData["interviewer"] || []
          const adminMembers = groupsData["admin"] || []

          const hasPermission =
            interviewerMembers.includes(agentId) ||
            adminMembers.includes(agentId)

          if (hasPermission) {
            console.log(
              "InterviewStore: Agent has permission, adding topic to list"
            )
            get().addTopicToList(interviewTopic)
          } else {
            console.log(
              "InterviewStore: Agent does not have permission, ignoring topic"
            )
          }
        } else {
          console.log(
            "InterviewStore: Missing agentId or groupsData, cannot check permissions"
          )
        }
      }

      // Handle comment post event
      else if (
        event.event_name === "interview.comment.created" &&
        event.payload?.comment
      ) {
        console.log(
          "InterviewStore: Received interview.comment.created event:",
          event
        )
        const comment = event.payload.comment
        const topicId = comment.topic_id

        const { selectedTopic } = get()
        if (selectedTopic && selectedTopic.topic_id === topicId) {
          const interviewComment: InterviewComment = {
            comment_id: comment.comment_id,
            topic_id: comment.topic_id,
            content: comment.content,
            author_id: comment.author_id,
            timestamp: comment.timestamp,
            parent_comment_id: comment.parent_comment_id,
            thread_level: comment.thread_level || 0,
            replies: [],
          }

          get().addCommentToTopic(topicId, interviewComment)
          console.log(
            `InterviewStore: Added comment to detail view for topic ${topicId}`
          )
        } else {
          console.log(
            `InterviewStore: Not viewing topic ${topicId}, refreshing topic in list`
          )
          get().refreshTopicInList(topicId)
        }
      }

      // Handle comment reply event
      else if (
        event.event_name === "interview.comment.replied" &&
        event.payload?.comment
      ) {
        console.log(
          "InterviewStore: Received interview.comment.replied event:",
          event
        )
        const comment = event.payload.comment
        const topicId = comment.topic_id

        const { selectedTopic } = get()
        if (selectedTopic && selectedTopic.topic_id === topicId) {
          const interviewComment: InterviewComment = {
            comment_id: comment.comment_id,
            topic_id: comment.topic_id,
            content: comment.content,
            author_id: comment.author_id,
            timestamp: comment.timestamp,
            parent_comment_id: comment.parent_comment_id,
            thread_level: comment.thread_level || 1,
            replies: [],
          }

          get().addCommentToTopic(topicId, interviewComment)
          console.log(
            `InterviewStore: Added reply to detail view for topic ${topicId}`
          )
        } else {
          console.log(
            `InterviewStore: Not viewing topic ${topicId}, refreshing topic in list`
          )
          get().refreshTopicInList(topicId)
        }
      }
    }

    // Register to event router
    console.log("🔔 InterviewStore: Registering event handler to eventRouter")
    eventRouter.onInterviewEvent(interviewEventHandler)
    console.log("🔔 InterviewStore: Event handler registered successfully")

    // Save handler reference for cleanup
    set({ eventHandler: interviewEventHandler })
  },

  // Recursively calculate total comment count
  countAllComments: (comments: InterviewComment[]): number => {
    let total = 0
    for (const comment of comments) {
      total += 1
      if (comment.replies && comment.replies.length > 0) {
        total += get().countAllComments(comment.replies)
      }
    }
    return total
  },

  // Fetch and update specific topic info in list
  refreshTopicInList: async (topicId: string) => {
    const { connection } = get()
    if (!connection) {
      console.warn(
        "InterviewStore: No connection available for refreshTopicInList"
      )
      return
    }

    try {
      console.log(`InterviewStore: Refreshing topic ${topicId} in list`)
      const response = await connection.sendEvent({
        event_name: "interview.topic.get",
        destination_id: "mod:openagents.mods.workspace.interview",
        payload: {
          topic_id: topicId,
        },
      })

      if (response.success && response.data) {
        // Backend returns: data={"topic": topic.to_dict(...)}
        const topic = response.data.topic || response.data

        if (topic && topic.topic_id) {
          console.log(
            `InterviewStore: Updating topic ${topicId} with fresh data:`,
            {
              comment_count: topic.comment_count,
            }
          )

          set((state) => ({
            topics: state.topics.map((t) =>
              t.topic_id === topicId
                ? {
                    ...t,
                    comment_count: topic.comment_count || 0,
                  }
                : t
            ),
          }))
        } else {
          console.warn(
            `InterviewStore: No topic data in response for ${topicId}`
          )
        }
      } else {
        console.warn(
          `InterviewStore: Failed to refresh topic ${topicId}:`,
          response
        )
      }
    } catch (error) {
      console.error(`InterviewStore: Error refreshing topic ${topicId}:`, error)
    }
  },

  // Incrementally update comment to current topic
  addCommentToTopic: (_topicId: string, newComment: InterviewComment) => {
    set((state) => {
      const exists = state.comments.some(
        (comment) => comment.comment_id === newComment.comment_id
      )
      if (exists) {
        console.log(
          "InterviewStore: Comment already exists, skipping:",
          newComment.comment_id
        )
        return state
      }

      const addReplyToParent = (
        comments: InterviewComment[],
        parentId: string,
        reply: InterviewComment
      ): { found: boolean; comments: InterviewComment[] } => {
        let found = false
        const updatedComments = comments.map((comment) => {
          if (comment.comment_id === parentId) {
            found = true
            // Create new comment object with updated replies (immutable)
            return {
              ...comment,
              replies: [reply, ...(comment.replies || [])],
            }
          } else if (comment.replies && comment.replies.length > 0) {
            // Recursively search in nested replies
            const result = addReplyToParent(comment.replies, parentId, reply)
            if (result.found) {
              found = true
              // Create new comment object with updated replies (immutable)
              return { ...comment, replies: result.comments }
            }
          }
          return comment
        })
        return { found, comments: updatedComments }
      }

      let updatedComments: InterviewComment[]

      if (newComment.parent_comment_id) {
        const result = addReplyToParent(
          state.comments,
          newComment.parent_comment_id,
          newComment
        )
        if (result.found) {
          updatedComments = result.comments
        } else {
          console.warn(
            "InterviewStore: Parent comment not found, treating as root comment:",
            newComment.parent_comment_id
          )
          updatedComments = [newComment, ...state.comments]
        }
      } else {
        updatedComments = [newComment, ...state.comments]
      }

      console.log(
        "InterviewStore: Added comment, parent_comment_id:",
        newComment.parent_comment_id
      )

      return {
        ...state,
        comments: updatedComments,
      }
    })
  },

  // Cleanup event listeners
  cleanupEventListeners: () => {
    const { eventHandler } = get()

    console.log("InterviewStore: Cleaning up interview event listeners")

    if (eventHandler) {
      eventRouter.offInterviewEvent(eventHandler)
      set({ eventHandler: null })
    }
  },

  // Permission check helper
  canViewTopic: (topic: InterviewTopic) => {
    const { agentId, groupsData } = get()

    // Check if current agent is the owner
    if (agentId && topic.owner_id === agentId) {
      return true
    }

    // Check if current agent is in interviewer or admin groups
    if (agentId && groupsData) {
      const interviewerMembers = groupsData["interviewer"] || []
      const adminMembers = groupsData["admin"] || []

      return (
        interviewerMembers.includes(agentId) || adminMembers.includes(agentId)
      )
    }

    return false
  },
}))

// Bind test tools to global object in development environment
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  ;(window as any).useInterviewStore = useInterviewStore
  console.log(
    "Interview store and test utils available globally for development testing"
  )
}
