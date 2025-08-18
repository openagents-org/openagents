// Common type definitions for the application
import { NetworkConnection } from '../services/networkService';

export interface Message {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  // Optional metadata for tools
  toolData?: {
    type: 'tool_start' | 'tool_execution' | 'tool_result' | 'tool_error';
    name: string;
    id: string;
    input?: any;
    result?: any;
    error?: string;
  };
  // 添加工具元数据以支持持久化
  toolMetadata?: {
    sections: ToolSection[];
  };
}

export interface Conversation {
  id: string;
  title: string;
  isActive: boolean;
}

export interface ConversationMessages {
  [key: string]: Message[];
}

export interface ChatViewProps {
  conversationId: string;
  onMessagesUpdate?: (messages: ConversationMessages) => void;
  onDeleteConversation?: () => void;
  currentTheme: 'light' | 'dark';
}

export interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  onSettingsClick: () => void;
  onProfileClick: () => void;
  onMcpClick: () => void;
  activeView: 'chat' | 'settings' | 'profile' | 'mcp';
  onConversationChange: (conversationId: string) => void;
  activeConversationId: string;
  conversations: Conversation[];
  createNewConversation: () => void;
  toggleTheme: () => void;
  currentTheme: 'light' | 'dark';
  currentNetwork: NetworkConnection | null;
}

export interface SettingsViewProps {
  onBackClick: () => void;
}

// Tool section interface for the sliding panel
export interface ToolSection {
  id: string;
  type: 'tool_start' | 'tool_execution' | 'tool_result' | 'tool_error';
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