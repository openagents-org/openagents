import { useState, useEffect, useRef, useCallback } from 'react';
import { OpenAgentsConnection, ThreadMessage, ThreadMessagingChannel, AgentInfo } from '../services/openagentsService';
import { NetworkConnection } from '../services/networkService';
import { ReadMessageStore } from '../utils/readMessageStore';
import { mentionNotifier } from '../utils/mentionNotifier';

export interface ThreadMessagingState {
  currentChannel: string | null;
  currentDirectMessage: string | null;
  channels: ThreadMessagingChannel[];
  agents: AgentInfo[];
  messages: { [key: string]: ThreadMessage[] };
  isLoading: boolean;
  error: string | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  unreadCounts: Record<string, number>;
}

export interface UseThreadMessagingReturn {
  state: ThreadMessagingState;
  connection: OpenAgentsConnection | null;
  setCurrentChannel: (channel: string | null) => void;
  setCurrentDirectMessage: (agentId: string | null) => void;
  sendChannelMessage: (channel: string, message: string) => void;
  sendDirectMessage: (targetAgentId: string, message: string) => void;
  refreshChannels: () => void;
  refreshAgents: () => void;
}

export const useThreadMessaging = (
  networkConnection: NetworkConnection | null,
  agentName: string | null
): UseThreadMessagingReturn => {
  const [state, setState] = useState<ThreadMessagingState>({
    currentChannel: null,
    currentDirectMessage: null,
    channels: [],
    agents: [],
    messages: {},
    isLoading: true,
    error: null,
    connectionStatus: 'connecting',
    unreadCounts: {}
  });

  const [connection, setConnection] = useState<OpenAgentsConnection | null>(null);
  const connectionRef = useRef<OpenAgentsConnection | null>(null);
  const readMessageStoreRef = useRef<ReadMessageStore | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Event handlers
  const handleMessage = useCallback((message: ThreadMessage) => {
    setState(prev => {
      const newMessages = { ...prev.messages };
      
      let conversationKey: string;
      if (message.channel) {
        conversationKey = message.channel;
      } else if (message.sender_id && message.target_agent_id) {
        conversationKey = message.sender_id === agentName ? message.target_agent_id : message.sender_id;
      } else {
        console.warn('⚠️ Message missing channel or target info:', message);
        return prev;
      }
      
      if (!newMessages[conversationKey]) {
        newMessages[conversationKey] = [];
      }
      
      const existingIndex = newMessages[conversationKey].findIndex(m => m.message_id === message.message_id);
      if (existingIndex === -1) {
        newMessages[conversationKey].push(message);
        newMessages[conversationKey].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }
      
      return { ...prev, messages: newMessages };
    });
  }, [agentName]);

  const handleChannelsList = useCallback((channels: ThreadMessagingChannel[]) => {
    console.log('📋 Received channels list:', channels);
    setState(prev => ({ 
      ...prev, 
      channels: channels || [],
      currentChannel: prev.currentChannel || (channels?.[0]?.name || 'general')
    }));
  }, []);

  const handleAgentsList = useCallback((agents: AgentInfo[]) => {
    console.log('👥 Received agents list:', agents);
    setState(prev => ({ ...prev, agents: agents || [] }));
  }, []);

  const handleChannelMessages = useCallback((data: any) => {
    const { channel, messages } = data;
    console.log('📥 Handling channel messages for:', channel);
    
    if (messages && messages.length > 0) {
      setState(prev => {
        const newMessages = { ...prev.messages };
        newMessages[channel] = messages.sort((a: ThreadMessage, b: ThreadMessage) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return { ...prev, messages: newMessages };
      });
    }
  }, []);

  const handleDirectMessages = useCallback((data: any) => {
    const { target_agent_id, messages } = data;
    console.log('📥 Handling direct messages for:', target_agent_id);
    
    if (messages && messages.length > 0) {
      setState(prev => {
        const newMessages = { ...prev.messages };
        newMessages[target_agent_id] = messages.sort((a: ThreadMessage, b: ThreadMessage) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return { ...prev, messages: newMessages };
      });
    }
  }, []);

  // Initialize connection
  useEffect(() => {
    if (!networkConnection || !agentName) return;

    let isSubscribed = true;
    
    const initConnection = async () => {
      if (!isSubscribed) return;
      
      try {
        console.log('🔄 Initializing thread messaging connection...');
        setState(prev => ({ ...prev, isLoading: true, error: null, connectionStatus: 'connecting' }));

        const conn = new OpenAgentsConnection(agentName, networkConnection);
        connectionRef.current = conn;

        // Set up event handlers
        conn.on('message', handleMessage);
        conn.on('channels', handleChannelsList);
        conn.on('channel_messages', handleChannelMessages);  
        conn.on('direct_messages', handleDirectMessages);
        conn.on('agents', handleAgentsList);

        // Connect to network
        const connected = await conn.connect();
        if (!connected) {
          throw new Error('Failed to connect to OpenAgents network');
        }

        console.log('✅ Connection established successfully');
        setConnection(conn);
        setState(prev => ({ ...prev, connectionStatus: 'connected' }));

        // Check for thread messaging mod
        const hasThreadMod = await conn.hasThreadMessagingMod();
        if (!hasThreadMod) {
          throw new Error('This network does not support thread messaging.');
        }

        // Load initial data
        setTimeout(() => {
          console.log('📤 Requesting initial channels list...');
          conn.listChannels();
          
          console.log('📤 Requesting agents list...');
          conn.listAgents().then((agents) => {
            console.log('👥 Network agents received:', agents);
            handleAgentsList(agents);
          }).catch((error) => {
            console.error('❌ Failed to get agents:', error);
          });
        }, 500);
        
        setState(prev => ({ ...prev, isLoading: false }));

      } catch (error) {
        console.error('❌ Failed to initialize connection:', error);
        setState(prev => ({ 
          ...prev, 
          isLoading: false, 
          error: error instanceof Error ? error.message : 'Connection failed',
          connectionStatus: 'disconnected'
        }));
      }
    };

    initConnection();

    return () => {
      isSubscribed = false;
      if (connectionRef.current) {
        connectionRef.current.disconnect();
        connectionRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [networkConnection, agentName, handleMessage, handleChannelsList, handleAgentsList, handleChannelMessages, handleDirectMessages]);

  // Initialize mention notifier
  useEffect(() => {
    if (agentName) {
      mentionNotifier.setCurrentUserAgent(agentName);
    }
  }, [agentName]);

  // Initialize read message store
  useEffect(() => {
    if (networkConnection && agentName) {
      const networkHost = networkConnection.host || 'localhost';
      const networkPort = networkConnection.port || 8000;
      readMessageStoreRef.current = new ReadMessageStore(networkHost, networkPort, agentName);
      console.log(`📖 Initialized read message store for ${agentName}@${networkHost}:${networkPort}`);
    }
  }, [networkConnection, agentName]);

  // Action functions
  const setCurrentChannel = useCallback((channel: string | null) => {
    setState(prev => ({ 
      ...prev, 
      currentChannel: channel, 
      currentDirectMessage: null 
    }));
    
    // Load messages for the channel
    if (channel && connection) {
      connection.retrieveChannelMessages(channel, 50, 0);
    }
  }, [connection]);

  const setCurrentDirectMessage = useCallback((agentId: string | null) => {
    setState(prev => ({ 
      ...prev, 
      currentDirectMessage: agentId, 
      currentChannel: null 
    }));
    
    // Load messages for the DM
    if (agentId && connection) {
      connection.retrieveDirectMessages(agentId, 50, 0);
    }
  }, [connection]);

  const sendChannelMessage = useCallback((channel: string, message: string) => {
    if (connection) {
      connection.sendChannelMessage(channel, message);
    }
  }, [connection]);

  const sendDirectMessage = useCallback((targetAgentId: string, message: string) => {
    if (connection) {
      connection.sendDirectMessage(targetAgentId, message);
    }
  }, [connection]);

  const refreshChannels = useCallback(() => {
    if (connection) {
      connection.listChannels();
    }
  }, [connection]);

  const refreshAgents = useCallback(() => {
    if (connection) {
      connection.listAgents().then(handleAgentsList).catch(console.error);
    }
  }, [connection, handleAgentsList]);

  return {
    state,
    connection,
    setCurrentChannel,
    setCurrentDirectMessage,
    sendChannelMessage,
    sendDirectMessage,
    refreshChannels,
    refreshAgents
  };
};
