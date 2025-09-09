import React, { useState, useEffect, useRef, useCallback } from 'react';
import { OpenAgentsGRPCConnection, ThreadMessage, ThreadMessagingChannel, AgentInfo } from '../../services/grpcService';
import { NetworkConnection } from '../../services/networkService';

import MessageDisplay from './MessageDisplay';
import MessageInput from './ThreadMessageInput';
import DocumentsView from '../documents/DocumentsView';
import { ReadMessageStore } from '../../utils/readMessageStore';
import { mentionNotifier } from '../../utils/mentionNotifier';

interface ThreadMessagingViewProps {
  networkConnection: NetworkConnection;
  agentName: string;
  currentTheme: 'light' | 'dark';
  onProfileClick?: () => void;
  toggleTheme?: () => void;
  hasSharedDocuments?: boolean;
  onDocumentsClick?: () => void;
  onThreadStateChange?: (state: ThreadState) => void;
}

export interface ThreadState {
  currentChannel: string | null;
  currentDirectMessage: string | null; // agent_id for DM conversations
  channels: ThreadMessagingChannel[];
  agents: AgentInfo[];
  messages: { [key: string]: ThreadMessage[] }; // channel/dm_agent_id -> messages
  isLoading: boolean;
  error: string | null;
  showDocuments: boolean; // Track if we're showing documents view
}

