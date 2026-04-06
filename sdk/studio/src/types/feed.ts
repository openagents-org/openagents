export const FEED_SORT_FIELDS = [
  { value: "recent", label: "Most Recent" },
  { value: "oldest", label: "Oldest First" },
  { value: "title", label: "Title (A-Z)" },
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
  author_id: string;
  created_at: number;
  tags?: string[];
  attachments?: FeedAttachment[];
  allowed_groups?: string[];
  relevance_score?: number;
  metadata?: Record<string, any>;
}

export interface FeedFilters {
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
  tags?: string[];
  attachments?: FeedAttachment[];
  allowed_groups?: string[];
}

