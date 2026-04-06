import { create } from "zustand";
import { eventRouter } from "@/services/eventRouter";
// import { HttpEventConnector } from "@/services/openAgentsService";

// Types
export interface ForumTopic {
  topic_id: string;
  title: string;
  content: string;
  owner_id: string;
  timestamp: number;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  allowed_groups?: string[];
}

export interface ForumComment {
  comment_id: string;
  topic_id: string;
  content: string;
  author_id: string;
  timestamp: number;
  upvotes: number;
  downvotes: number;
  parent_comment_id?: string;
  thread_level: number;
  replies?: ForumComment[];
}

export interface CreateTopicData {
  title: string;
  content: string;
  allowed_groups?: string[];
}

// Helper function to recursively update comment votes
const updateCommentVotesRecursively = (
  comments: ForumComment[],
  targetId: string,
  upvotes: number,
  downvotes: number
): ForumComment[] => {
  return comments.map((comment) => {
    if (comment.comment_id === targetId) {
      // Found target comment, update votes
      console.log(
        `ForumStore: Updating votes for comment ${targetId}: upvotes=${upvotes}, downvotes=${downvotes}`
      );
      return { ...comment, upvotes, downvotes };
    } else if (comment.replies && comment.replies.length > 0) {
      // Recursively update comments in replies
      const updatedReplies = updateCommentVotesRecursively(
        comment.replies,
        targetId,
        upvotes,
        downvotes
      );
      // Only return new object when replies have changed
      if (updatedReplies !== comment.replies) {
        return { ...comment, replies: updatedReplies };
      }
    }
    return comment;
  });
};

interface ForumState {
  // Topic list
  topics: ForumTopic[];
  topicsLoading: boolean;
  topicsError: string | null;

  // Current topic details
  selectedTopic: ForumTopic | null;
  comments: ForumComment[];
  commentsLoading: boolean;
  commentsError: string | null;

  // Connection service
  connection: any | null;

  // Permission groups
  groupsData: Record<string, string[]> | null;
  agentId: string | null;

  // Event handler reference for cleanup
  eventHandler?: ((event: any) => void) | null;

  // Actions
  setConnection: (connection: any | null) => void;
  setGroupsData: (groups: Record<string, string[]>) => void;
  setAgentId: (agentId: string) => void;
  loadTopics: () => Promise<void>;
  loadTopicDetail: (topicId: string) => Promise<void>;
  createTopic: (data: CreateTopicData) => Promise<boolean>;
  addComment: (
    topicId: string,
    content: string,
    parentId?: string
  ) => Promise<boolean>;
  vote: (
    type: "topic" | "comment",
    targetId: string,
    voteType: "upvote" | "downvote",
    onError?: (message: string) => void
  ) => Promise<boolean>;

  // Real-time updates
  addTopicToList: (topic: ForumTopic) => void;
  addCommentToTopic: (topicId: string, comment: ForumComment) => void;
  countAllComments: (comments: ForumComment[]) => number;
  refreshTopicInList: (topicId: string) => Promise<void>;

  // Computed
  getPopularTopics: () => ForumTopic[];
  getTotalComments: () => number;

  // Reset
  resetSelectedTopic: () => void;

  // Event handling
  setupEventListeners: () => void;
  cleanupEventListeners: () => void;
}

