/**
 * 统一的消息类型定义和数据适配器
 * 解决后端返回的direct message和channel message格式不一致的问题
 */

// 统一的消息类型 - 前端内部使用
export interface UnifiedMessage {
  // 基础信息
  id: string;
  senderId: string;
  timestamp: string;
  content: string;

  // 消息类型
  type: 'direct_message' | 'channel_message' | 'reply_message';

  // 频道信息（仅频道消息）
  channel?: string;

  // 私信目标（仅私信）
  targetUserId?: string;

  // 回复信息
  replyToId?: string;
  threadLevel?: number;

  // 引用信息
  quotedMessageId?: string;
  quotedText?: string;

  // 反应
  reactions?: {
    [reactionType: string]: number;
  };

  // 附件
  attachments?: Array<{
    fileId: string;
    filename: string;
    size: number;
    fileType?: string;
  }>;

  // 线程信息
  threadInfo?: {
    isRoot: boolean;
    threadLevel?: number;
    childrenCount?: number;
  };
}

// 原始的后端消息格式（from events.ts ThreadMessage）
export interface RawThreadMessage {
  message_id: string;
  sender_id: string;
  timestamp: string;
  content: {
    text: string;
  };
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

// 旧的消息格式（from types/index.ts Message）
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

/**
 * 数据适配器 - 将后端数据转换为统一格式
 */
export class MessageAdapter {
  /**
   * 将RawThreadMessage转换为UnifiedMessage
   */
  static fromRawThreadMessage(raw: RawThreadMessage): UnifiedMessage {
    const attachments: UnifiedMessage['attachments'] = [];

    // 处理单个附件（旧格式）
    if (raw.attachment_file_id && raw.attachment_filename) {
      attachments.push({
        fileId: raw.attachment_file_id,
        filename: raw.attachment_filename,
        size: typeof raw.attachment_size === 'string'
          ? parseInt(raw.attachment_size) || 0
          : raw.attachment_size || 0,
      });
    }

    // 处理多个附件（新格式）
    if (raw.attachments) {
      attachments.push(...raw.attachments.map(att => ({
        fileId: att.file_id,
        filename: att.filename,
        size: att.size,
        fileType: att.file_type,
      })));
    }

    return {
      id: raw.message_id,
      senderId: raw.sender_id,
      timestamp: raw.timestamp,
      content: raw.content?.text || '',
      type: raw.message_type,
      channel: raw.channel,
      targetUserId: raw.target_agent_id,
      replyToId: raw.reply_to_id,
      threadLevel: raw.thread_level,
      quotedMessageId: raw.quoted_message_id,
      quotedText: raw.quoted_text,
      reactions: raw.reactions,
      attachments: attachments.length > 0 ? attachments : undefined,
      threadInfo: raw.thread_info ? {
        isRoot: raw.thread_info.is_root,
        threadLevel: raw.thread_info.thread_level,
        childrenCount: raw.thread_info.children_count,
      } : undefined,
    };
  }

