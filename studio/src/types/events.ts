/**
 * TypeScript type definitions for the new OpenAgents event system
 */

export interface EventResponse {
  success: boolean;
  message?: string;
  data?: any;
  event_name?: string;
}

export interface Event {
  event_id?: string;
  event_name: string;
  source_id: string;
  destination_id?: string;
  payload?: any;
  metadata?: any;
  timestamp?: number;
  visibility?: 'public' | 'network' | 'channel' | 'direct' | 'restricted' | 'mod_only';
}

export enum EventNames {
  // Agent messaging events
  AGENT_MESSAGE = 'agent.message',
  
  // Thread messaging events
  THREAD_DIRECT_MESSAGE_SEND = 'thread.direct_message.send',
  THREAD_CHANNEL_MESSAGE_POST = 'thread.channel_message.post',
  THREAD_REPLY_SENT = 'thread.reply.sent',
  THREAD_REACTION_ADD = 'thread.reaction.add',
  THREAD_REACTION_REMOVE = 'thread.reaction.remove',
  THREAD_FILE_UPLOAD = 'thread.file.upload',
  
  // Thread messaging responses
  THREAD_DIRECT_MESSAGE_NOTIFICATION = 'thread.direct_message.notification',
  THREAD_CHANNEL_MESSAGE_NOTIFICATION = 'thread.channel_message.notification',
  THREAD_REPLY_NOTIFICATION = 'thread.reply.notification',
  THREAD_REACTION_NOTIFICATION = 'thread.reaction.notification',
  THREAD_FILE_UPLOAD_RESPONSE = 'thread.file.upload_response',
  
  // Thread messaging queries
  THREAD_CHANNELS_LIST = 'thread.channels.list',
  THREAD_CHANNELS_LIST_RESPONSE = 'thread.channels.list_response',
  THREAD_CHANNEL_MESSAGES_RETRIEVE = 'thread.channel_messages.retrieve',
  THREAD_CHANNEL_MESSAGES_RETRIEVE_RESPONSE = 'thread.channel_messages.retrieve_response',
  THREAD_DIRECT_MESSAGES_RETRIEVE = 'thread.direct_messages.retrieve',
  THREAD_DIRECT_MESSAGES_RETRIEVE_RESPONSE = 'thread.direct_messages.retrieve_response',
  
  // System events
  SYSTEM_REGISTER_AGENT = 'system.register_agent',
  SYSTEM_UNREGISTER_AGENT = 'system.unregister_agent',
  SYSTEM_HEALTH_CHECK = 'system.health_check',
  SYSTEM_POLL_MESSAGES = 'system.poll_messages'
}

/**
 * @deprecated 请使用 RawThreadMessage from types/message.ts
 * 这个接口保留用于后端兼容性，新代码应使用统一的消息类型系统
 */
export interface ThreadMessage {
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

// 重新导出 RawThreadMessage 作为主要类型
export type { RawThreadMessage as ThreadMessageNew } from './message';

export interface ThreadChannel {
  name: string;
  description: string;
  agents: string[];
  message_count: number;
  thread_count: number;
}

export interface AgentInfo {
  agent_id: string;
  metadata: {
    display_name?: string;
    avatar?: string;
    status?: 'online' | 'offline' | 'away';
  };
  last_activity: string;
}

export interface NetworkInfo {
  name: string;
  node_id: string;
  mode: 'centralized' | 'decentralized';
  mods: string[];
  agent_count: number;
}