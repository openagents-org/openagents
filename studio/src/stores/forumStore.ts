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

  // Computed
  getPopularTopics: () => ForumTopic[];

  // Reset
  resetSelectedTopic: () => void;
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
        // 如果API失败，创建一些测试数据用于开发
        console.warn('ForumStore: API failed, using test data for development. Response:', response);
        const testTopics: ForumTopic[] = [
          {
            topic_id: 'test_topic_1',
            title: 'Welcome to the New Forum!',
            content: 'This is our first topic with the new voting system. Feel free to explore and give feedback!',
            owner_id: 'admin',
            timestamp: Date.now() / 1000 - 7200,
            upvotes: 15,
            downvotes: 3,
            comment_count: 8
          },
          {
            topic_id: 'test_topic_2',
            title: 'Feature Request: Dark Mode Improvements',
            content: 'Let\'s discuss potential improvements to our dark mode theme...',
            owner_id: 'user123',
            timestamp: Date.now() / 1000 - 14400,
            upvotes: 8,
            downvotes: 2,
            comment_count: 3
          },
          {
            topic_id: 'test_topic_3',
            title: 'Bug Report: Star Button Animation',
            content: 'I noticed the star button animation could be smoother...',
            owner_id: 'tester',
            timestamp: Date.now() / 1000 - 21600,
            upvotes: 3,
            downvotes: 1,
            comment_count: 1
          }
        ];

        console.log('ForumStore: Created test topics with IDs:', testTopics.map(t => t.topic_id));
        set({
          topics: testTopics,
          topicsLoading: false
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
      // 立即使用已存在的topic数据，并创建一些测试评论
      const testComments: ForumComment[] = [
        {
          comment_id: `comment_${topicId}_1`,
          topic_id: topicId,
          content: 'Great topic! Looking forward to seeing this forum grow.',
          author_id: 'alice',
          timestamp: Date.now() / 1000 - 3600,
          upvotes: 4,
          downvotes: 1,
          thread_level: 0,
          replies: [
            {
              comment_id: `comment_${topicId}_2`,
              topic_id: topicId,
              content: 'I agree! The new voting system is much better.',
              author_id: 'bob',
              timestamp: Date.now() / 1000 - 1800,
              upvotes: 2,
              downvotes: 0,
              thread_level: 1,
              parent_comment_id: `comment_${topicId}_1`
            }
          ]
        }
      ];

      set({
        selectedTopic: existingTopic,
        comments: testComments,
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
            set({ comments: response.data.comments });
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
        const topic = response.data.topic;
        if (topic) {
          set({
            selectedTopic: topic,
            comments: response.data.comments || [],
            commentsLoading: false
          });
          return;
        }
      }

      // API调用失败，创建fallback数据
      console.warn('ForumStore: API failed, creating fallback test data. Response:', response);
      const testTopic: ForumTopic = {
        topic_id: topicId,
        title: `Topic ${topicId}`,
        content: '# Welcome to our Forum!\n\nThis is a test topic for development purposes. You can:\n\n- Vote on this topic\n- Add comments\n- Reply to comments\n\nLet\'s build something amazing together! 🚀',
        owner_id: 'test_user',
        timestamp: Date.now() / 1000,
        upvotes: 6,
        downvotes: 1,
        comment_count: 2
      };

      const testComments: ForumComment[] = [
        {
          comment_id: `comment_${topicId}_1`,
          topic_id: topicId,
          content: 'Great topic! Looking forward to seeing this forum grow.',
          author_id: 'alice',
          timestamp: Date.now() / 1000 - 3600,
          upvotes: 4,
          downvotes: 1,
          thread_level: 0,
          replies: [
            {
              comment_id: `comment_${topicId}_2`,
              topic_id: topicId,
              content: 'I agree! The new voting system is much better.',
              author_id: 'bob',
              timestamp: Date.now() / 1000 - 1800,
              upvotes: 2,
              downvotes: 0,
              thread_level: 1,
              parent_comment_id: `comment_${topicId}_1`
            }
          ]
        }
      ];

      set({
        selectedTopic: testTopic,
        comments: testComments,
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
        // 刷新话题列表
        await get().loadTopics();
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

      if (response.success) {
        // 刷新评论列表
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

  resetSelectedTopic: () => {
    set({
      selectedTopic: null,
      comments: [],
      commentsError: null
    });
  }
}));