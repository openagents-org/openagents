import { create } from "zustand";
import { eventRouter } from "@/services/eventRouter";
import type { HttpEventConnector } from "@/services/eventConnector";
import {
  FeedAttachment,
  FeedCreatePayload,
  FeedFilters,
  FeedPost,
} from "@/types/feed";

const FEED_DESTINATION_ID = "mod:openagents.mods.workspace.feed";

const INITIAL_FILTERS: FeedFilters = {
  tags: [],
  sortBy: "recent",
  sortDirection: "desc",
};

const normalizePost = (raw: any): FeedPost => ({
  post_id: raw.post_id || raw.id,
  title: raw.title,
  content: raw.content || "",
  author_id: raw.author_id || raw.owner_id || raw.created_by || "unknown",
  created_at: raw.created_at || raw.timestamp || Date.now(),
  tags: raw.tags || [],
  attachments: raw.attachments || [],
  allowed_groups: raw.allowed_groups,
  relevance_score: raw.relevance_score ?? raw.score,
  metadata: raw.metadata,
});

const matchesFilters = (post: FeedPost, filters: FeedFilters): boolean => {
  if (filters.author && !post.author_id?.includes(filters.author.trim())) {
    return false;
  }
  if (filters.tags.length > 0) {
    const tagSet = new Set((post.tags || []).map((tag) => tag.toLowerCase()));
    const allMatch = filters.tags.every((tag) => tagSet.has(tag.toLowerCase()));
    if (!allMatch) {
      return false;
    }
  }
  if (filters.startDate) {
    const start = new Date(filters.startDate).getTime();
    if (post.created_at < start) return false;
  }
  if (filters.endDate) {
    const end = new Date(filters.endDate).getTime();
    if (post.created_at > end) return false;
  }
  return true;
};

interface FeedState {
  connection: HttpEventConnector | null;
  agentId: string | null;

  posts: FeedPost[];
  totalPosts: number;
  page: number;
  pageSize: number;
  postsLoading: boolean;
  postsError: string | null;

  filters: FeedFilters;

  searchQuery: string;
  searchTags: string[];
  searchResults: FeedPost[] | null;
  searchLoading: boolean;
  searchError: string | null;

  recentPosts: FeedPost[];
  recentLoading: boolean;
  lastCheckedAt: number | null;

  incomingPosts: FeedPost[];
  newPostCount: number;

  selectedPost: FeedPost | null;
  selectedPostLoading: boolean;
  selectedPostError: string | null;

  createStatus: "idle" | "loading" | "success" | "error";
  createError: string | null;

  eventHandler?: (event: any) => void | null;

  setConnection: (connection: HttpEventConnector | null) => void;
  setAgentId: (id: string) => void;

  loadPosts: () => Promise<void>;
  refreshPosts: () => Promise<void>;
  setPage: (page: number) => Promise<void>;
  setPageSize: (size: number) => Promise<void>;
  applyFilters: (next: Partial<FeedFilters>) => Promise<void>;

  setSearchQuery: (value: string) => void;
  setSearchTags: (tags: string[]) => void;
  searchPosts: (query?: string, tags?: string[]) => Promise<void>;
  clearSearch: () => void;

  fetchRecentPosts: () => Promise<void>;
  markPostsChecked: () => void;
  consumeIncomingPosts: () => void;

  fetchPostById: (postId: string) => Promise<void>;
  resetSelectedPost: () => void;

  createPost: (payload: FeedCreatePayload) => Promise<boolean>;
  attachUpload: (file: FeedAttachment) => void;

  addIncomingPost: (post: FeedPost) => void;

  setupEventListeners: () => void;
  cleanupEventListeners: () => void;
}

const buildFilterPayload = (filters: FeedFilters) => {
  const payload: Record<string, any> = {};
  if (filters.author) {
    payload.author = filters.author.trim();
  }
  if (filters.tags.length > 0) {
    payload.tags = filters.tags;
  }
  if (filters.startDate) {
    payload.start_date = filters.startDate;
  }
  if (filters.endDate) {
    payload.end_date = filters.endDate;
  }
  return payload;
};


