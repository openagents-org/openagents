export const FEED_CATEGORY_OPTIONS = [
  { value: "announcements", label: "Announcement" },
  { value: "updates", label: "Update" },
  { value: "info", label: "Information" },
  { value: "alerts", label: "Alert" },
] as const;

export type FeedCategory =
  (typeof FEED_CATEGORY_OPTIONS)[number]["value"];

export const FEED_SORT_FIELDS = [
  { value: "recent", label: "Most Recent" },
  { value: "oldest", label: "Oldest First" },
  { value: "title", label: "Title (A-Z)" },
  { value: "category", label: "Category" },
] as const;

export type FeedSortField =
  (typeof FEED_SORT_FIELDS)[number]["value"];

export interface FeedAttachment {
  file_id: string;
  filename: string;
  size: number;
  file_type?: string;
  url?: string;
}

export interface FeedPost {
  post_id: string;
  title: string;
  content: string;
  summary?: string;
  author_id: string;
  created_at: number;
  category?: FeedCategory;
  tags?: string[];
  attachments?: FeedAttachment[];
  allowed_groups?: string[];
  relevance_score?: number;
  metadata?: Record<string, any>;
}

export interface FeedFilters {
  category: FeedCategory | "all";
  author?: string;
  tags: string[];
  startDate?: string;
  endDate?: string;
  sortBy: FeedSortField;
  sortDirection: "asc" | "desc";
}

export interface FeedSearchPayload {
  query: string;
  tags?: string[];
  filters?: Partial<FeedFilters>;
}

export interface FeedCreatePayload {
  title: string;
  content: string;
  category?: FeedCategory;
  tags?: string[];
  attachments?: FeedAttachment[];
  allowed_groups?: string[];
  summary?: string;
}

