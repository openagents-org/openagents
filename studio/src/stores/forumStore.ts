import { create } from "zustand";
import { OpenAgentsService } from "@/services/openAgentsService";

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
}

interface ForumState {
  // 话题列表
  topics: ForumTopic[];
  topicsLoading: boolean;
  topicsError: string | null;

  // 当前话题详情
  selectedTopic: ForumTopic | null;
  comments: ForumComment[];
  commentsLoading: boolean;
  commentsError: string | null;

  // 连接服务
  connection: OpenAgentsService | null;

  // Actions
  setConnection: (connection: OpenAgentsService | null) => void;
  loadTopics: () => Promise<void>;
  loadTopicDetail: (topicId: string) => Promise<void>;
  createTopic: (data: CreateTopicData) => Promise<boolean>;
  addComment: (topicId: string, content: string, parentId?: string) => Promise<boolean>;
  vote: (type: 'topic' | 'comment', targetId: string, voteType: 'upvote' | 'downvote') => Promise<boolean>;

  // Real-time updates
  addTopicToList: (topic: ForumTopic) => void;
  addCommentToTopic: (topicId: string, comment: ForumComment) => void;
  countAllComments: (comments: ForumComment[]) => number;

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

  // Actions
  setConnection: (connection) => set({ connection }),