const styles = `
  .thread-messaging-container {
    display: flex;
    height: 100vh;
    background: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  
  .thread-messaging-container.dark {
    background: #0f172a;
  }
  
  .thread-messaging-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  
  .thread-messaging-header {
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 60px;
  }
  
  .thread-messaging-header.dark {
    background: #1e293b;
    border-bottom: 1px solid #334155;
  }
  
  .header-title {
    font-size: 18px;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
  }
  
  .header-title.dark {
    color: #f1f5f9;
  }
  
  .header-subtitle {
    font-size: 14px;
    color: #64748b;
    margin: 0;
  }
  
  .header-subtitle.dark {
    color: #94a3b8;
  }
  
  .connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  
  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
  }
  
  .status-indicator.connecting {
    background: #f59e0b;
    animation: pulse 2s infinite;
  }
  
  .status-indicator.disconnected {
    background: #ef4444;
  }
  
  .loading-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 16px;
    color: #64748b;
  }
  
  .loading-screen.dark {
    color: #94a3b8;
  }
  
  .error-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 16px;
    color: #ef4444;
    text-align: center;
  }
  
  .error-screen.dark {
    color: #f87171;
  }
  
  .retry-button {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }
  
  .retry-button:hover {
    background: #2563eb;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .refreshing-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #3b82f6;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .refreshing-indicator.visible {
    opacity: 1;
  }
  
  .refreshing-indicator.dark {
    color: #60a5fa;
  }
  
  .refresh-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #e5e7eb;
    border-top: 2px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  .refresh-spinner.dark {
    border-color: #4b5563;
    border-top-color: #60a5fa;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const ThreadMessagingView = React.forwardRef<{ getState: () => ThreadState }, ThreadMessagingViewProps>(({
  networkConnection,
  agentName,
  currentTheme,
  onProfileClick,
  toggleTheme,
  hasSharedDocuments = false,
  onDocumentsClick,
  onThreadStateChange
}, ref) => {
  const [connection, setConnection] = useState<OpenAgentsGRPCConnection | null>(null);
  const [state, setState] = useState<ThreadState>({
    currentChannel: null,
    currentDirectMessage: null,
    channels: [],
    agents: [],
    messages: {},
    isLoading: true,
    error: null,
    showDocuments: false
  });
  
  // Reply and quote state
  const [replyingTo, setReplyingTo] = useState<{
    messageId: string;
    text: string;
    author: string;
  } | null>(null);
  
  const [quotingMessage, setQuotingMessage] = useState<{
    messageId: string;
    text: string;
    author: string;
  } | null>(null);
  
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  
  // Add unread message tracking
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Add read message store
  const readMessageStoreRef = useRef<ReadMessageStore | null>(null);
  
  // Add periodic message checking
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Cache for pending attachment data to preserve it during message round-trips
  const pendingAttachmentsRef = useRef<Map<string, {
    file_id: string;
    filename: string; 
    size: number;
    timestamp: number;
  }>>(new Map());
  const connectionRef = useRef<OpenAgentsGRPCConnection | null>(null);
  const lastMessageTimeRef = useRef<number>(0); // Track last message time to reduce polling
  const [currentAgentId, setCurrentAgentId] = useState(agentName);

  // Initialize mention notifier with current agent ID
  useEffect(() => {
    mentionNotifier.setCurrentUserAgent(agentName);
  }, [agentName]);



  // Notify parent of state changes
  useEffect(() => {
    if (onThreadStateChange) {
      // Always call, even if agents is empty, to ensure the parent gets updates
      onThreadStateChange(state);
    }
  }, [state, onThreadStateChange]);

  // Also notify parent when agents specifically change
  useEffect(() => {
    if (onThreadStateChange && state.agents?.length > 0) {
      onThreadStateChange(state);
    }
  }, [state.agents, onThreadStateChange, state]);

  // Initialize read message store
  useEffect(() => {
    const networkHost = networkConnection.host || 'localhost';
    const networkPort = networkConnection.port || 8000;
    readMessageStoreRef.current = new ReadMessageStore(networkHost, networkPort, agentName);
    console.log(`📖 Initialized read message store for ${agentName}@${networkHost}:${networkPort}`);
  }, [networkConnection, agentName]);

  // Initialize connection
  useEffect(() => {
    let isSubscribed = true; // Prevent race conditions
    let retryCount = 0;
    const maxRetries = 2;
    
    const initConnection = async () => {
      if (!isSubscribed) return; // Skip if component unmounted
      try {
        console.log('🔄 Initializing thread messaging connection...');
        setState(prev => ({ ...prev, isLoading: true, error: null }));
        setConnectionStatus('connecting');

        const conn = new OpenAgentsGRPCConnection(agentName, networkConnection);
        connectionRef.current = conn;

        // Set up event handlers
        conn.on('message', handleMessage);
        conn.on('channels', handleChannelsList);
        conn.on('channel_messages', handleChannelMessages);  
        conn.on('direct_messages', handleDirectMessages);
        conn.on('agents', handleAgentsList);
        conn.on('reaction', handleReaction);
        
        // Add reconnection event handlers
        conn.on('reconnecting', handleReconnecting);
        conn.on('reconnected', handleReconnected);
        conn.on('connectionLost', handleConnectionLost);
        // Note: Removed real-time notifications, using periodic polling instead

        // Connect to network
        const connected = await conn.connect();
        if (!connected) {
          console.warn('⚠️ Initial connection failed, but this might be a React dev mode issue');
          throw new Error('Failed to connect to OpenAgents network');
        }

        console.log('✅ Connection established successfully');
        setConnection(conn);
        setConnectionStatus('connected');

        // Check for thread messaging mod
        const hasThreadMod = await conn.hasThreadMessagingMod();
        if (!hasThreadMod) {
          throw new Error('This network does not support thread messaging. It may be using simple_messaging instead. Please connect to a network with the thread_messaging mod enabled.');
        }

        // Check if agent ID was modified due to conflicts
        if (conn.isUsingModifiedId()) {
          const newId = conn.getCurrentAgentId();
          console.log(`Agent ID was modified to avoid conflicts: ${conn.getOriginalAgentId()} → ${newId}`);
          setCurrentAgentId(newId);
        }

        // Load initial data with a small delay to ensure agent registration is complete
        setTimeout(() => {
          console.log('📤 Requesting initial channels list...');
          conn.listChannels();
          
          console.log('📤 Requesting agents list...');
          conn.listAgents().then((agents: AgentInfo[]) => {
            console.log('👥 Network agents received:', agents);
            handleAgentsList(agents);
          }).catch((error: any) => {
            console.error('❌ Failed to get agents:', error);
          });
          
          // Also try sending a test message to trigger channel creation
          console.log('📤 Sending test message to general channel...');
          setTimeout(() => {
            conn.sendChannelMessage('general', 'Hello from OpenAgents Studio!');
          }, 1000);
        }, 500); // Wait 500ms for agent registration to complete
        

        
        setState(prev => ({ ...prev, isLoading: false }));

      } catch (error) {
        console.error('Failed to initialize thread messaging:', error);
        
        // In development mode, React double-renders components which can cause connection issues
        // Try one more time after a brief delay, but limit retries
        if (process.env.NODE_ENV === 'development' && retryCount < maxRetries) {
          retryCount++;
          console.log(`🔄 Retrying connection after React dev mode interference... (${retryCount}/${maxRetries})`);
          setTimeout(() => {
            if (isSubscribed) {
              initConnection().catch(retryError => {
                console.error('Retry also failed:', retryError);
                setState(prev => ({
                  ...prev,
                  isLoading: false,
                  error: retryError instanceof Error ? retryError.message : 'Connection failed'
                }));
                setConnectionStatus('disconnected');
              });
            }
          }, 1000);
        } else {
          // If we've exhausted retries or not in dev mode, just use fallback
          console.log('🔄 Connection retries exhausted, using fallback channels...');
          setTimeout(() => {
            if (isSubscribed) {
              const defaultChannels: ThreadMessagingChannel[] = [
                { name: 'general', description: 'General discussion', message_count: 0, agents: [], thread_count: 0 },
                { name: 'development', description: 'Development discussions', message_count: 0, agents: [], thread_count: 0 },
                { name: 'support', description: 'Support and help', message_count: 0, agents: [], thread_count: 0 },
                { name: 'random', description: 'Random conversations', message_count: 0, agents: [], thread_count: 0 },
                { name: 'announcements', description: 'Important announcements', message_count: 0, agents: [], thread_count: 0 }
              ];
              
              setState(prev => ({
                ...prev,
                isLoading: false,
                error: null,
                channels: defaultChannels,
                currentChannel: 'general'
              }));
              setConnectionStatus('connected');
            }
          }, 500);
        }
      }
    };

    initConnection();

    return () => {
      isSubscribed = false; // Mark as unsubscribed
      
      // Clear periodic message checking interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        console.log('🔄 [PERIODIC] Cleared message checking interval on unmount');
      }
      
      if (connectionRef.current) {
        console.log('🔌 Cleaning up connection on unmount');
        connectionRef.current.disconnect();
        connectionRef.current = null;
      }
    };
  }, [networkConnection, agentName]);

  const handleMessage = useCallback((message: ThreadMessage) => {
    
    // Check if this message is from the current user and is missing attachment data
    if (message.sender_id === currentAgentId && 
        !message.attachment_file_id && 
        !message.attachment_filename && 
        message.content?.text &&
        pendingAttachmentsRef.current) {
      
      // Look for cached attachment data that matches this message text
      const entries = Array.from(pendingAttachmentsRef.current.entries());
      for (const [key, attachmentData] of entries) {
        if (key.startsWith(message.content.text)) {
          message.attachment_file_id = attachmentData.file_id;
          message.attachment_filename = attachmentData.filename;
          message.attachment_size = attachmentData.size;
          // Remove from cache once applied
          if (pendingAttachmentsRef.current) {
            pendingAttachmentsRef.current.delete(key);
          }
          break;
        }
      }
    }
    
    setState(prev => {
      const newMessages = { ...prev.messages };
      
      // Determine the conversation key
      let conversationKey: string;
      if (message.message_type === 'direct_message' || 
          (message.message_type === 'reply_message' && message.target_agent_id)) {
        // Direct message conversation
        const otherAgent = message.sender_id === currentAgentId ? message.target_agent_id : message.sender_id;
        conversationKey = `dm_${otherAgent}`;
      } else {
        // Channel message
        conversationKey = `channel_${message.channel}`;
      }
      
      if (!newMessages[conversationKey]) {
        newMessages[conversationKey] = [];
      }
      
      // Add message if not already present
      const existingIndex = newMessages[conversationKey].findIndex(m => m.message_id === message.message_id);
      if (existingIndex === -1) {
        newMessages[conversationKey].push(message);
        // Sort by timestamp
        newMessages[conversationKey].sort((a, b) => {
          const aTime = parseInt(a.timestamp) < 1e10 ? parseInt(a.timestamp) * 1000 : parseInt(a.timestamp);
          const bTime = parseInt(b.timestamp) < 1e10 ? parseInt(b.timestamp) * 1000 : parseInt(b.timestamp);
          return aTime - bTime;
        });
      }
      
      return { ...prev, messages: newMessages };
    });
  }, [currentAgentId]);

  const handleChannelsList = useCallback((channels: ThreadMessagingChannel[]) => {
    console.log('📋 Received channels list:', channels);
    console.log('✅ Setting channels count:', channels?.length || 0);
    
    // Auto-select the first channel if none is selected
    const shouldAutoSelect = !state.currentChannel && channels?.length > 0;
    const selectedChannel = shouldAutoSelect ? channels[0].name : state.currentChannel;
    
    
    setState(prev => ({ 
      ...prev, 
      channels: channels || [],
      currentChannel: selectedChannel
    }));
    
    // Load messages for the selected channel
    if (shouldAutoSelect && connection) {
      console.log(`🎯 Auto-selecting first channel: ${channels[0].name}`);
      setTimeout(() => {
        if (connection.isConnected()) {
          console.log(`📡 Retrieving messages for auto-selected channel: ${channels[0].name}`);
          connection.retrieveChannelMessages(channels[0].name, 50, 0, true);
        }
      }, 100);
    }
    
    // Notify parent component about the thread state change
    if (onThreadStateChange && shouldAutoSelect) {
      setTimeout(() => {
        onThreadStateChange({
          currentChannel: channels[0].name,
          currentDirectMessage: null,
          channels: channels || [],
          agents: state.agents,
          messages: state.messages,
          isLoading: false,
          error: null,
          showDocuments: false
        });
      }, 200);
    }
  }, [connection, state.currentChannel, state.agents, onThreadStateChange]);

  const handleAgentsList = useCallback((agents: AgentInfo[]) => {
    console.log('👥 Received agents list:', agents);
    console.log('✅ Setting agents count:', agents?.length || 0);
    agents?.forEach(agent => {
      console.log('👤 Agent details:', agent.agent_id, agent.metadata?.display_name);
    });
    setState(prev => {
      console.log('🔄 Updating state with agents, previous count:', prev.agents?.length);
      const newState = { ...prev, agents: agents || [] };
      console.log('🔄 New state agents count:', newState.agents?.length);
      return newState;
    });
  }, [state.currentChannel]);

  const handleChannelMessages = useCallback((data: any) => {
    console.log('📥 Raw channel messages data:', data);
    
    // Extract channel and messages from various possible data structures
    const channel = data?.channel || data?.data?.channel || state.currentChannel;
    const messages = data?.messages || data?.data?.messages || [];
    
    console.log('📥 Handling channel messages for:', channel);
    console.log('📥 Messages received:', messages?.length || 0);
    
    // Update last message time to reduce unnecessary polling
    lastMessageTimeRef.current = Date.now();
    
    if (messages && messages.length > 0) {
      const sortedMessages = messages.sort((a: ThreadMessage, b: ThreadMessage) => {
        const aTime = parseInt(a.timestamp) < 1e10 ? parseInt(a.timestamp) * 1000 : parseInt(a.timestamp);
        const bTime = parseInt(b.timestamp) < 1e10 ? parseInt(b.timestamp) * 1000 : parseInt(b.timestamp);
        return aTime - bTime;
      });

      // Check for mentions in new messages (only notify for unread messages)
      sortedMessages.forEach((message: ThreadMessage) => {
        if (mentionNotifier.isUserMentioned(message) && readMessageStoreRef.current) {
          // Only notify if the message is not already read
          if (!readMessageStoreRef.current.isRead(message.message_id)) {
            mentionNotifier.showMentionNotification(message, channel);
          }
        }
      });

      // Update message state
      setState(prev => {
        const newState = {
          ...prev,
          messages: {
            ...prev.messages,
            [`channel_${channel}`]: sortedMessages
          }
        };

        // If this is the current channel, mark all messages as read
        if (prev.currentChannel === channel && readMessageStoreRef.current) {
          const messageIds = sortedMessages.map((msg: ThreadMessage) => msg.message_id);
          readMessageStoreRef.current.markMultipleAsRead(messageIds);
          console.log(`📖 Marked ${messageIds.length} messages as read in current channel: ${channel}`);
        }

        return newState;
      });
    }
  }, []);

  const handleDirectMessages = useCallback((data: any) => {
    const { target_agent_id, messages } = data;
    console.log('📥 Handling direct messages for:', target_agent_id);
    console.log('📥 Messages received:', messages?.length || 0);
    
    if (messages && messages.length > 0) {
      const sortedMessages = messages.sort((a: ThreadMessage, b: ThreadMessage) => {
        const aTime = parseInt(a.timestamp) < 1e10 ? parseInt(a.timestamp) * 1000 : parseInt(a.timestamp);
        const bTime = parseInt(b.timestamp) < 1e10 ? parseInt(b.timestamp) * 1000 : parseInt(b.timestamp);
        return aTime - bTime;
      });

      // Check for mentions in new messages (only notify for unread messages)
      sortedMessages.forEach((message: ThreadMessage) => {
        if (mentionNotifier.isUserMentioned(message) && readMessageStoreRef.current) {
          // Only notify if the message is not already read
          if (!readMessageStoreRef.current.isRead(message.message_id)) {
            mentionNotifier.showMentionNotification(message, `DM with ${target_agent_id}`);
          }
        }
      });

      // Update message state
      setState(prev => {
        const newState = {
          ...prev,
          messages: {
            ...prev.messages,
            [`dm_${target_agent_id}`]: sortedMessages
          }
        };

        // If this is the current DM conversation, mark all messages as read
        if (prev.currentDirectMessage === target_agent_id && readMessageStoreRef.current) {
          const messageIds = sortedMessages.map((msg: ThreadMessage) => msg.message_id);
          readMessageStoreRef.current.markMultipleAsRead(messageIds);
          console.log(`📖 Marked ${messageIds.length} messages as read in current DM with: ${target_agent_id}`);
        }

        return newState;
      });
    }
  }, []);

  const handleReaction = useCallback((reactionData: any) => {
    // Update message reactions
    setState(prev => {
      const newMessages = { ...prev.messages };
      
      // Find and update the message with the reaction
      Object.keys(newMessages).forEach(conversationKey => {
        const messageIndex = newMessages[conversationKey].findIndex(
          m => m.message_id === reactionData.target_message_id
        );
        
        if (messageIndex !== -1) {
          const updatedMessages = [...newMessages[conversationKey]];
          const message = { ...updatedMessages[messageIndex] };
          
          if (!message.reactions) {
            message.reactions = {};
          }
          
          if (reactionData.action_taken === 'add') {
            message.reactions[reactionData.reaction_type] = reactionData.total_reactions;
          } else {
            message.reactions[reactionData.reaction_type] = Math.max(0, reactionData.total_reactions);
          }
          
          updatedMessages[messageIndex] = message;
          newMessages[conversationKey] = updatedMessages;
        }
      });
      
      return { ...prev, messages: newMessages };
    });
  }, []);

  const handleNewChannelMessage = useCallback((data: any) => {
    const { channel, message } = data;
    console.log('📨 Received new channel message for channel:', channel, 'Message:', message);
    console.log('📨 Current agent ID:', agentName);
    console.log('📨 Message sender ID:', message.sender_id);
    
    // Add the new message to the appropriate channel
    setState(prev => {
      const channelKey = `channel_${channel}`;
      const existingMessages = prev.messages[channelKey] || [];
      
      // Check if message already exists (to prevent duplicates)
      const messageExists = existingMessages.some(m => m.message_id === message.message_id);
      if (messageExists) {
        console.log('📨 Message already exists, skipping duplicate');
        return prev;
      }
      
      // Add reactions field if not present
      const messageWithReactions = {
        ...message,
        reactions: message.reactions || {}
      };
      
      // Add the new message and sort by timestamp
      const updatedMessages = [...existingMessages, messageWithReactions].sort((a: ThreadMessage, b: ThreadMessage) => {
        const aTime = parseInt(a.timestamp) < 1e10 ? parseInt(a.timestamp) * 1000 : parseInt(a.timestamp);
        const bTime = parseInt(b.timestamp) < 1e10 ? parseInt(b.timestamp) * 1000 : parseInt(b.timestamp);
        return aTime - bTime;
      });
      
      return {
        ...prev,
        messages: {
          ...prev.messages,
          [channelKey]: updatedMessages
        }
      };
    });
  }, []);

  // Reconnection event handlers
  const handleReconnecting = useCallback((data: { attempt: number; maxAttempts: number; delay: number }) => {
    console.log(`🔄 Reconnecting... attempt ${data.attempt}/${data.maxAttempts} (waiting ${data.delay}ms)`);
    setConnectionStatus('connecting');
  }, []);

  const handleReconnected = useCallback((data: { attempts: number }) => {
    console.log(`🔄 ✅ Reconnected successfully after ${data.attempts} attempts!`);
    setConnectionStatus('connected');
    
    // Refresh channels and current data after reconnection
    const connection = connectionRef.current;
    if (connection && connection.isConnected()) {
      console.log('🔄 Refreshing data after reconnection...');
      
      // Re-fetch channels
      connection.listChannels();
      
      // Re-fetch agents
      connection.listAgents().catch(console.warn);
      
      // Refresh current channel/DM messages
      if (state.currentChannel) {
        connection.retrieveChannelMessages(state.currentChannel, 50, 0, true);
      }
      if (state.currentDirectMessage) {
        connection.retrieveDirectMessages(state.currentDirectMessage, 50, 0, true);
      }
    }
  }, [state.currentChannel, state.currentDirectMessage]);

  const handleConnectionLost = useCallback((data: { reason: string; error?: any }) => {
    console.log(`🔄 ❌ Connection lost: ${data.reason}`);
    setConnectionStatus('disconnected');
    
    // Optionally show user notification about lost connection
    console.warn('⚠️ Connection to OpenAgents network lost. Please check your internet connection.');
  }, []);

  // Periodic message checking function
  const checkForNewMessages = useCallback(() => {
    const connection = connectionRef.current;
    if (!connection || !connection.isConnected()) {
      return;
    }

    // Skip polling if we received a message very recently (within last 5 seconds)
    const now = Date.now();
    if (now - (lastMessageTimeRef.current || 0) < 5000) {
      console.log('🔄 [PERIODIC] Skipping check - recent activity detected');
      return;
    }

    // Check current channel for new messages (reduced frequency and scope)
    if (state.currentChannel) {
      console.log('🔄 [PERIODIC] Checking for new messages in channel:', state.currentChannel);
      connection.retrieveChannelMessages(state.currentChannel, 10, 0, true); // Further reduced to 10 messages
    }

    // Check current direct message for new messages  
    if (state.currentDirectMessage) {
      console.log('🔄 [PERIODIC] Checking for new messages with agent:', state.currentDirectMessage);
      connection.retrieveDirectMessages(state.currentDirectMessage, 10, 0, true); // Further reduced to 10 messages
    }
  }, [state.currentChannel, state.currentDirectMessage]);

  // Function to update unread counts for all channels (using new ReadMessageStore)
  const updateUnreadCounts = useCallback(() => {
    if (!readMessageStoreRef.current) return;
    
    const newUnreadCounts: Record<string, number> = {};
    
    // Calculate unread count for each channel
    state.channels.forEach(channel => {
      const channelMessages = state.messages[`channel_${channel.name}`] || [];
      const messageIds = channelMessages.map(msg => msg.message_id);
      const unreadCount = readMessageStoreRef.current!.getUnreadCount(messageIds);
      newUnreadCounts[channel.name] = unreadCount;
    });

    // Calculate unread count for each direct message conversation
    state.agents.forEach(agent => {
      const dmMessages = state.messages[`dm_${agent.agent_id}`] || [];
      const messageIds = dmMessages.map(msg => msg.message_id);
      const unreadCount = readMessageStoreRef.current!.getUnreadCount(messageIds);
      newUnreadCounts[agent.agent_id] = unreadCount;
    });

    setUnreadCounts(newUnreadCounts);
    console.log('🔢 Updated unread counts:', newUnreadCounts);
  }, [state.channels, state.agents, state.messages]);

  // Update unread counts whenever messages change
  useEffect(() => {
    updateUnreadCounts();
  }, [state.messages, updateUnreadCounts]);

  // Start/stop periodic message checking
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Start periodic checking if we have a connection and an active channel/DM
    const connection = connectionRef.current;
    if (connection && connection.isConnected() && (state.currentChannel || state.currentDirectMessage)) {
      console.log('🔄 [PERIODIC] Starting periodic message checking every 10 seconds');
      intervalRef.current = setInterval(checkForNewMessages, 10000); // Check every 10 seconds (reduced frequency)
    }

    // Cleanup function
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.currentChannel, state.currentDirectMessage, checkForNewMessages, connectionStatus]);

  const selectChannel = useCallback((channelName: string) => {
    console.log(`📂 Selecting channel: ${channelName}`);
    
    setState(prev => ({
      ...prev,
      currentChannel: channelName,
      currentDirectMessage: null,
      showDocuments: false
    }));
    
    // Mark all existing messages in the channel as read
    const channelKey = `channel_${channelName}`;
    const channelMessages = state.messages[channelKey] || [];
    if (channelMessages.length > 0 && readMessageStoreRef.current) {
      const messageIds = channelMessages.map(msg => msg.message_id);
      readMessageStoreRef.current.markMultipleAsRead(messageIds);
      console.log(`📖 Marked ${messageIds.length} existing messages as read when entering channel: ${channelName}`);
    }
    
    if (connection && connection.isConnected()) {
      // Add a small delay to prevent rapid-fire requests during channel switching
      setTimeout(() => {
        if (connection.isConnected()) {
          connection.retrieveChannelMessages(channelName, 50, 0, true);
        } else {
          console.warn('⚠️ Skipping channel message retrieval - connection lost');
        }
      }, 100);
    } else {
      console.warn('⚠️ Cannot retrieve messages - no connection');
    }
  }, [connection, state.messages]);

  const selectDirectMessage = useCallback((agentId: string) => {
    console.log(`📱 Selecting direct message with: ${agentId}`);
    
    setState(prev => ({
      ...prev,
      currentChannel: null,
      currentDirectMessage: agentId,
      showDocuments: false
    }));
    
    // Mark all existing direct messages with this agent as read
    const dmKey = `dm_${agentId}`;
    const dmMessages = state.messages[dmKey] || [];
    if (dmMessages.length > 0 && readMessageStoreRef.current) {
      const messageIds = dmMessages.map(msg => msg.message_id);
      readMessageStoreRef.current.markMultipleAsRead(messageIds);
      console.log(`📖 Marked ${messageIds.length} existing DM messages as read when entering conversation with: ${agentId}`);
    }
    
    if (connection && connection.isConnected()) {
      // Add a small delay to prevent rapid-fire requests during agent switching
      setTimeout(() => {
        if (connection.isConnected()) {
          connection.retrieveDirectMessages(agentId, 50, 0, true);
        } else {
          console.warn('⚠️ Skipping direct message retrieval - connection lost');
        }
      }, 100);
    } else {
      console.warn('⚠️ Cannot retrieve direct messages - no connection');
    }
  }, [connection, state.messages]);

  // Expose state and functions via ref
  React.useImperativeHandle(ref, () => ({
    getState: () => state,
    selectChannel: selectChannel,
    selectDirectMessage: selectDirectMessage
  }), [state, selectChannel, selectDirectMessage]);

  const sendMessage = useCallback(async (text: string, replyTo?: string, quotedMessageId?: string, attachmentData?: {
    file_id: string;
    filename: string;
    size: number;
  }) => {
    if (!connection || !text.trim()) return;
    
    
    // If we have attachment data, cache it temporarily with the message text as a key
    if (attachmentData && pendingAttachmentsRef.current) {
      const messageKey = `${text}_${Date.now()}`;
      pendingAttachmentsRef.current.set(messageKey, {
        file_id: attachmentData.file_id,
        filename: attachmentData.filename,
        size: attachmentData.size,
        timestamp: Date.now()
      });
      
      // Clean up old cached attachments (older than 30 seconds)
      const cutoffTime = Date.now() - 30000;
      const entriesToDelete: string[] = [];
      Array.from(pendingAttachmentsRef.current.entries()).forEach(([key, data]) => {
        if (data.timestamp < cutoffTime) {
          entriesToDelete.push(key);
        }
      });
      entriesToDelete.forEach(key => {
        if (pendingAttachmentsRef.current) {
          pendingAttachmentsRef.current.delete(key);
        }
      });
    }
    
    if (state.currentChannel) {
      if (replyTo) {
        // TODO: Update replyToMessage to support attachments when needed
        await connection.replyToMessage(replyTo, text, state.currentChannel, undefined, quotedMessageId);
      } else {
        // Use the new sendMessage method that supports attachments
        await connection.sendMessage(text, state.currentChannel, undefined, undefined, quotedMessageId, undefined, attachmentData);
      }
      
      // Immediately refresh channel messages after sending to ensure attachment data is preserved
      setTimeout(() => {
        if (connection && state.currentChannel) {
          console.log('🔄 Auto-refreshing channel messages after sending');
          setIsRefreshing(true);
          connection.retrieveChannelMessages(state.currentChannel, 50, 0, true);
          // Hide refreshing indicator after a short delay
          setTimeout(() => setIsRefreshing(false), 1000);
        }
      }, 100); // Reduced delay to minimize time without attachment data
      
    } else if (state.currentDirectMessage) {
      if (replyTo) {
        await connection.replyToMessage(replyTo, text, undefined, state.currentDirectMessage, quotedMessageId);
      } else {
        await connection.sendDirectMessage(state.currentDirectMessage, text, quotedMessageId);
      }
      
      // Automatically refresh direct messages after sending
      setTimeout(() => {
        if (connection && state.currentDirectMessage) {
          console.log('🔄 Auto-refreshing direct messages after sending');
          setIsRefreshing(true);
          connection.retrieveDirectMessages(state.currentDirectMessage, 50, 0);
          // Hide refreshing indicator after a short delay
          setTimeout(() => setIsRefreshing(false), 1000);
        }
      }, 500);
    }
    
    // Clear reply and quote state after sending
    setReplyingTo(null);
    setQuotingMessage(null);
  }, [connection, state.currentChannel, state.currentDirectMessage]);

  const addReaction = useCallback(async (messageId: string, reactionType: string) => {
    if (connection) {
      await connection.reactToMessage(messageId, reactionType, 'add', state.currentChannel || undefined);
      
      // Automatically refresh messages after reacting to see updated reactions
      setTimeout(() => {
        if (connection) {
          setIsRefreshing(true);
          if (state.currentChannel) {
            console.log('🔄 Auto-refreshing channel messages after reaction');
            connection.retrieveChannelMessages(state.currentChannel, 50, 0, true);
          } else if (state.currentDirectMessage) {
            console.log('🔄 Auto-refreshing direct messages after reaction');
            connection.retrieveDirectMessages(state.currentDirectMessage, 50, 0);
          }
          // Hide refreshing indicator after a short delay
          setTimeout(() => setIsRefreshing(false), 800);
        }
      }, 300); // Shorter delay for reactions
    }
  }, [connection, state.currentChannel, state.currentDirectMessage]);

  const startReply = useCallback((messageId: string, text: string, author: string) => {
    setReplyingTo({ messageId, text, author });
    setQuotingMessage(null); // Clear quote if replying
  }, []);

  const startQuote = useCallback((messageId: string, text: string, author: string) => {
    setQuotingMessage({ messageId, text, author });
    setReplyingTo(null); // Clear reply if quoting
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const cancelQuote = useCallback(() => {
    setQuotingMessage(null);
  }, []);

  const retry = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
    window.location.reload();
  }, []);

  // Get current conversation messages
  const getCurrentMessages = (): ThreadMessage[] => {
    if (state.currentChannel) {
      return state.messages[`channel_${state.currentChannel}`] || [];
    } else if (state.currentDirectMessage) {
      return state.messages[`dm_${state.currentDirectMessage}`] || [];
    }
    return [];
  };

  const getCurrentTitle = (): string => {
    if (state.showDocuments) {
      return '📄 Shared Documents';
    } else if (state.currentChannel) {
      const channel = state.channels.find(c => c.name === state.currentChannel);
      return `#${state.currentChannel}`;
    } else if (state.currentDirectMessage) {
      return `@${state.currentDirectMessage}`;
    }
    return 'Thread Messaging';
  };

  const getCurrentSubtitle = (): string => {
    if (state.currentChannel) {
      const channel = state.channels.find(c => c.name === state.currentChannel);
      return channel?.description || '';
    } else if (state.currentDirectMessage) {
      return 'Direct Message';
    }
    return '';
  };

  if (state.error) {
    const isModError = state.error.includes('does not support thread messaging');
    
    return (
      <div className={`thread-messaging-container ${currentTheme}`}>
        <style>{styles}</style>
        <div className={`error-screen ${currentTheme}`}>
          <h2>{isModError ? 'Incompatible Network' : 'Connection Error'}</h2>
          <p>{state.error}</p>
          
          {isModError && (
            <div style={{ marginTop: '16px', padding: '16px', backgroundColor: currentTheme === 'dark' ? '#1e293b' : '#f1f5f9', borderRadius: '8px', textAlign: 'left' }}>
              <h3 style={{ marginTop: '0', fontSize: '16px', color: currentTheme === 'dark' ? '#f1f5f9' : '#1e293b' }}>
                💡 To use Thread Messaging:
              </h3>
              <ul style={{ color: currentTheme === 'dark' ? '#cbd5e1' : '#475569', fontSize: '14px' }}>
                <li>Connect to a network with <code>thread_messaging</code> mod</li>
                <li>Or start a local network with: <code>examples/thread_messaging_network/network_config.yaml</code></li>
                <li>Use manual connection with host/port of a thread messaging network</li>
              </ul>
              <p style={{ fontSize: '12px', color: currentTheme === 'dark' ? '#94a3b8' : '#64748b', marginBottom: '0' }}>
                Current network has: <code>simple_messaging</code> (basic chat only)
              </p>
            </div>
          )}
          
          <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
            <button className="retry-button" onClick={retry}>
              {isModError ? 'Try Different Network' : 'Retry Connection'}
            </button>
            
            {!isModError && (
              <button 
                className="retry-button" 
                style={{ background: '#059669' }}
                onClick={() => {
                  // Test gRPC connection via HTTP adapter
                  const httpPort = networkConnection.port + 1000;
                  const testUrl = `http://${networkConnection.host}:${httpPort}/api/register`;
                  console.log('🧪 Manual gRPC HTTP test to:', testUrl);
                  
                  fetch(testUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      agent_id: 'manual_test',
                      metadata: { test: true },
                      capabilities: []
                    })
                  })
                  .then(response => response.json())
                  .then(data => {
                    console.log('✅ Manual test: gRPC HTTP response:', data);
                  })
                  .catch(error => {
                    console.error('❌ Manual test: gRPC HTTP error:', error);
                  });
                }}
              >
                Test gRPC Connection
              </button>
            )}
            
            {isModError && (
              <button 
                className="retry-button" 
                style={{ background: '#6b7280' }}
                onClick={() => {
                  // Go back to network selection
                  window.location.reload();
                }}
              >
                Back to Network Selection
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div className={`thread-messaging-container ${currentTheme}`}>
        <style>{styles}</style>
        <div className={`loading-screen ${currentTheme}`}>
          <div className="loading-spinner">🔄</div>
          <p>Connecting to thread messaging...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`thread-messaging-container ${currentTheme}`}>
      <style>{styles}</style>
      

      
      <div className="thread-messaging-main">
        <div className={`thread-messaging-header ${currentTheme}`}>
          <div>
            <h1 className={`header-title ${currentTheme}`}>
              {getCurrentTitle()}
            </h1>
            {getCurrentSubtitle() && (
              <p className={`header-subtitle ${currentTheme}`}>
                {getCurrentSubtitle()}
              </p>
            )}
          </div>
          
          <div className="connection-status">
            <div className={`status-indicator ${connectionStatus}`} />
            <span className={currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
              {connectionStatus === 'connected' ? 'Connected' : 
               connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </span>
            
            {/* Manual refresh button */}
            <button
              onClick={() => {
                if (connection && !isRefreshing) {
                  setIsRefreshing(true);
                  if (state.currentChannel) {
                    console.log('🔄 Manual refresh: channel messages');
                    connection.retrieveChannelMessages(state.currentChannel, 50, 0, true);
                  } else if (state.currentDirectMessage) {
                    console.log('🔄 Manual refresh: direct messages');
                    connection.retrieveDirectMessages(state.currentDirectMessage, 50, 0);
                  }
                  setTimeout(() => setIsRefreshing(false), 1000);
                }
              }}
              disabled={!connection || isRefreshing}
              className={`action-button ${currentTheme} ${isRefreshing ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="Refresh messages"
              style={{ 
                background: 'none', 
                border: 'none', 
                padding: '6px', 
                borderRadius: '6px',
                fontSize: '14px',
                cursor: isRefreshing ? 'not-allowed' : 'pointer',
                marginLeft: '8px'
              }}
            >
              🔄
            </button>
            
            {/* Refreshing indicator */}
            <div className={`refreshing-indicator ${isRefreshing ? 'visible' : ''} ${currentTheme}`}>
              <div className={`refresh-spinner ${currentTheme}`}></div>
              <span>Refreshing...</span>
            </div>
          </div>
        </div>
        
        {state.showDocuments ? (
          <DocumentsView
            onBackClick={() => setState(prev => ({ ...prev, showDocuments: false }))}
            currentTheme={currentTheme}
          />
        ) : (
          <>
            <MessageDisplay
              messages={getCurrentMessages()}
              currentUserId={currentAgentId}
              onReply={startReply}
              onQuote={startQuote}
              onReaction={addReaction}
              currentTheme={currentTheme}
            />
            
            <MessageInput
              onSendMessage={sendMessage}
              currentTheme={currentTheme}
              placeholder={
                state.currentChannel ? `Message #${state.currentChannel}` :
                state.currentDirectMessage ? `Message @${state.currentDirectMessage}` :
                'Select a channel or agent to start messaging'
              }
              disabled={!state.currentChannel && !state.currentDirectMessage}
              agents={state.agents}
              replyingTo={replyingTo}
              quotingMessage={quotingMessage}
              onCancelReply={cancelReply}
              onCancelQuote={cancelQuote}
              currentChannel={state.currentChannel || undefined}
              currentAgentId={connection?.getAgentId()}
            />
          </>
        )}
      </div>
    </div>
  );
});

ThreadMessagingView.displayName = 'ThreadMessagingView';

export default ThreadMessagingView;
