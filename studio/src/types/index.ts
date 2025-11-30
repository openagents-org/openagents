// Common type definitions for the application
import { NetworkConnection } from "@/types/connection";

// Export new unified message types
export type {
  UnifiedMessage,
  RawThreadMessage,
  LegacyMessage
} from "./message";

export {
  MessageAdapter,
  MessageUtils,
} from "./message";

export type {
  FeedPost,
  FeedAttachment,
  FeedFilters,
  FeedCreatePayload,
  FeedSearchPayload,
} from "./feed";

export {
  FEED_CATEGORY_OPTIONS,
  FEED_SORT_FIELDS,
} from "./feed";

// Note: This interface is retained for tool-related message handling, new messages should use UnifiedMessage from types/message.ts
// @deprecated For regular messages, please use UnifiedMessage from types/message.ts
export interface Message {
  id: string;
  sender: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
  // Optional metadata for tools
  toolData?: {
    type: "tool_start" | "tool_execution" | "tool_result" | "tool_error";
    name: string;
    id: string;
    input?: any;
    result?: any;
    error?: string;
  };
  // Add tool metadata to support persistence
  toolMetadata?: {
    sections: ToolSection[];
  };
  // File attachment fields
  attachment_file_id?: string;
  attachment_filename?: string;
  attachment_size?: number | string;
  attachments?: Array<{
    file_id: string;
    filename: string;
    size: number;
    file_type?: string;
  }>;
}

// Conversation types removed - not needed for chat module

export interface ChatViewProps {
  // ChatView props - simplified without conversation
}

export interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  onSettingsClick: () => void;
  onProfileClick: () => void;
}

export interface SettingsViewProps {
  onBackClick: () => void;
}

// Tool section interface for the sliding panel
export interface ToolSection {
  id: string;
  type: "tool_start" | "tool_execution" | "tool_result" | "tool_error";
  name: string;
  content: string;
  input?: any;
  result?: any;
  error?: string;
  isCollapsed: boolean;
}

// Map of message id to tool sections
export interface ToolSectionsMap {
  [messageId: string]: ToolSection[];
}

export interface MessageListProps {
  messages: Message[];
  streamingMessageId?: string | null;
  toolSections?: ToolSectionsMap;
  forceRender?: number;
  isAutoScrollingDisabled?: boolean;
}

// Shared Document Types
export interface DocumentInfo {
  document_id: string;
  name: string;
  creator: string;
  created: string;
  last_modified: string;
  active_agents: string[];
}

export interface DocumentComment {
  comment_id: string;
  line_number: number;
  agent_id: string;
  comment_text: string;
  timestamp: string;
}

export interface AgentPresence {
  agent_id: string;
  cursor_position?: {
    line_number: number;
    column_number: number;
  };
  last_activity: string;
  is_active: boolean;
}

export interface DocumentContent {
  document_id: string;
  content: string[];
  comments: DocumentComment[];
  agent_presence: AgentPresence[];
  version: number;
}

export interface DocumentsViewProps {
  onBackClick: () => void;
  // Optional props for shared state management
  documents?: DocumentInfo[];
  selectedDocumentId?: string | null;
  onDocumentSelect?: (documentId: string | null) => void;
  onDocumentsChange?: (documents: DocumentInfo[]) => void;
}
