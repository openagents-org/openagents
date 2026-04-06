/**
 * Unified constant definitions for Chat functionality
 * Avoid repeating the same constants across multiple components
 */

import { ConnectionStatusEnum } from "@/types/connection";

/**
 * Connection status color mapping
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
 * Reaction emoji mapping - full version
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
 * Emojis displayed in reaction picker - curated version
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
 * CSS styles for message display
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
 * Reaction emoji type
 */
export type ReactionType = keyof typeof REACTION_EMOJIS;

/**
 * Get reaction emoji
 */
export function getReactionEmoji(reactionType: string): string {
  return REACTION_EMOJIS[reactionType as ReactionType] || reactionType;
}