  loadTopics: async () => {
    const { connection } = get();
    if (!connection) {
      console.warn('ForumStore: No connection available for loadTopics');
      set({ topicsError: 'No connection available' });
      return;
    }

    console.log('ForumStore: Loading topics...');
    set({ topicsLoading: true, topicsError: null });

    try {
      const response = await connection.sendEvent({
        event_name: 'forum.topics.list',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          query_type: 'list_topics',
          limit: 50,
          offset: 0,
          sort_by: 'recent'
        }
      });

      if (response.success && response.data) {
        console.log('ForumStore: API success, loaded topics:', response.data.topics?.length || 0);
        set({
          topics: response.data.topics || [],
          topicsLoading: false
        });
      } else {
        // API失败时设置错误状态
        console.warn('ForumStore: API failed to load topics. Response:', response);
        set({
          topics: [],
          topicsLoading: false,
          topicsError: 'Failed to load topics'
        });
      }
    } catch (error) {
      console.error('ForumStore: Failed to load topics:', error);
      set({
        topicsError: 'Failed to load topics',
        topicsLoading: false
      });
    }
  },

  loadTopicDetail: async (topicId: string) => {
    const { connection, topics } = get();

    console.log('ForumStore: Loading topic detail for ID:', topicId);
    console.log('ForumStore: Available topics:', topics.map(t => ({ id: t.topic_id, title: t.title })));

    set({ commentsLoading: true, commentsError: null });

    // 首先尝试从已加载的topics中查找 - 这样可以立即显示详情
    const existingTopic = topics.find(t => t.topic_id === topicId);

    if (existingTopic) {
      console.log('ForumStore: Found existing topic in memory:', existingTopic.title);
      // 立即显示话题，评论为空数组
      set({
        selectedTopic: existingTopic,
        comments: [],
        commentsLoading: false
      });

      // 可选：在后台尝试从API获取最新的评论数据
      if (connection) {
        try {
          const response = await connection.sendEvent({
            event_name: 'forum.topic.get',
            destination_id: 'mod:openagents.mods.workspace.forum',
            payload: {
              query_type: 'get_topic',
              topic_id: topicId
            }
          });

          if (response.success && response.data && response.data.comments) {
            console.log('ForumStore: Updated comments from API');
            // 按timestamp降序排序，确保最新comment在最上面
            const sortedComments = [...response.data.comments].sort((a, b) => b.timestamp - a.timestamp);

            // 同步更新topics列表中的comment_count
            const updatedTopics = get().topics.map(t =>
              t.topic_id === topicId
                ? { ...t, comment_count: sortedComments.length }
                : t
            );

            set({
              comments: sortedComments,
              topics: updatedTopics
            });
          }
        } catch (error) {
          console.warn('ForumStore: Failed to update comments from API:', error);
        }
      }

      return;
    }

    // 如果在topics中找不到，且没有连接，显示错误
    if (!connection) {
      console.warn('ForumStore: No connection available and topic not found in memory');
      set({
        commentsError: 'Topic not found and no network connection',
        commentsLoading: false
      });
      return;
    }

    // 尝试从API加载topic详情
    try {
      const response = await connection.sendEvent({
        event_name: 'forum.topic.get',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          query_type: 'get_topic',
          topic_id: topicId
        }
      });

      if (response.success && response.data) {
        console.log('ForumStore: API success, topic data:', response.data);

        // 检查数据结构 - API可能返回 response.data 就是topic，或者 response.data.topic
        const topic = response.data.topic_id ? response.data : response.data.topic;

        if (topic) {
          // 按timestamp降序排序comments，确保最新comment在最上面
          const comments = response.data.comments || [];
          const sortedComments = [...comments].sort((a, b) => b.timestamp - a.timestamp);

          // 同步更新topics列表中对应topic的comment_count
          const updatedTopics = get().topics.map(t =>
            t.topic_id === topicId
              ? { ...t, comment_count: topic.comment_count || sortedComments.length }
              : t
          );

          set({
            selectedTopic: topic,
            comments: sortedComments,
            topics: updatedTopics,
            commentsLoading: false
          });
          return;
        }
      }

      // API调用失败，显示错误状态
      console.warn('ForumStore: API failed to load topic details. Response:', response);
      set({
        selectedTopic: null,
        comments: [],
        commentsError: 'Failed to load topic details',
        commentsLoading: false
      });

    } catch (error) {
      console.error('ForumStore: Failed to load topic details:', error);
      set({
        commentsError: 'Failed to load topic details',
        commentsLoading: false
      });
    }
  },

  createTopic: async (data: CreateTopicData) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await connection.sendEvent({
        event_name: 'forum.topic.create',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          action: 'create',
          title: data.title.trim(),
          content: data.content.trim()
        }
      });

      if (response.success) {
        // 构造新话题对象并直接添加到列表
        const newTopic: ForumTopic = {
          topic_id: response.data?.topic?.topic_id || `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          title: data.title.trim(),
          content: data.content.trim(),
          owner_id: connection.getAgentId() || 'unknown',
          timestamp: Date.now() / 1000,
          upvotes: 0,
          downvotes: 0,
          comment_count: 0
        };

        console.log('ForumStore: Creating topic with data:', newTopic);

        // 直接添加到列表顶部，无需重新加载
        get().addTopicToList(newTopic);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to create topic:', error);
      return false;
    }
  },

  addComment: async (topicId: string, content: string, parentId?: string) => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await connection.sendEvent({
        event_name: parentId ? 'forum.comment.reply' : 'forum.comment.post',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          action: parentId ? 'reply' : 'post',
          topic_id: topicId,
          content: content.trim(),
          ...(parentId && { parent_comment_id: parentId })
        }
      });

      if (response.success && response.data?.comment) {
        console.log('ForumStore: Comment posted successfully, using incremental update');

        // 使用返回的comment数据进行增量更新
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
          replies: []
        };

        get().addCommentToTopic(topicId, forumComment);
        return true;
      } else if (response.success) {
        // 如果没有返回comment数据，则使用原来的方式刷新
        console.log('ForumStore: Comment posted but no comment data returned, falling back to reload');
        await get().loadTopicDetail(topicId);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to add comment:', error);
      return false;
    }
  },

  vote: async (type: 'topic' | 'comment', targetId: string, voteType: 'upvote' | 'downvote') => {
    const { connection } = get();
    if (!connection) return false;

    try {
      const response = await connection.sendEvent({
        event_name: 'forum.vote.cast',
        destination_id: 'mod:openagents.mods.workspace.forum',
        payload: {
          action: 'cast',
          target_type: type,
          target_id: targetId,
          vote_type: voteType
        }
      });

      if (response.success) {
        // 刷新数据
        if (type === 'topic') {
          await get().loadTopics();
          // 如果是当前选中的topic，也刷新详情
          const { selectedTopic } = get();
          if (selectedTopic && selectedTopic.topic_id === targetId) {
            await get().loadTopicDetail(targetId);
          }
        } else {
          // 刷新评论
          const { selectedTopic } = get();
          if (selectedTopic) {
            await get().loadTopicDetail(selectedTopic.topic_id);
          }
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to vote:', error);
      return false;
    }
  },

  getPopularTopics: () => {
    const { topics } = get();
    return [...topics]
      .sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes))
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
      commentsError: null
    });
  },

  // Real-time updates - 增量添加新topic到列表顶部
  addTopicToList: (newTopic: ForumTopic) => {
    set((state) => {
      // 检查topic是否已经存在，避免重复添加
      const exists = state.topics.some(topic => topic.topic_id === newTopic.topic_id);
      if (exists) {
        console.log('ForumStore: Topic already exists in list, skipping:', newTopic.topic_id);
        return state;
      }

      console.log('ForumStore: Adding new topic to list:', newTopic.title);
      return {
        ...state,
        topics: [newTopic, ...state.topics]
      };
    });
  },

  // Event handling - 设置事件监听
  setupEventListeners: () => {
    const { connection } = get();
    if (!connection) return;

    console.log('ForumStore: Setting up forum event listeners');

    // 监听forum相关事件
    connection.on('rawEvent', (event: any) => {
      // 处理topic创建事件
      if (event.event_name === 'forum.topic.created' && event.payload?.topic) {
        console.log('ForumStore: Received forum.topic.created event:', event);
        const topic = event.payload.topic;

        // 将后端数据转换为ForumTopic格式
        const forumTopic: ForumTopic = {
          topic_id: topic.topic_id,
          title: topic.title,
          content: topic.content || '',
          owner_id: topic.owner_id,
          timestamp: topic.timestamp,
          upvotes: topic.upvotes || 0,
          downvotes: topic.downvotes || 0,
          comment_count: topic.comment_count || 0
        };

        get().addTopicToList(forumTopic);
      }

      // 处理comment发布事件
      else if (event.event_name === 'forum.comment.posted' && event.payload?.comment) {
        console.log('ForumStore: Received forum.comment.posted event:', event);
        const comment = event.payload.comment;
        const topicId = comment.topic_id;

        // 只有在当前查看的topic是这个comment所属的topic时才更新
        const { selectedTopic } = get();
        if (selectedTopic && selectedTopic.topic_id === topicId) {
          // 将后端数据转换为ForumComment格式
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
            replies: []
          };

          get().addCommentToTopic(topicId, forumComment);
        }
      }

      // 处理comment回复事件
      else if (event.event_name === 'forum.comment.replied' && event.payload?.comment) {
        console.log('ForumStore: Received forum.comment.replied event:', event);
        const comment = event.payload.comment;
        const topicId = comment.topic_id;

        // 只有在当前查看的topic是这个comment所属的topic时才更新
        const { selectedTopic } = get();
        if (selectedTopic && selectedTopic.topic_id === topicId) {
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
            replies: []
          };

          get().addCommentToTopic(topicId, forumComment);
        }
      }
    });
  },


  // 递归计算所有评论数量（包括嵌套的回复）
  countAllComments: (comments: ForumComment[]): number => {
    let total = 0;
    for (const comment of comments) {
      total += 1; // 当前评论
      if (comment.replies && comment.replies.length > 0) {
        total += get().countAllComments(comment.replies); // 递归计算子评论
      }
    }
    return total;
  },

  // 增量更新comment到当前topic
  addCommentToTopic: (_topicId: string, newComment: ForumComment) => {
    set((state) => {
      // 检查comment是否已存在，避免重复添加
      const exists = state.comments.some(comment => comment.comment_id === newComment.comment_id);
      if (exists) {
        console.log('ForumStore: Comment already exists, skipping:', newComment.comment_id);
        return state;
      }

      // 递归查找父评论并添加回复
      const addReplyToParent = (comments: ForumComment[], parentId: string, reply: ForumComment): boolean => {
        for (let i = 0; i < comments.length; i++) {
          const comment = comments[i];
          if (comment.comment_id === parentId) {
            // 找到父评论，将回复添加到其replies数组的开头（最新的在前）
            if (!comment.replies) {
              comment.replies = [];
            }
            comment.replies.unshift(reply);
            return true;
          }
          // 递归查找子评论
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
        // 这是一个回复，查找父评论并添加到其replies中
        const foundParent = addReplyToParent(updatedComments, newComment.parent_comment_id, newComment);
        if (!foundParent) {
          // 如果找不到父评论，将其作为一级评论处理
          console.warn('ForumStore: Parent comment not found, treating as root comment:', newComment.parent_comment_id);
          updatedComments.unshift(newComment);
        }
      } else {
        // 这是一级评论，添加到根评论列表的开头（最新的在前）
        updatedComments.unshift(newComment);
      }

      console.log('ForumStore: Added comment, parent_comment_id:', newComment.parent_comment_id);

      return {
        ...state,
        comments: updatedComments
      };
    });
  },


  // 清理事件监听
  cleanupEventListeners: () => {
    const { connection } = get();
    if (!connection) return;

    console.log('ForumStore: Cleaning up forum event listeners');
    // 这里可以添加具体的事件清理逻辑，但由于使用rawEvent
    // 我们可能需要在组件层面管理事件监听的清理
  }
}));