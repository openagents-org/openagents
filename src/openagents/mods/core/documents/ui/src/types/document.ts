// Document-related type definitions

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
  content: string[] | string;
  comments: DocumentComment[];
  agent_presence: AgentPresence[];
  version: number;
  line_authors?: { [lineNumber: number]: string };
  line_locks?: { [lineNumber: number]: string };
}

export interface DocumentsViewProps {
  onBackClick: () => void;
  // Optional props for shared state management
  documents?: DocumentInfo[];
  selectedDocumentId?: string | null;
  onDocumentSelect?: (documentId: string | null) => void;
  onDocumentsChange?: (documents: DocumentInfo[]) => void;
}

export interface ThreadState {
  currentChannel?: string | null;
  currentDirectMessage?: string | null;
  channels?: any[];
  agents?: any[];
}