export const useForumStore = create<ForumState>((set, get) => ({
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
    const { connection } = get();
    if (!connection) {
      console.warn("ForumStore: No connection available for loadTopics");
      set({ topicsError: "No connection available" });
      return;
    }

    console.log("ForumStore: Loading topics...");
    set({ topicsLoading: true, topicsError: null });

    try {
      const response = await connection.sendEvent({
        event_name: "forum.topics.list",
        destination_id: "mod:openagents.mods.workspace.forum",
        payload: {
          query_type: "list_topics",
          limit: 50,
          offset: 0,
          sort_by: "recent",
        },
      });

      if (response.success && response.data) {
        console.log(
          "ForumStore: API success, loaded topics:",
          response.data.topics?.length || 0
        );
        set({
          topics: response.data.topics || [],
          topicsLoading: false,
        });
      } else {
        // Set error state when API fails
        console.warn(
          "ForumStore: API failed to load topics. Response:",
          response
        );
        set({
          topics: [],
          topicsLoading: false,
          topicsError: "Failed to load topics",
        });
      }
    } catch (error) {
      console.error("ForumStore: Failed to load topics:", error);
      set({
        topicsError: "Failed to load topics",
        topicsLoading: false,
      });
    }
  },

  loadTopicDetail: async (topicId: string) => {
    const { connection, topics } = get();

    console.log("ForumStore: Loading topic detail for ID:", topicId);
    console.log(
      "ForumStore: Available topics:",
      topics.map((t) => ({ id: t.topic_id, title: t.title }))
    );

    set({ commentsLoading: true, commentsError: null });

    // First try to find from loaded topics - this allows immediate display of details
    const existingTopic = topics.find((t) => t.topic_id === topicId);

    if (existingTopic) {
      console.log(
        "ForumStore: Found existing topic in memory:",
        existingTopic.title
      );
      // Display topic immediately with empty comments array
      set({
        selectedTopic: existingTopic,
        comments: [],
        commentsLoading: false,
      });

      // Optional: try to fetch latest comment data from API in background
      if (connection) {
        try {
          const response = await connection.sendEvent({
            event_name: "forum.topic.get",
            destination_id: "mod:openagents.mods.workspace.forum",
            payload: {
              query_type: "get_topic",
              topic_id: topicId,
            },
          });

          if (response.success && response.data && response.data.comments) {
            console.log("ForumStore: Updated comments from API");
            // Sort by timestamp descending to ensure latest comments are on top
            const sortedComments = [...response.data.comments].sort(
              (a, b) => b.timestamp - a.timestamp
            );

            // Synchronize comment_count in topics list
            const updatedTopics = get().topics.map((t) =>
              t.topic_id === topicId
                ? { ...t, comment_count: sortedComments.length }
                : t
            );

            set({
              comments: sortedComments,
              topics: updatedTopics,
            });
          }
        } catch (error) {
          console.warn(
            "ForumStore: Failed to update comments from API:",
            error
          );
        }
      }

      return;
    }

    // If not found in topics and no connection, display error
    if (!connection) {
      console.warn(
        "ForumStore: No connection available and topic not found in memory"
      );
      set({
        commentsError: "Topic not found and no network connection",
        commentsLoading: false,
      });
      return;
    }

    // Try to load topic details from API
    try {
      const response = await connection.sendEvent({
        event_name: "forum.topic.get",
        destination_id: "mod:openagents.mods.workspace.forum",
        payload: {
          query_type: "get_topic",
          topic_id: topicId,
        },
      });

      if (response.success && response.data) {
        console.log("ForumStore: API success, topic data:", response.data);

        // Check data structure - API may return response.data as topic, or response.data.topic
        const topic = response.data.topic_id
          ? response.data
          : response.data.topic;

        if (topic) {
          // Sort comments by timestamp descending to ensure latest comments are on top
          const comments = response.data.comments || [];
          const sortedComments = [...comments].sort(
            (a, b) => b.timestamp - a.timestamp
          );

          // Synchronize comment_count for corresponding topic in topics list
          const updatedTopics = get().topics.map((t) =>
            t.topic_id === topicId
              ? {
                  ...t,
                  comment_count: topic.comment_count || sortedComments.length,
                }
              : t
          );

          set({
            selectedTopic: topic,
            comments: sortedComments,
            topics: updatedTopics,
            commentsLoading: false,
          });
          return;
        }
      }

      // API call failed, display error state
      console.warn(
        "ForumStore: API failed to load topic details. Response:",
        response
      );
      set({
        selectedTopic: null,
        comments: [],
        commentsError: "Failed to load topic details",
        commentsLoading: false,
      });
    } catch (error) {
      console.error("ForumStore: Failed to load topic details:", error);
      set({
        commentsError: "Failed to load topic details",
        commentsLoading: false,
      });
    }
  },

  createTopic: async (data: CreateTopicData) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const allowed_groups =
        data.allowed_groups && data.allowed_groups.length > 0
          ? data.allowed_groups
          : undefined;
      const response = await connection.sendEvent({
        event_name: "forum.topic.create",
        destination_id: "mod:openagents.mods.workspace.forum",
        payload: {
          action: "create",
          title: data.title.trim(),
          content: data.content.trim(),
          allowed_groups,
        },
      });

      if (response.success) {
        // Construct new topic object and add directly to list
        const newTopic: ForumTopic = {
          topic_id:
            response.data?.topic_id ||
            `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          title: data.title.trim(),
          content: data.content.trim(),
          owner_id: connection.getAgentId() || "unknown",
          timestamp: response.data?.timestamp || Date.now() / 1000,
          upvotes: 0,
          allowed_groups,
          downvotes: 0,
          comment_count: 0,
        };

        console.log("ForumStore: Creating topic with data:", newTopic);

        // Add directly to top of list, no need to reload
        get().addTopicToList(newTopic);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to create topic:", error);
      return false;
    }
  },

  addComment: async (topicId: string, content: string, parentId?: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await connection.sendEvent({
        event_name: parentId ? "forum.comment.reply" : "forum.comment.post",
        destination_id: "mod:openagents.mods.workspace.forum",
        payload: {
          action: parentId ? "reply" : "post",
          topic_id: topicId,
          content: content.trim(),
          ...(parentId && { parent_comment_id: parentId }),
        },
      });

      if (response.success && response.data?.comment) {
        console.log(
          "ForumStore: Comment posted successfully, using incremental update"
        );

        // Use returned comment data for incremental update
        const comment = response.data.comment;
        const forumComment: ForumComment = {
          comment_id: comment.comment_id,
          topic_id: comment.topic_id,
          content: comment.content,
          author_id: comment.author_id,
          timestamp: comment.timestamp,
          upvotes: comment.upvotes || 0,
          downvotes: comment.downvotes || 0,
          parent_comment_id: comment.parent_comment_id,
          thread_level: comment.thread_level || (parentId ? 1 : 0),
          replies: [],
        };

        get().addCommentToTopic(topicId, forumComment);
        return true;
      } else if (response.success) {
        // If no comment data returned, fall back to original refresh method
        console.log(
          "ForumStore: Comment posted but no comment data returned, falling back to reload"
        );
        await get().loadTopicDetail(topicId);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to add comment:", error);
      return false;
    }
  },

  vote: async (
    type: "topic" | "comment",
    targetId: string,
    voteType: "upvote" | "downvote",
    onError?: (message: string) => void
  ) => {
    const { connection } = get();
    if (!connection) {
      onError?.("No connection available");
      return false;
    }

    try {
      const response = await connection.sendEvent({
        event_name: "forum.vote.cast",
        destination_id: "mod:openagents.mods.workspace.forum",
        payload: {
          action: "cast",
          target_type: type,
          target_id: targetId,
          vote_type: voteType,
        },
      });

      if (response.success) {
        // Refresh data
        if (type === "topic") {
          await get().loadTopics();
          // If it's the currently selected topic, also refresh details
          const { selectedTopic } = get();
          if (selectedTopic && selectedTopic.topic_id === targetId) {
            await get().loadTopicDetail(targetId);
          }
        } else {
          // Refresh comments
          const { selectedTopic } = get();
          if (selectedTopic) {
            await get().loadTopicDetail(selectedTopic.topic_id);
          }
        }
        return true;
      } else {
        // Handle vote failure
        const errorMessage = response.message || "Vote failed";
        onError?.(errorMessage);
        return false;
      }
    } catch (error) {
      console.error("Failed to vote:", error);
      onError?.("Failed to vote due to network error");
      return false;
    }
  },

  getPopularTopics: () => {
    const { topics, groupsData, agentId } = get();
    console.log(
      "ForumStore: Getting popular topics:",
      topics,
      groupsData,
      agentId
    );

    // If groupsData not yet loaded, return empty array
    if (!groupsData) {
      console.log(
        "ForumStore: groupsData not loaded yet, returning empty array"
      );
      return [];
    }

    // Filter topics with view permission
    const filteredTopics = topics.filter((topic) => {
      // If no allowed_groups or empty, it's a public topic
      if (!topic.allowed_groups || topic.allowed_groups.length === 0) {
        return true;
      }

      // Check if current agent is the owner
      if (agentId && topic.owner_id === agentId) {
        return true;
      }

      // Check if current agent is in allowed groups
      if (agentId) {
        const hasPermission = topic.allowed_groups.some((groupName: string) => {
          const groupMembers = groupsData[groupName];
          return groupMembers && groupMembers.includes(agentId);
        });
        return hasPermission;
      }

      // If no agentId, don't display private topics
      return false;
    });

    return [...filteredTopics]
      .sort((a, b) => b.upvotes + b.downvotes - (a.upvotes + a.downvotes))
      .slice(0, 10);
  },

  getTotalComments: () => {
    const { comments } = get();
    return get().countAllComments(comments);
  },

  resetSelectedTopic: () => {
    set({
      selectedTopic: null,
      comments: [],
      commentsError: null,
    });
  },

  // Real-time updates - incrementally add new topic to top of list
  addTopicToList: (newTopic: ForumTopic) => {
    set((state) => {
      // Check if topic already exists to avoid duplicate additions
      const exists = state.topics.some(
        (topic) => topic.topic_id === newTopic.topic_id
      );
      if (exists) {
        console.log(
          "ForumStore: Topic already exists in list, skipping:",
          newTopic.topic_id
        );
        return state;
      }

      console.log("ForumStore: Adding new topic to list:", newTopic.title);
      return {
        ...state,
        topics: [newTopic, ...state.topics],
      };
    });
  },

  // Event handling - set up event listeners
  setupEventListeners: () => {
    const { connection } = get();
    if (!connection) return;

    console.log("ForumStore: Setting up forum event listeners");

    // Use event router to listen for forum-related events
    const forumEventHandler = (event: any) => {
      console.log("ForumStore: Received forum event:", event);

      // Handle topic creation event
      if (event.event_name === "forum.topic.created" && event.payload?.topic) {
        console.log("ForumStore: Received forum.topic.created event:", event);
        const topic = event.payload.topic;
        const allowed_groups = topic.allowed_groups;

        // Convert backend data to ForumTopic format
        const forumTopic: ForumTopic = {
          topic_id: topic.topic_id,
          title: topic.title,
          content: topic.content || "",
          owner_id: topic.owner_id,
          timestamp: topic.timestamp,
          upvotes: topic.upvotes || 0,
          downvotes: topic.downvotes || 0,
          comment_count: topic.comment_count || 0,
          allowed_groups,
        };

        // Permission check: determine if current agent has permission to view this topic
        const { agentId, groupsData } = get();

        // If no allowed_groups or empty, it's a public topic
        if (!allowed_groups || allowed_groups.length === 0) {
          console.log("ForumStore: Public topic, adding to list");
          get().addTopicToList(forumTopic);
          return;
        }

        // Check if current agent is the owner
        if (agentId && topic.owner_id === agentId) {
          console.log("ForumStore: Agent is owner, adding topic to list");
          get().addTopicToList(forumTopic);
          return;
        }

        // Check if current agent is in allowed groups
        if (agentId && groupsData) {
          // Check if agentId exists in any of the allowed_groups
          const hasPermission = allowed_groups.some((groupName: string) => {
            const groupMembers = groupsData[groupName];
            return groupMembers && groupMembers.includes(agentId);
          });

          if (hasPermission) {
            console.log(
              "ForumStore: Agent has permission, adding topic to list"
            );
            get().addTopicToList(forumTopic);
          } else {
            console.log(
              "ForumStore: Agent does not have permission, ignoring topic"
            );
          }
        } else {
          console.log(
            "ForumStore: Missing agentId or groupsData, cannot check permissions"
          );
        }
      }

      // Handle comment post event
      else if (
        event.event_name === "forum.comment.posted" &&
        event.payload?.comment
      ) {
        console.log("ForumStore: Received forum.comment.posted event:", event);
        const comment = event.payload.comment;
        const topicId = comment.topic_id;

        const { selectedTopic } = get();
        if (selectedTopic && selectedTopic.topic_id === topicId) {
          // Currently on detail page - add comment to detail page
          const forumComment: ForumComment = {
            comment_id: comment.comment_id,
            topic_id: comment.topic_id,
            content: comment.content,
            author_id: comment.author_id,
            timestamp: comment.timestamp,
            upvotes: comment.upvotes || 0,
            downvotes: comment.downvotes || 0,
            parent_comment_id: comment.parent_comment_id,
            thread_level: comment.thread_level || 0,
            replies: [],
          };

          get().addCommentToTopic(topicId, forumComment);
          console.log(
            `ForumStore: Added comment to detail view for topic ${topicId}`
          );
        } else {
          // Currently on list page - refresh topic info to update comment count
          console.log(
            `ForumStore: Not viewing topic ${topicId}, refreshing topic in list`
          );
          get().refreshTopicInList(topicId);
        }
      }

      // Handle comment reply event
      else if (
        event.event_name === "forum.comment.replied" &&
        event.payload?.comment
      ) {
        console.log("ForumStore: Received forum.comment.replied event:", event);
        const comment = event.payload.comment;
        const topicId = comment.topic_id;

        const { selectedTopic } = get();
        if (selectedTopic && selectedTopic.topic_id === topicId) {
          // Currently on detail page - add reply to detail page
          const forumComment: ForumComment = {
            comment_id: comment.comment_id,
            topic_id: comment.topic_id,
            content: comment.content,
            author_id: comment.author_id,
            timestamp: comment.timestamp,
            upvotes: comment.upvotes || 0,
            downvotes: comment.downvotes || 0,
            parent_comment_id: comment.parent_comment_id,
            thread_level: comment.thread_level || 1,
            replies: [],
          };

          get().addCommentToTopic(topicId, forumComment);
          console.log(
            `ForumStore: Added reply to detail view for topic ${topicId}`
          );
        } else {
          // Currently on list page - refresh topic info to update comment count
          console.log(
            `ForumStore: Not viewing topic ${topicId}, refreshing topic in list`
          );
          get().refreshTopicInList(topicId);
        }
      }

      // Handle vote event
      else if (event.event_name === "forum.vote.cast" && event.payload) {
        console.log("ForumStore: Received forum.vote.cast event:", event);
        const { target_type, target_id } = event.payload;

        // Refresh corresponding data based on vote target type
        if (target_type === "topic") {
          // Refresh topics list to update vote count
          console.log("ForumStore: Vote cast on topic, refreshing topics list");
          get().loadTopics();

          // If it's the currently viewed topic, also refresh details
          const { selectedTopic } = get();
          if (selectedTopic && selectedTopic.topic_id === target_id) {
            console.log(
              "ForumStore: Vote cast on current topic, refreshing topic detail"
            );
            get().loadTopicDetail(target_id);
          }
        } else if (target_type === "comment") {
          // Refresh current topic's comments to update vote count
          const { selectedTopic } = get();
          if (selectedTopic) {
            console.log(
              "ForumStore: Vote cast on comment, refreshing topic detail"
            );
            get().loadTopicDetail(selectedTopic.topic_id);
          }
        }
      } else if (event.event_name === "forum.vote.notification") {
        console.log(
          "ForumStore: Received forum.vote.notification event:",
          event
        );
        const { target_type, target_id, upvotes, downvotes } = event.payload;

        if (target_type === "topic") {
          // Update topic in topics list
          set((state) => ({
            topics: state.topics.map((topic) =>
              topic.topic_id === target_id
                ? { ...topic, upvotes, downvotes }
                : topic
            ),
          }));

          // Update currently selected topic if it matches
          const { selectedTopic } = get();
          if (selectedTopic && selectedTopic.topic_id === target_id) {
            set((state) => ({
              ...state,
              selectedTopic: { ...selectedTopic, upvotes, downvotes },
            }));
          }
        } else if (target_type === "comment") {
          // Update comment in the current topic's comments (including nested replies)
          set((state) => ({
            comments: updateCommentVotesRecursively(
              state.comments,
              target_id,
              upvotes,
              downvotes
            ),
          }));
        }
      }
    };

    // Register to event router
    eventRouter.onForumEvent(forumEventHandler);

    // Save handler reference for cleanup
    set({ eventHandler: forumEventHandler });
  },

  // Recursively calculate total comment count (including nested replies)
  countAllComments: (comments: ForumComment[]): number => {
    let total = 0;
    for (const comment of comments) {
      total += 1; // Current comment
      if (comment.replies && comment.replies.length > 0) {
        total += get().countAllComments(comment.replies); // Recursively calculate child comments
      }
    }
    return total;
  },

  // Fetch and update specific topic info in list
  refreshTopicInList: async (topicId: string) => {
    const { connection } = get();
    if (!connection) {
      console.warn(
        "ForumStore: No connection available for refreshTopicInList"
      );
      return;
    }

    try {
      console.log(`ForumStore: Refreshing topic ${topicId} in list`);
      const response = await connection.sendEvent({
        event_name: "forum.topic.get",
        destination_id: "mod:openagents.mods.workspace.forum",
        payload: {
          query_type: "get_topic",
          topic_id: topicId,
        },
      });

      if (response.success && response.data) {
        // Check data structure - API may return response.data as topic, or response.data.topic
        const topic = response.data.topic_id
          ? response.data
          : response.data.topic;

        if (topic) {
          console.log(
            `ForumStore: Updating topic ${topicId} with fresh data:`,
            {
              comment_count: topic.comment_count,
              upvotes: topic.upvotes,
              downvotes: topic.downvotes,
            }
          );

          // Update corresponding topic in topics list
          set((state) => ({
            topics: state.topics.map((t) =>
              t.topic_id === topicId
                ? {
                    ...t,
                    comment_count: topic.comment_count || 0,
                    upvotes: topic.upvotes || 0,
                    downvotes: topic.downvotes || 0,
                    // Keep other fields unchanged, only update required statistics
                  }
                : t
            ),
          }));
        } else {
          console.warn(`ForumStore: No topic data in response for ${topicId}`);
        }
      } else {
        console.warn(
          `ForumStore: Failed to refresh topic ${topicId}:`,
          response
        );
      }
    } catch (error) {
      console.error(`ForumStore: Error refreshing topic ${topicId}:`, error);
    }
  },

  // Incrementally update comment to current topic
  addCommentToTopic: (_topicId: string, newComment: ForumComment) => {
    set((state) => {
      // Check if comment already exists to avoid duplicate additions
      const exists = state.comments.some(
        (comment) => comment.comment_id === newComment.comment_id
      );
      if (exists) {
        console.log(
          "ForumStore: Comment already exists, skipping:",
          newComment.comment_id
        );
        return state;
      }

      // Recursively find parent comment and add reply
      const addReplyToParent = (
        comments: ForumComment[],
        parentId: string,
        reply: ForumComment
      ): boolean => {
        for (let i = 0; i < comments.length; i++) {
          const comment = comments[i];
          if (comment.comment_id === parentId) {
            // Found parent comment, add reply to beginning of its replies array (newest first)
            if (!comment.replies) {
              comment.replies = [];
            }
            comment.replies.unshift(reply);
            return true;
          }
          // Recursively search child comments
          if (comment.replies && comment.replies.length > 0) {
            if (addReplyToParent(comment.replies, parentId, reply)) {
              return true;
            }
          }
        }
        return false;
      };

      let updatedComments = [...state.comments];

      if (newComment.parent_comment_id) {
        // This is a reply, find parent comment and add to its replies
        const foundParent = addReplyToParent(
          updatedComments,
          newComment.parent_comment_id,
          newComment
        );
        if (!foundParent) {
          // If parent comment not found, treat as root comment
          console.warn(
            "ForumStore: Parent comment not found, treating as root comment:",
            newComment.parent_comment_id
          );
          updatedComments.unshift(newComment);
        }
      } else {
        // This is a root comment, add to beginning of root comments list (newest first)
        updatedComments.unshift(newComment);
      }

      console.log(
        "ForumStore: Added comment, parent_comment_id:",
        newComment.parent_comment_id
      );

      return {
        ...state,
        comments: updatedComments,
      };
    });
  },

  // Cleanup event listeners
  cleanupEventListeners: () => {
    const { eventHandler } = get();

    console.log("ForumStore: Cleaning up forum event listeners");

    if (eventHandler) {
      eventRouter.offForumEvent(eventHandler);
      set({ eventHandler: null });
    }
  },
}));

// Bind test tools to global object in development environment
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).useForumStore = useForumStore;
  console.log(
    "Forum store and test utils available globally for development testing"
  );
}
