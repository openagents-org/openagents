export interface UnifiedMessage {
  id: string;
  senderId: string;
  timestamp: string;
  content: string;
  type: "direct_message" | "channel_message" | "reply_message";
  channel?: string;
  targetUserId?: string;
  replyToId?: string;
  threadLevel?: number;
  quotedMessageId?: string;
  quotedText?: string;
  reactions?: {
    [reactionType: string]: number;
  };
  attachments?: Array<{
    fileId: string;
    filename: string;
    size: number;
    fileType?: string;
  }>;
  threadInfo?: {
    isRoot: boolean;
    threadLevel?: number;
    childrenCount?: number;
  };
}

export interface RawThreadMessage {
  message_id?: string;
  sender_id?: string;
  event_id?: string;
  source_id?: string;
  timestamp: string;
  content: {
    text: string;
  } | string | any;
  message_type: "direct_message" | "channel_message" | "reply_message";
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

export interface LegacyMessage {
  id: string;
  sender: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
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

export class MessageAdapter {
  static fromRawThreadMessage(raw: RawThreadMessage): UnifiedMessage {
    const attachments: UnifiedMessage["attachments"] = [];

    if (raw.attachment_file_id && raw.attachment_filename) {
      attachments.push({
        fileId: raw.attachment_file_id,
        filename: raw.attachment_filename,
        size:
          typeof raw.attachment_size === "string"
            ? parseInt(raw.attachment_size) || 0
            : raw.attachment_size || 0,
      });
    }

    if (raw.attachments) {
      attachments.push(
        ...raw.attachments.map((att) => ({
          fileId: att.file_id,
          filename: att.filename,
          size: att.size,
          fileType: att.file_type,
        }))
      );
    }

    const isDirectMessage = raw?.payload?.message_type === "direct_message";

    let content = "";
    if (raw.content) {
      if (typeof raw.content === "string") {
        content = raw.content;
      } else if (
        typeof raw.content === "object" &&
        raw.content.text !== undefined
      ) {
        content = raw.content.text;
      } else if (typeof raw.content === "object") {
        console.warn(
          "MessageAdapter: Content object missing text field:",
          raw.content
        );
        content = raw.content.message || raw.content.value || String(raw.content);
      } else {
        console.warn("MessageAdapter: Unexpected content format:", raw.content);
        content = String(raw.content);
      }
    }

    return {
      id: (isDirectMessage ? raw.event_id : raw.message_id) || "",
      senderId: (isDirectMessage ? raw.source_id : raw.sender_id) || "",
      timestamp: raw.timestamp,
      content: isDirectMessage ? raw.payload.content.text : content,
      type: isDirectMessage ? raw.payload.message_type : raw.message_type,
      channel: isDirectMessage ? "" : raw.channel,
      targetUserId: isDirectMessage
        ? raw.payload.target_agent_id
        : raw.target_agent_id,
      replyToId: isDirectMessage ? "" : raw.reply_to_id,
      threadLevel: isDirectMessage ? 1 : raw.thread_level,
      quotedMessageId: raw.quoted_message_id,
      quotedText: raw.quoted_text,
      reactions: raw.reactions,
      attachments: attachments.length > 0 ? attachments : undefined,
      threadInfo: raw.thread_info
        ? {
            isRoot: raw.thread_info.is_root,
            threadLevel: raw.thread_info.thread_level,
            childrenCount: raw.thread_info.children_count,
          }
        : undefined,
    };
  }

