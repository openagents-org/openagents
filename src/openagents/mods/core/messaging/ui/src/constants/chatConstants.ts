/**
 * Chat 功能相关的统一常量定义
 * 避免在多个组件中重复定义相同的常量
 */

import { ConnectionStatusEnum } from "../types/connection";

/**
 * 连接状态颜色映射
 */
export const CONNECTED_STATUS_COLOR = {
  [ConnectionStatusEnum.CONNECTED]: "#10b981",
  [ConnectionStatusEnum.CONNECTING]: "#f59e0b",
  [ConnectionStatusEnum.RECONNECTING]: "#f59e0b",
  [ConnectionStatusEnum.DISCONNECTED]: "#6b7280",
  [ConnectionStatusEnum.ERROR]: "#ef4444",
  default: "#6b7280",
} as const;

/**
 * 反应表情映射 - 完整版本
 */
export const REACTION_EMOJIS = {
  "+1": "👍",
  "-1": "👎",
  like: "❤️",
  heart: "💗",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
  angry: "😠",
  thumbs_up: "👍",
  thumbs_down: "👎",
  smile: "😊",
  ok: "👌",
  done: "✅",
  fire: "🔥",
  party: "🎉",
  clap: "👏",
  check: "✅",
  cross: "❌",
  eyes: "👀",
  thinking: "🤔",
} as const;

/**
 * 反应选择器中显示的表情 - 精选版本
 */
export const REACTION_PICKER_EMOJIS = [
  { type: '+1', emoji: '👍' },
  { type: 'heart', emoji: '❤️' },
  { type: 'laugh', emoji: '😂' },
  { type: 'wow', emoji: '😮' },
  { type: 'sad', emoji: '😢' },
  { type: 'angry', emoji: '😠' },
  { type: 'fire', emoji: '🔥' },
  { type: 'party', emoji: '🎉' },
] as const;

/**
 * 消息显示相关的CSS样式
 */
export const MESSAGE_DISPLAY_STYLES = `
  .quote-author:before {
    content: "📝 ";
    opacity: 0.7;
  }

  .message-content * {
    margin: 0;
  }

  .message-content *:not(:last-child) {
    margin-bottom: 0.5rem;
  }

  .message-content p:last-child {
    margin-bottom: 0;
  }
` as const;

/**
 * 反应表情类型
 */
export type ReactionType = keyof typeof REACTION_EMOJIS;

/**
 * 获取反应表情
 */
export function getReactionEmoji(reactionType: string): string {
  return REACTION_EMOJIS[reactionType as ReactionType] || reactionType;
}

