/**
 * Unified message type definitions and data adapters
 * Solves the inconsistent format issue between direct message and channel message returned from backend
 */

// Unified message type - for internal frontend use
export interface UnifiedMessage {
  // Basic information
  id: string;
  senderId: string;
  timestamp: string;
  content: string;

  // Message type
  type: 'direct_message' | 'channel_message' | 'reply_message';

  // Channel information (channel messages only)
  channel?: string;

  // DM target (direct messages only)
  targetUserId?: string;

  // Reply information
  replyToId?: string;
  threadLevel?: number;

  // Quote information
  quotedMessageId?: string;
  quotedText?: string;

  // Reactions
  reactions?: {
    [reactionType: string]: number;
  };

  // Attachments
  attachments?: Array<{
    fileId: string;
    filename: string;
    size: number;
    fileType?: string;
    storageType?: 'cache';
  }>;

  // Thread information
  threadInfo?: {
    isRoot: boolean;
    threadLevel?: number;
    childrenCount?: number;
  };
}

// Original backend message format (from events.ts ThreadMessage)
export interface RawThreadMessage {
  message_id?: string;
  sender_id?: string;
  event_id?: string;
  source_id?: string;
  timestamp: string;
  content: {
    text: string;
    files?: Array<{
      file_id: string;
      filename: string;
      size: number;
      file_type?: string;
      storage_type?: 'cache';
    }>;
  } | string | any; // Support multiple content formats
  message_type: 'direct_message' | 'channel_message' | 'reply_message';
  channel?: string;
  target_agent_id?: string;
  reply_to_id?: string;
  thread_level?: number;
  quoted_message_id?: string;
  quoted_text?: string;
  thread_info?: {
    is_root: boolean;
    thread_level?: number;
    children_count?: number;
  };
  payload?: any;
  reactions?: {
    [reaction_type: string]: number;
  };
}

/**
 * Data adapters - convert backend data to unified format
 */
export class MessageAdapter {
  /**
   * Convert RawThreadMessage to UnifiedMessage
   */
  static fromRawThreadMessage(raw: RawThreadMessage): UnifiedMessage {
    // Extract files from content.files
    const attachments: UnifiedMessage['attachments'] =
      raw.content && typeof raw.content === 'object' && raw.content.files
        ? raw.content.files.map((f: any) => ({
            fileId: f.file_id,
            filename: f.filename,
            size: f.size,
            fileType: f.file_type,
            storageType: f.storage_type,
          }))
        : undefined;

    const isDirectMessage = raw?.payload?.message_type === 'direct_message';

    // Handle different content formats
    let content = '';
    if (raw.content) {
      if (typeof raw.content === 'string') {
        // content is a string
        content = raw.content;
      } else if (typeof raw.content === 'object' && raw.content.text !== undefined) {
        // content is an object with text field (even if text is empty string it's valid)
        content = raw.content.text;
      } else if (typeof raw.content === 'object') {
        // content is an object but without text field, try other fields or convert
        console.warn('MessageAdapter: Content object missing text field:', raw.content);
        content = raw.content.message || raw.content.value || String(raw.content);
      } else {
        // Other cases, try to convert to string
        console.warn('MessageAdapter: Unexpected content format:', raw.content);
        content = String(raw.content);
      }
    }

    return {
      id: (isDirectMessage ? raw.event_id : raw.message_id) || '',
      senderId: (isDirectMessage ? raw.source_id : raw.sender_id) || '',
      timestamp: raw.timestamp, // 10 digits vs 13 digits,
      content: isDirectMessage ? raw.payload.content.text : content,
      type: isDirectMessage ? raw.payload.message_type : raw.message_type,
      channel: isDirectMessage ? '' : raw.channel,
      targetUserId: isDirectMessage ? raw.payload.target_agent_id : raw.target_agent_id,
      replyToId: isDirectMessage ? '' : raw.reply_to_id,
      threadLevel: isDirectMessage ? 1 : raw.thread_level,
      quotedMessageId: raw.quoted_message_id,
      quotedText: raw.quoted_text,
      reactions: raw.reactions,
      attachments,
      threadInfo: raw.thread_info ? {
        isRoot: raw.thread_info.is_root,
        threadLevel: raw.thread_info.thread_level,
        childrenCount: raw.thread_info.children_count,
      } : undefined,
    };
  }