  /**
   * 将LegacyMessage转换为UnifiedMessage
   */
  static fromLegacyMessage(legacy: LegacyMessage): UnifiedMessage {
    const attachments: UnifiedMessage['attachments'] = [];

    // 处理单个附件（旧格式）
    if (legacy.attachment_file_id && legacy.attachment_filename) {
      attachments.push({
        fileId: legacy.attachment_file_id,
        filename: legacy.attachment_filename,
        size: typeof legacy.attachment_size === 'string'
          ? parseInt(legacy.attachment_size) || 0
          : legacy.attachment_size || 0,
      });
    }

    // 处理多个附件（新格式）
    if (legacy.attachments) {
      attachments.push(...legacy.attachments.map(att => ({
        fileId: att.file_id,
        filename: att.filename,
        size: att.size,
        fileType: att.file_type,
      })));
    }

    return {
      id: legacy.id,
      senderId: legacy.sender,
      timestamp: legacy.timestamp,
      content: legacy.text,
      type: 'channel_message', // LegacyMessage没有类型信息，默认为频道消息
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  /**
   * 将UnifiedMessage转换为发送给后端的格式
   */
  static toRawThreadMessage(unified: UnifiedMessage): Partial<RawThreadMessage> {
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

    // 处理附件
    if (unified.attachments && unified.attachments.length > 0) {
      if (unified.attachments.length === 1) {
        // 单个附件 - 使用旧格式字段
        const attachment = unified.attachments[0];
        raw.attachment_file_id = attachment.fileId;
        raw.attachment_filename = attachment.filename;
        raw.attachment_size = attachment.size;
      }

      // 多个附件 - 使用新格式数组
      raw.attachments = unified.attachments.map(att => ({
        file_id: att.fileId,
        filename: att.filename,
        size: att.size,
        file_type: att.fileType,
      }));
    }

    // 处理线程信息
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
   * 批量转换消息数组
   */
  static fromRawThreadMessages(rawMessages: RawThreadMessage[]): UnifiedMessage[] {
    return rawMessages.map(raw => this.fromRawThreadMessage(raw));
  }

  /**
   * 批量转换旧格式消息数组
   */
  static fromLegacyMessages(legacyMessages: LegacyMessage[]): UnifiedMessage[] {
    return legacyMessages.map(legacy => this.fromLegacyMessage(legacy));
  }
}

/**
 * 消息工具函数
 */
export class MessageUtils {
  /**
   * 格式化用户名显示
   */
  static formatUsername(senderId: string, currentUserId: string): string {
    if (senderId === currentUserId) {
      return "You";
    }

    if (!senderId || typeof senderId !== 'string') {
      return 'Unknown';
    }

    // 如果包含@，取@之前的部分
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

    // 如果包含下划线，格式化显示
    if (senderId.includes("_")) {
      return senderId
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }

    // 否则只是首字母大写
    return senderId.charAt(0).toUpperCase() + senderId.slice(1);
  }

  /**
   * 解析时间戳
   */
  static parseTimestamp(timestamp: string | number): number {
    if (!timestamp) return 0;

    const timestampStr = String(timestamp);

    // 处理ISO字符串格式
    if (timestampStr.includes("T") || timestampStr.includes("-")) {
      const time = new Date(timestampStr).getTime();
      return isNaN(time) ? 0 : time;
    }

    // 处理Unix时间戳
    const num = parseInt(timestampStr);
    if (isNaN(num)) return 0;

    // 如果是秒级时间戳，转换为毫秒
    if (num < 10000000000) {
      return num * 1000;
    } else {
      return num;
    }
  }

  /**
   * 按时间戳排序消息
   */
  static sortMessagesByTimestamp(messages: UnifiedMessage[]): UnifiedMessage[] {
    return [...messages].sort((a, b) => {
      const aTime = this.parseTimestamp(a.timestamp);
      const bTime = this.parseTimestamp(b.timestamp);
      return aTime - bTime;
    });
  }

  /**
   * 过滤频道消息
   */
  static filterChannelMessages(messages: UnifiedMessage[], channel: string): UnifiedMessage[] {
    return messages.filter(message =>
      (message.type === 'channel_message' || message.type === 'reply_message') &&
      message.channel === channel
    );
  }

  /**
   * 过滤私信消息
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
   * 构建线程结构
   */
  static buildThreadStructure(messages: UnifiedMessage[]): {
    structure: { [messageId: string]: { message: UnifiedMessage; children: string[]; level: number } };
    rootMessageIds: string[];
  } {
    const structure: { [messageId: string]: { message: UnifiedMessage; children: string[]; level: number } } = {};
    const rootMessages: string[] = [];

    // 第一遍：组织消息并识别根消息
    messages.forEach((message) => {
      structure[message.id] = {
        message,
        children: [],
        level: message.threadLevel || 0,
      };

      // 只有带reply_to_id的才被认为是回复
      if (!message.replyToId) {
        rootMessages.push(message.id);
      }
    });

    // 跟踪孤立的回复
    const orphanedReplies: string[] = [];

    // 第二遍：建立父子关系
    messages.forEach((message) => {
      if (message.replyToId) {
        if (structure[message.replyToId]) {
          structure[message.replyToId].children.push(message.id);
        } else {
          // 父消息不存在 - 作为孤立回复处理
          orphanedReplies.push(message.id);
        }
      }
    });

    // 将孤立回复作为根消息显示
    rootMessages.push(...orphanedReplies);

    return { structure, rootMessageIds: rootMessages };
  }
}