export const useFeedStore = create<FeedState>((set, get) => ({
  connection: null,
  agentId: null,

  posts: [],
  totalPosts: 0,
  page: 1,
  pageSize: 20,
  postsLoading: false,
  postsError: null,

  filters: INITIAL_FILTERS,

  searchQuery: "",
  searchTags: [],
  searchResults: null,
  searchLoading: false,
  searchError: null,

  recentPosts: [],
  recentLoading: false,
  lastCheckedAt: null,

  incomingPosts: [],
  newPostCount: 0,

  selectedPost: null,
  selectedPostLoading: false,
  selectedPostError: null,

  createStatus: "idle",
  createError: null,

  eventHandler: null,

  setConnection: (connection) => set({ connection }),
  setAgentId: (id) => set({ agentId: id }),

  loadPosts: async () => {
    const { connection, page, pageSize, filters } = get();
    if (!connection) {
      set({ postsError: "No connection available" });
      return;
    }
    set({ postsLoading: true, postsError: null });
    try {
      // For title sorting, we need to get all matching posts and sort on client side
      // For recent and oldest, we can use backend sorting
      const needsClientSort = filters.sortBy === "title";
      
      // Convert page to offset: offset = (page - 1) * pageSize
      // If client sort is needed, get all matching posts first (use a large limit)
      // Note: For very large datasets (>5000 posts), client-side sorting may be incomplete
      const offset = needsClientSort ? 0 : (page - 1) * pageSize;
      const limit = needsClientSort ? 5000 : pageSize; // Get more posts for client-side sorting
      
      // Convert sort to sort_by string expected by backend
      // Backend only supports "recent" and "oldest", so use "recent" as default for client-side sorting
      let sort_by = "recent";
      if (filters.sortBy === "oldest") {
        // For oldest, check sortDirection: if desc, use recent instead
        sort_by = filters.sortDirection === "desc" ? "recent" : "oldest";
      } else if (filters.sortBy === "recent") {
        // For recent, check sortDirection: if asc, use oldest instead
        sort_by = filters.sortDirection === "asc" ? "oldest" : "recent";
      }
      // For title, backend doesn't support, so we'll sort on client side
      // Use "recent" as default backend sort, then override on client

      // Build filter payload and merge into main payload
      const filterPayload = buildFilterPayload(filters);

      // Build the payload in the format expected by backend
      const payload: Record<string, any> = {
        limit: limit,
        offset: offset,
        sort_by: sort_by,
      };

      // Merge filter fields into payload
      if (filterPayload.author) {
        payload.author_id = filterPayload.author;
      }
      if (filterPayload.tags && filterPayload.tags.length > 0) {
        payload.tags = filterPayload.tags;
      }
      if (filterPayload.start_date) {
        // Convert start_date (YYYY-MM-DD) to since_date (Unix timestamp in seconds)
        // Set to start of day (00:00:00) in local timezone
        const date = new Date(filterPayload.start_date);
        // Ensure we get the start of the day
        date.setHours(0, 0, 0, 0);
        const sinceDate = Math.floor(date.getTime() / 1000);
        payload.since_date = sinceDate;
      }
      
      const response = await connection.sendEvent({
        event_name: "feed.posts.list",
        destination_id: FEED_DESTINATION_ID,
        payload,
      });
      if (response.success) {
        let posts = (response.data?.posts || []).map(normalizePost);
        
        // Filter by endDate on client side (backend doesn't support until_date)
        if (filterPayload.end_date) {
          // Convert end_date (YYYY-MM-DD) to end of day timestamp
          const endDate = new Date(filterPayload.end_date);
          endDate.setHours(23, 59, 59, 999);
          const endTimestamp = endDate.getTime() / 1000; // Convert to seconds
          
          // Filter posts created before or at end date
          posts = posts.filter((post) => post.created_at <= endTimestamp);
        }
        
        // Apply client-side sorting for title
        if (needsClientSort) {
          const sortField = filters.sortBy;
          const sortDir = filters.sortDirection === "asc" ? 1 : -1;

          posts.sort((a, b) => {
            let aVal: any;
            let bVal: any;

            if (sortField === "title") {
              aVal = (a.title || "").toLowerCase();
              bVal = (b.title || "").toLowerCase();
            } else {
              return 0;
            }

            if (aVal < bVal) return -1 * sortDir;
            if (aVal > bVal) return 1 * sortDir;
            return 0;
          });
          
          // Apply pagination after client-side sorting
          const totalCount = posts.length;
          const paginatedPosts = posts.slice((page - 1) * pageSize, page * pageSize);
          
          set({
            posts: paginatedPosts,
            totalPosts: totalCount,
            postsLoading: false,
            postsError: null,
          });
        } else {
          // Use backend sorting and pagination
          set({
            posts,
            totalPosts: response.data?.total_count || response.data?.total || response.data?.total_posts || posts.length,
            postsLoading: false,
            postsError: null,
          });
        }
      } else {
        set({
          posts: [],
          totalPosts: 0,
          postsLoading: false,
          postsError: response.message || "Failed to load feed",
        });
      }
    } catch (error) {
      console.error("FeedStore: failed to load posts", error);
      set({
        postsLoading: false,
        postsError: "Failed to load feed posts",
      });
    }
  },

  refreshPosts: async () => {
    await get().loadPosts();
  },

  setPage: async (page) => {
    set({ page });
    await get().loadPosts();
  },

  setPageSize: async (size) => {
    set({ pageSize: size, page: 1 });
    await get().loadPosts();
  },

  applyFilters: async (next) => {
    set((state) => ({
      filters: {
        ...state.filters,
        ...next,
      },
      page: 1,
    }));
    await get().loadPosts();
  },

  setSearchQuery: (value) => set({ searchQuery: value }),
  setSearchTags: (tags) => set({ searchTags: tags }),

  searchPosts: async (query, tags) => {
    const { connection, filters, searchQuery, searchTags } = get();
    if (!connection) return;
    const finalQuery = query ?? searchQuery;
    const finalTags = tags ?? searchTags;
    if (!finalQuery && finalTags.length === 0) {
      return;
    }
    set({ searchLoading: true, searchError: null });
    try {
      const response = await connection.sendEvent({
        event_name: "feed.posts.search",
        destination_id: FEED_DESTINATION_ID,
        payload: {
          query: finalQuery,
          tags: finalTags.length > 0 ? finalTags : undefined,
          filters: buildFilterPayload(filters),
          limit: 50,
        },
      });
      if (response.success) {
        const posts = (response.data?.posts || response.data?.results || []).map(
          normalizePost
        );
        set({
          searchResults: posts,
          searchLoading: false,
          searchError: null,
        });
      } else {
        set({
          searchResults: null,
          searchLoading: false,
          searchError: response.message || "Search failed",
        });
      }
    } catch (error) {
      console.error("FeedStore: failed to search posts", error);
      set({
        searchLoading: false,
        searchError: "Search failed due to network error",
      });
    }
  },

  clearSearch: () =>
    set({
      searchResults: null,
      searchQuery: "",
      searchTags: [],
      searchLoading: false,
      searchError: null,
    }),

  fetchRecentPosts: async () => {
    const { connection, lastCheckedAt } = get();
    if (!connection) return;
    const since = lastCheckedAt || Date.now() - 1000 * 60 * 60 * 24;
    set({ recentLoading: true });
    try {
      const response = await connection.sendEvent({
        event_name: "feed.posts.recent",
        destination_id: FEED_DESTINATION_ID,
        payload: {
          since_timestamp: since,
        },
      });
      if (response.success) {
        const posts = (response.data?.posts || []).map(normalizePost);
        set({
          recentPosts: posts,
          recentLoading: false,
          newPostCount: posts.length,
          lastCheckedAt: Date.now(),
        });
      } else {
        set({
          recentLoading: false,
        });
      }
    } catch (error) {
      console.error("FeedStore: failed to fetch recent posts", error);
      set({ recentLoading: false });
    }
  },

  markPostsChecked: () =>
    set({
      lastCheckedAt: Date.now(),
      recentPosts: [],
      incomingPosts: [],
      newPostCount: 0,
    }),

  consumeIncomingPosts: () =>
    set((state) => {
      if (state.incomingPosts.length === 0) {
        return {
          newPostCount: 0,
        } as Partial<FeedState>;
      }
      const merged = [...state.incomingPosts, ...state.posts];
      const unique: FeedPost[] = [];
      const seen = new Set<string>();
      for (const post of merged) {
        if (!seen.has(post.post_id)) {
          unique.push(post);
          seen.add(post.post_id);
        }
      }
      return {
        posts: unique,
        incomingPosts: [],
        newPostCount: 0,
      };
    }),

  fetchPostById: async (postId) => {
    const { connection, posts } = get();
    if (!connection) return;
    const cached = posts.find((post) => post.post_id === postId);
    if (cached) {
      set({ selectedPost: cached, selectedPostError: null });
      return;
    }
    set({ selectedPostLoading: true, selectedPostError: null });
    try {
      const response = await connection.sendEvent({
        event_name: "feed.post.get",
        destination_id: FEED_DESTINATION_ID,
        payload: { post_id: postId },
      });
      if (response.success && response.data) {
        const post = normalizePost(response.data.post || response.data);
        set({
          selectedPost: post,
          selectedPostLoading: false,
        });
      } else {
        set({
          selectedPost: null,
          selectedPostLoading: false,
          selectedPostError: response.message || "Post not found",
        });
      }
    } catch (error) {
      console.error("FeedStore: failed to fetch post detail", error);
      set({
        selectedPostLoading: false,
        selectedPostError: "Failed to load post detail",
      });
    }
  },

  resetSelectedPost: () =>
    set({
      selectedPost: null,
      selectedPostError: null,
    }),

  createPost: async (payload) => {
    const { connection } = get();
    if (!connection) return false;
    if (!payload.title || !payload.content) {
      set({
        createStatus: "error",
        createError: "Title and content are required",
      });
      return false;
    }
    set({
      createStatus: "loading",
      createError: null,
    });
    try {
      const response = await connection.sendEvent({
        event_name: "feed.post.create",
        destination_id: FEED_DESTINATION_ID,
        payload: {
          title: payload.title.trim(),
          content: payload.content.trim(),
          tags: payload.tags && payload.tags.length > 0 ? payload.tags : undefined,
          attachments:
            payload.attachments && payload.attachments.length > 0
              ? payload.attachments
              : undefined,
          allowed_groups:
            payload.allowed_groups && payload.allowed_groups.length > 0
              ? payload.allowed_groups
              : undefined,
        },
      });
      if (response.success) {
        const post = response.data?.post
          ? normalizePost(response.data.post)
          : null;
        if (post) {
          get().addIncomingPost(post);
        }
        set({
          createStatus: "success",
          createError: null,
        });
        // Refresh the posts list after successful creation
        await get().loadPosts();
        return true;
      }
      set({
        createStatus: "error",
        createError: response.message || "Failed to create post",
      });
      return false;
    } catch (error) {
      console.error("FeedStore: failed to create post", error);
      set({
        createStatus: "error",
        createError: "Failed to create post",
      });
      return false;
    }
  },

  attachUpload: (_file) => {
    // reserved for future inline attachment state if needed
  },

  addIncomingPost: (post) =>
    set((state) => {
      const alreadyExists = state.posts.some((item) => item.post_id === post.post_id);
      const shouldInsertNow = matchesFilters(post, state.filters);
      let updatedPosts = state.posts;
      if (shouldInsertNow && !alreadyExists) {
        updatedPosts = [post, ...state.posts];
      }
      const incoming = [post, ...state.incomingPosts.filter((p) => p.post_id !== post.post_id)];
      return {
        posts: updatedPosts,
        incomingPosts: incoming,
        newPostCount: incoming.length,
      };
    }),

  setupEventListeners: () => {
    const handler = (event: any) => {
      if (event.event_name === "feed.notification.post_created" && event.payload?.post) {
        const post = normalizePost(event.payload.post);
        get().addIncomingPost(post);
      } else if (
        event.event_name === "feed.posts.list" &&
        event.payload?.posts &&
        Array.isArray(event.payload.posts)
      ) {
        const posts = event.payload.posts.map(normalizePost);
        set({ posts, totalPosts: posts.length });
      }
    };
    eventRouter.onFeedEvent(handler);
    set({ eventHandler: handler });
  },

  cleanupEventListeners: () => {
    const handler = get().eventHandler;
    if (handler) {
      eventRouter.offFeedEvent(handler);
      set({ eventHandler: null });
    }
  },
}));

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).useFeedStore = useFeedStore;
}