  /**
   * Convert UnifiedMessage to format for backend
   */
  static toRawThreadMessage(unified: UnifiedMessage): Partial<RawThreadMessage> {
    // Build content object with text and optional files
    const content: any = { text: unified.content };
    if (unified.attachments && unified.attachments.length > 0) {
      content.files = unified.attachments.map(att => ({
        file_id: att.fileId,
        filename: att.filename,
        size: att.size,
        file_type: att.fileType,
        storage_type: att.storageType,
      }));
    }

    const raw: Partial<RawThreadMessage> = {
      message_id: unified.id,
      sender_id: unified.senderId,
      timestamp: unified.timestamp,
      content,
      message_type: unified.type,
      channel: unified.channel,
      target_agent_id: unified.targetUserId,
      reply_to_id: unified.replyToId,
      thread_level: unified.threadLevel,
      quoted_message_id: unified.quotedMessageId,
      quoted_text: unified.quotedText,
      reactions: unified.reactions,
    };

    // Handle thread info
    if (unified.threadInfo) {
      raw.thread_info = {
        is_root: unified.threadInfo.isRoot,
        thread_level: unified.threadInfo.threadLevel,
        children_count: unified.threadInfo.childrenCount,
      };
    }

    return raw;
  }

  /**
   * Batch convert message array
   */
  static fromRawThreadMessages(rawMessages: RawThreadMessage[]): UnifiedMessage[] {
    return rawMessages.map(raw => this.fromRawThreadMessage(raw));
  }
}

/**
 * Message utility functions
 */
export class MessageUtils {
  /**
   * Format username display
   */
  static formatUsername(senderId: string, currentUserId: string): string {
    if (senderId === currentUserId) {
      return "You";
    }

    if (!senderId || typeof senderId !== 'string') {
      return 'Unknown';
    }

    // If contains @, take the part before @
    if (senderId.includes("@")) {
      const namePart = senderId.split("@")[0];
      if (namePart.includes("_")) {
        return namePart
          .split("_")
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
      }
      return namePart;
    }

    // If contains underscore, format for display
    if (senderId.includes("_")) {
      return senderId
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }

    // Otherwise just capitalize first letter
    return senderId.charAt(0).toUpperCase() + senderId.slice(1);
  }

  /**
   * Parse timestamp
   */
  static parseTimestamp(timestamp: string | number): number {
    if (!timestamp) return 0;

    const timestampStr = String(timestamp);

    // Handle ISO string format
    if (timestampStr.includes("T") || timestampStr.includes("-")) {
      const time = new Date(timestampStr).getTime();
      return isNaN(time) ? 0 : time;
    }

    // Handle Unix timestamp
    const num = parseInt(timestampStr);
    if (isNaN(num)) return 0;

    // If it's a seconds-level timestamp, convert to milliseconds
    if (num < 10000000000) {
      return num * 1000;
    } else {
      return num;
    }
  }

  /**
   * Sort messages by timestamp
   */
  static sortMessagesByTimestamp(messages: UnifiedMessage[]): UnifiedMessage[] {
    return [...messages].sort((a, b) => {
      const aTime = this.parseTimestamp(a.timestamp);
      const bTime = this.parseTimestamp(b.timestamp);
      return aTime - bTime;
    });
  }

  /**
   * Filter channel messages
   */
  static filterChannelMessages(messages: UnifiedMessage[], channel: string): UnifiedMessage[] {
    return messages.filter(message =>
      (message.type === 'channel_message' || message.type === 'reply_message') &&
      message.channel === channel
    );
  }

  /**
   * Filter direct messages
   */
  static filterDirectMessages(
    messages: UnifiedMessage[],
    targetUserId: string,
    currentUserId: string
  ): UnifiedMessage[] {
    return messages.filter(message =>
      message.type === 'direct_message' &&
      (message.targetUserId === targetUserId ||
       message.senderId === targetUserId ||
       (message.senderId === currentUserId && message.targetUserId === targetUserId))
    );
  }

  /**
   * Build thread structure
   */
  static buildThreadStructure(messages: UnifiedMessage[]): {
    structure: { [messageId: string]: { message: UnifiedMessage; children: string[]; level: number } };
    rootMessageIds: string[];
  } {
    const structure: { [messageId: string]: { message: UnifiedMessage; children: string[]; level: number } } = {};
    const rootMessages: string[] = [];

    // First pass: organize messages and identify root messages
    messages.forEach((message) => {
      structure[message.id] = {
        message,
        children: [],
        level: message.threadLevel || 0,
      };

      // Only messages with reply_to_id are considered replies
      if (!message.replyToId) {
        rootMessages.push(message.id);
      }
    });

    // Track orphaned replies
    const orphanedReplies: string[] = [];

    // Second pass: establish parent-child relationships
    messages.forEach((message) => {
      if (message.replyToId) {
        if (structure[message.replyToId]) {
          structure[message.replyToId].children.push(message.id);
        } else {
          // Parent message doesn't exist - treat as orphaned reply
          orphanedReplies.push(message.id);
        }
      }
    });

    // Display orphaned replies as root messages
    rootMessages.push(...orphanedReplies);

    return { structure, rootMessageIds: rootMessages };
  }
}