  static fromLegacyMessage(legacy: LegacyMessage): UnifiedMessage {
    const attachments: UnifiedMessage["attachments"] = [];

    if (legacy.attachment_file_id && legacy.attachment_filename) {
      attachments.push({
        fileId: legacy.attachment_file_id,
        filename: legacy.attachment_filename,
        size:
          typeof legacy.attachment_size === "string"
            ? parseInt(legacy.attachment_size) || 0
            : legacy.attachment_size || 0,
      });
    }

    if (legacy.attachments) {
      attachments.push(
        ...legacy.attachments.map((att) => ({
          fileId: att.file_id,
          filename: att.filename,
          size: att.size,
          fileType: att.file_type,
        }))
      );
    }

    return {
      id: legacy.id,
      senderId: legacy.sender,
      timestamp: legacy.timestamp,
      content: legacy.text,
      type: "channel_message",
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  static toRawThreadMessage(
    unified: UnifiedMessage
  ): Partial<RawThreadMessage> {
    const raw: Partial<RawThreadMessage> = {
      message_id: unified.id,
      sender_id: unified.senderId,
      timestamp: unified.timestamp,
      content: {
        text: unified.content,
      },
      message_type: unified.type,
      channel: unified.channel,
      target_agent_id: unified.targetUserId,
      reply_to_id: unified.replyToId,
      thread_level: unified.threadLevel,
      quoted_message_id: unified.quotedMessageId,
      quoted_text: unified.quotedText,
      reactions: unified.reactions,
    };

    if (unified.attachments && unified.attachments.length > 0) {
      if (unified.attachments.length === 1) {
        const attachment = unified.attachments[0];
        raw.attachment_file_id = attachment.fileId;
        raw.attachment_filename = attachment.filename;
        raw.attachment_size = attachment.size;
      }

      raw.attachments = unified.attachments.map((att) => ({
        file_id: att.fileId,
        filename: att.filename,
        size: att.size,
        file_type: att.fileType,
      }));
    }

    if (unified.threadInfo) {
      raw.thread_info = {
        is_root: unified.threadInfo.isRoot,
        thread_level: unified.threadInfo.threadLevel,
        children_count: unified.threadInfo.childrenCount,
      };
    }

    return raw;
  }

  static fromRawThreadMessages(
    rawMessages: RawThreadMessage[]
  ): UnifiedMessage[] {
    return rawMessages.map((raw) => this.fromRawThreadMessage(raw));
  }

  static fromLegacyMessages(
    legacyMessages: LegacyMessage[]
  ): UnifiedMessage[] {
    return legacyMessages.map((legacy) => this.fromLegacyMessage(legacy));
  }
}

export class MessageUtils {
  static formatUsername(senderId: string, currentUserId: string): string {
    if (senderId === currentUserId) {
      return "You";
    }

    if (!senderId || typeof senderId !== "string") {
      return "Unknown";
    }

    if (senderId.includes("@")) {
      const namePart = senderId.split("@")[0];
      if (namePart.includes("_")) {
        return namePart
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
      }
      return namePart;
    }

    if (senderId.includes("_")) {
      return senderId
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }

    return senderId.charAt(0).toUpperCase() + senderId.slice(1);
  }

  static parseTimestamp(timestamp: string | number): number {
    if (!timestamp) return 0;

    const timestampStr = String(timestamp);

    if (timestampStr.includes("T") || timestampStr.includes("-")) {
      const time = new Date(timestampStr).getTime();
      return isNaN(time) ? 0 : time;
    }

    const num = parseInt(timestampStr);
    if (isNaN(num)) return 0;

    if (num < 10000000000) {
      return num * 1000;
    } else {
      return num;
    }
  }

  static sortMessagesByTimestamp(messages: UnifiedMessage[]): UnifiedMessage[] {
    return [...messages].sort((a, b) => {
      const aTime = this.parseTimestamp(a.timestamp);
      const bTime = this.parseTimestamp(b.timestamp);
      return aTime - bTime;
    });
  }

  static filterChannelMessages(
    messages: UnifiedMessage[],
    channel: string
  ): UnifiedMessage[] {
    return messages.filter(
      (message) =>
        (message.type === "channel_message" ||
          message.type === "reply_message") &&
        message.channel === channel
    );
  }

  static filterDirectMessages(
    messages: UnifiedMessage[],
    targetUserId: string,
    currentUserId: string
  ): UnifiedMessage[] {
    return messages.filter(
      (message) =>
        message.type === "direct_message" &&
        (message.targetUserId === targetUserId ||
          message.senderId === targetUserId ||
          (message.senderId === currentUserId &&
            message.targetUserId === targetUserId))
    );
  }

  static buildThreadStructure(messages: UnifiedMessage[]): {
    structure: {
      [messageId: string]: {
        message: UnifiedMessage;
        children: string[];
        level: number;
      };
    };
    rootMessageIds: string[];
  } {
    const structure: {
      [messageId: string]: {
        message: UnifiedMessage;
        children: string[];
        level: number;
      };
    } = {};
    const rootMessages: string[] = [];

    messages.forEach((message) => {
      structure[message.id] = {
        message,
        children: [],
        level: message.threadLevel || 0,
      };

      if (!message.replyToId) {
        rootMessages.push(message.id);
      }
    });

    const orphanedReplies: string[] = [];

    messages.forEach((message) => {
      if (message.replyToId) {
        if (structure[message.replyToId]) {
          structure[message.replyToId].children.push(message.id);
        } else {
          orphanedReplies.push(message.id);
        }
      }
    });

    rootMessages.push(...orphanedReplies);

    return { structure, rootMessageIds: rootMessages };
  }
}

