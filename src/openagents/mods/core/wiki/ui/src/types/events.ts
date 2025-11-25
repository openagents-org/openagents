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
  source_id?: string;
  destination_id?: string;
  payload?: any;
  metadata?: any;
  timestamp?: number;
  visibility?: 'public' | 'network' | 'channel' | 'direct' | 'restricted' | 'mod_only';
  secret?: string;
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
  SYSTEM_POLL_MESSAGES = 'system.poll_messages',
  SYSTEM_KICK_AGENT = 'system.kick_agent',
  SYSTEM_KICKED = 'system.kicked'
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

