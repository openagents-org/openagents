/**
 * Message display related utility functions
 * Common logic extracted from JSX components
 */

import { UnifiedMessage, MessageUtils } from "@/types/message";

/**
 * Format relative timestamp
 */
export function formatRelativeTimestamp(timestamp: string | number): string {
  const time = MessageUtils.parseTimestamp(timestamp);
  if (!time) return 'Unknown time';

  const now = Date.now();
  const diff = now - time;

  // Less than 1 minute
  if (diff < 60 * 1000) {
    return 'Just now';
  }

  // Less than 1 hour
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}m ago`;
  }

  // Less than 24 hours
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  }

  // Less than 7 days
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }

  // More than 7 days, show specific date
  return new Date(time).toLocaleDateString();
}


/**
 * Check if user is the author of the message
 */
export function isMessageAuthor(message: UnifiedMessage, currentUserId: string): boolean {
  return message.senderId === currentUserId;
}

/**
 * Get message thread style class name
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
 * Get message background style class name
 */
export function getMessageBackgroundClass(isOwnMessage: boolean): string {
  return isOwnMessage
    ? "bg-blue-50 border-blue-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-blue-900 dark:border-blue-500 dark:hover:bg-slate-700 dark:hover:border-slate-600"
    : "bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-600 dark:hover:bg-slate-700 dark:hover:border-slate-500";
}

/**
 * Generate temporary message ID
 */
export function generateTempMessageId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Check if message content is empty
 */
export function isEmptyMessage(content: string): boolean {
  return !content || content.trim().length === 0;
}

/**
 * Truncate message content for preview
 */
export function truncateMessageContent(content: string, maxLength: number = 100): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength).trim() + '...';
}

/**
 * Check if message has attachments
 */
export function hasAttachments(message: UnifiedMessage): boolean {
  return Boolean(message.attachments && message.attachments.length > 0);
}

/**
 * Get total attachment count
 */
export function getAttachmentCount(message: UnifiedMessage): number {
  return message.attachments?.length || 0;
}

/**
 * Check if message is a reply
 */
export function isReplyMessage(message: UnifiedMessage): boolean {
  return Boolean(message.replyToId && message.type === 'reply_message');
}

/**
 * Check if message has a quoted message
 */
export function hasQuotedMessage(message: UnifiedMessage): boolean {
  return Boolean(message.quotedMessageId && message.quotedText);
}

/**
 * Calculate total reactions
 */
export function getTotalReactions(reactions: { [key: string]: number } = {}): number {
  return Object.values(reactions).reduce((total, count) => total + count, 0);
}

/**
 * Get the most popular reaction
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
 * Filter valid reactions (count > 0)
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
 * Lightweight version of building thread structure
 */
export interface MessageTreeNode {
  message: UnifiedMessage;
  children: MessageTreeNode[];
  level: number;
}

export function buildMessageTree(messages: UnifiedMessage[]): MessageTreeNode[] {
  const messageMap = new Map<string, MessageTreeNode>();
  const rootNodes: MessageTreeNode[] = [];

  // First pass: create all nodes
  messages.forEach(message => {
    messageMap.set(message.id, {
      message,
      children: [],
      level: message.threadLevel || 0,
    });
  });

  // Second pass: establish parent-child relationships
  messages.forEach(message => {
    const node = messageMap.get(message.id)!;

    if (message.replyToId) {
      const parent = messageMap.get(message.replyToId);
      if (parent) {
        parent.children.push(node);
        node.level = parent.level + 1;
      } else {
        // Parent message doesn't exist, treat as root node
        rootNodes.push(node);
      }
    } else {
      // No reply ID, treat as root node
      rootNodes.push(node);
    }
  });

  return rootNodes;
}

/**
 * Check if message should show thread collapse button
 */
export function shouldShowThreadCollapseButton(node: MessageTreeNode): boolean {
  return node.children.length > 0;
}

/**
 * Get thread statistics
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