/**
 * 消息显示相关的工具函数
 * 从JSX组件中提取的公共逻辑
 */

import { UnifiedMessage, MessageUtils } from "@/types/message";

/**
 * 格式化相对时间戳
 */
export function formatRelativeTimestamp(timestamp: string | number): string {
  const time = MessageUtils.parseTimestamp(timestamp);
  if (!time) return 'Unknown time';

  const now = Date.now();
  const diff = now - time;

  // 小于1分钟
  if (diff < 60 * 1000) {
    return 'Just now';
  }

  // 小于1小时
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}m ago`;
  }

  // 小于24小时
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  }

  // 小于7天
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }

  // 超过7天，显示具体日期
  return new Date(time).toLocaleDateString();
}


/**
 * 检查用户是否是消息的作者
 */
export function isMessageAuthor(message: UnifiedMessage, currentUserId: string): boolean {
  return message.senderId === currentUserId;
}

/**
 * 获取消息的线程样式类名
 */
export function getThreadStyleClass(level: number): string {
  const levelClasses = [
    "ml-8 border-l-blue-500",    // level 0
    "ml-10 border-l-emerald-500", // level 1
    "ml-12 border-l-amber-500",   // level 2
    "ml-14 border-l-red-500",     // level 3+
  ];

  return levelClasses[Math.min(level, levelClasses.length - 1)] || levelClasses[levelClasses.length - 1];
}

/**
 * 获取消息的背景样式类名
 */
export function getMessageBackgroundClass(isOwnMessage: boolean): string {
  return isOwnMessage
    ? "bg-blue-50 border-blue-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-blue-900 dark:border-blue-500 dark:hover:bg-slate-700 dark:hover:border-slate-600"
    : "bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-600 dark:hover:bg-slate-700 dark:hover:border-slate-500";
}

/**
 * 生成临时消息ID
 */
export function generateTempMessageId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 检查消息是否为空内容
 */
export function isEmptyMessage(content: string): boolean {
  return !content || content.trim().length === 0;
}

/**
 * 截取消息内容用于预览
 */
export function truncateMessageContent(content: string, maxLength: number = 100): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength).trim() + '...';
}

/**
 * 检查消息是否包含附件
 */
export function hasAttachments(message: UnifiedMessage): boolean {
  return Boolean(message.attachments && message.attachments.length > 0);
}

/**
 * 获取附件总数
 */
export function getAttachmentCount(message: UnifiedMessage): number {
  return message.attachments?.length || 0;
}

/**
 * 检查消息是否为回复
 */
export function isReplyMessage(message: UnifiedMessage): boolean {
  return Boolean(message.replyToId && message.type === 'reply_message');
}

/**
 * 检查消息是否包含引用
 */
export function hasQuotedMessage(message: UnifiedMessage): boolean {
  return Boolean(message.quotedMessageId && message.quotedText);
}

/**
 * 计算反应总数
 */
export function getTotalReactions(reactions: { [key: string]: number } = {}): number {
  return Object.values(reactions).reduce((total, count) => total + count, 0);
}

/**
 * 获取最受欢迎的反应
 */
export function getTopReaction(reactions: { [key: string]: number } = {}): { type: string; count: number } | null {
  let topType = '';
  let topCount = 0;

  for (const [type, count] of Object.entries(reactions)) {
    if (count > topCount) {
      topType = type;
      topCount = count;
    }
  }

  return topCount > 0 ? { type: topType, count: topCount } : null;
}

/**
 * 过滤有效的反应（计数 > 0）
 */
export function getValidReactions(reactions: { [key: string]: number } = {}): { [key: string]: number } {
  const validReactions: { [key: string]: number } = {};

  for (const [type, count] of Object.entries(reactions)) {
    if (count > 0) {
      validReactions[type] = count;
    }
  }

  return validReactions;
}

/**
 * 构建线程结构的轻量级版本
 */
export interface MessageTreeNode {
  message: UnifiedMessage;
  children: MessageTreeNode[];
  level: number;
}

export function buildMessageTree(messages: UnifiedMessage[]): MessageTreeNode[] {
  const messageMap = new Map<string, MessageTreeNode>();
  const rootNodes: MessageTreeNode[] = [];

  // 第一遍：创建所有节点
  messages.forEach(message => {
    messageMap.set(message.id, {
      message,
      children: [],
      level: message.threadLevel || 0,
    });
  });

  // 第二遍：建立父子关系
  messages.forEach(message => {
    const node = messageMap.get(message.id)!;

    if (message.replyToId) {
      const parent = messageMap.get(message.replyToId);
      if (parent) {
        parent.children.push(node);
        node.level = parent.level + 1;
      } else {
        // 父消息不存在，作为根节点
        rootNodes.push(node);
      }
    } else {
      // 没有回复ID，作为根节点
      rootNodes.push(node);
    }
  });

  return rootNodes;
}

/**
 * 检查消息是否应该显示线程折叠按钮
 */
export function shouldShowThreadCollapseButton(node: MessageTreeNode): boolean {
  return node.children.length > 0;
}

/**
 * 获取线程统计信息
 */
export function getThreadStats(node: MessageTreeNode): { replyCount: number; maxDepth: number } {
  let replyCount = node.children.length;
  let maxDepth = 0;

  function traverse(currentNode: MessageTreeNode, depth: number) {
    maxDepth = Math.max(maxDepth, depth);

    currentNode.children.forEach(child => {
      replyCount += child.children.length;
      traverse(child, depth + 1);
    });
  }

  traverse(node, 0);

  return { replyCount, maxDepth };
}