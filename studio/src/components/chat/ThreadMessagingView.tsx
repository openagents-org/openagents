import React, { useState, useEffect, useRef, useCallback } from 'react';
import { OpenAgentsConnection, ThreadMessage, ThreadMessagingChannel, AgentInfo } from '../../services/openagentsService';
import { NetworkConnection } from '../../services/networkService';
import ChannelSidebar from './ChannelSidebar';
import MessageDisplay from './MessageDisplay';
import MessageInput from './ThreadMessageInput';

interface ThreadMessagingViewProps {
  networkConnection: NetworkConnection;
  agentName: string;
  currentTheme: 'light' | 'dark';
}

export interface ThreadState {
  currentChannel: string | null;
  currentDirectMessage: string | null; // agent_id for DM conversations
  channels: ThreadMessagingChannel[];
  agents: AgentInfo[];
  messages: { [key: string]: ThreadMessage[] }; // channel/dm_agent_id -> messages
  isLoading: boolean;
  error: string | null;
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
`;

const ThreadMessagingView: React.FC<ThreadMessagingViewProps> = ({
  networkConnection,
  agentName,
  currentTheme
}) => {
  const [connection, setConnection] = useState<OpenAgentsConnection | null>(null);
  const [state, setState] = useState<ThreadState>({
    currentChannel: null,
    currentDirectMessage: null,
    channels: [],
    agents: [],
    messages: {},
    isLoading: true,
    error: null
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
  const connectionRef = useRef<OpenAgentsConnection | null>(null);
  const [currentAgentId, setCurrentAgentId] = useState(agentName);

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

        const conn = new OpenAgentsConnection(agentName, networkConnection);
        connectionRef.current = conn;

        // Set up event handlers
        conn.on('message', handleMessage);
        conn.on('channels', handleChannelsList);
        conn.on('channel_messages', handleChannelMessages);  
        conn.on('direct_messages', handleDirectMessages);
        conn.on('agents', handleAgentsList);
        conn.on('reaction', handleReaction);

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

        // Load initial data
        console.log('📤 Requesting initial channels list...');
        conn.listChannels();
        
        console.log('📤 Requesting agents list...');
        conn.listAgents().then((agents) => {
          console.log('👥 Network agents received:', agents);
          handleAgentsList(agents);
        }).catch((error) => {
          console.error('❌ Failed to get agents:', error);
        });
        
        // Also try sending a test message to trigger channel creation
        console.log('📤 Sending test message to general channel...');
        setTimeout(() => {
          conn.sendChannelMessage('general', 'Hello from OpenAgents Studio!');
        }, 2000);
        

        
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
      if (connectionRef.current) {
        console.log('🔌 Cleaning up connection on unmount');
        connectionRef.current.disconnect();
        connectionRef.current = null;
      }
    };
  }, [networkConnection, agentName]);

  const handleMessage = useCallback((message: ThreadMessage) => {
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
        newMessages[conversationKey].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }
      
      return { ...prev, messages: newMessages };
    });
  }, [currentAgentId]);

  const handleChannelsList = useCallback((channels: ThreadMessagingChannel[]) => {
    console.log('📋 Received channels list:', channels);
    console.log('✅ Setting channels count:', channels?.length || 0);
    setState(prev => ({ 
      ...prev, 
      channels: channels || [],
      currentChannel: prev.currentChannel || (channels?.length > 0 ? channels[0].name : null)
    }));
    
    // Load messages for the first channel
    if (channels.length > 0 && connection) {
      const firstChannel = channels[0].name;
      connection.retrieveChannelMessages(firstChannel, 50, 0, true);
    }
  }, [connection]);

  const handleAgentsList = useCallback((agents: AgentInfo[]) => {
    console.log('👥 Received agents list:', agents);
    console.log('✅ Setting agents count:', agents?.length || 0);
    setState(prev => ({ ...prev, agents: agents || [] }));
  }, []);

  const handleChannelMessages = useCallback((data: any) => {
    const { channel, messages } = data;
    console.log('📥 Handling channel messages for:', channel);
    console.log('📥 Messages received:', messages?.length || 0);
    
    // Debug: Check for reactions in messages
    if (messages && messages.length > 0) {
      const messagesWithReactions = messages.filter((msg: any) => msg.reactions && Object.keys(msg.reactions).length > 0);
      if (messagesWithReactions.length > 0) {
        console.log('🎭 Found messages with reactions:', messagesWithReactions.length);
        messagesWithReactions.forEach((msg: any) => {
          console.log(`🎭 Message ${msg.message_id} reactions:`, msg.reactions);
        });
      }
    }
    
    setState(prev => ({
      ...prev,
      messages: {
        ...prev.messages,
        [`channel_${channel}`]: (messages || []).sort((a: ThreadMessage, b: ThreadMessage) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      }
    }));
  }, []);

  const handleDirectMessages = useCallback((data: any) => {
    const { target_agent_id, messages } = data;
    setState(prev => ({
      ...prev,
      messages: {
        ...prev.messages,
        [`dm_${target_agent_id}`]: (messages || []).sort((a: ThreadMessage, b: ThreadMessage) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      }
    }));
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

  const selectChannel = useCallback((channelName: string) => {
    setState(prev => ({
      ...prev,
      currentChannel: channelName,
      currentDirectMessage: null
    }));
    
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
  }, [connection]);

  const selectDirectMessage = useCallback((agentId: string) => {
    setState(prev => ({
      ...prev,
      currentChannel: null,
      currentDirectMessage: agentId
    }));
    
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
  }, [connection]);

  const sendMessage = useCallback((text: string, replyTo?: string, quotedMessageId?: string) => {
    if (!connection || !text.trim()) return;
    
    if (state.currentChannel) {
      if (replyTo) {
        connection.replyToMessage(replyTo, text, state.currentChannel, undefined, quotedMessageId);
      } else {
        connection.sendChannelMessage(state.currentChannel, text, undefined, quotedMessageId);
      }
    } else if (state.currentDirectMessage) {
      if (replyTo) {
        connection.replyToMessage(replyTo, text, undefined, state.currentDirectMessage, quotedMessageId);
      } else {
        connection.sendDirectMessage(state.currentDirectMessage, text, quotedMessageId);
      }
    }
    
    // Clear reply and quote state after sending
    setReplyingTo(null);
    setQuotingMessage(null);
  }, [connection, state.currentChannel, state.currentDirectMessage]);

  const addReaction = useCallback((messageId: string, reactionType: string) => {
    if (connection) {
      connection.reactToMessage(messageId, reactionType, 'add', state.currentChannel || undefined);
    }
  }, [connection, state.currentChannel]);

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
    if (state.currentChannel) {
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
                  // Test WebSocket connection manually
                  const wsUrl = `ws://${networkConnection.host}:${networkConnection.port}`;
                  console.log('🧪 Manual WebSocket test to:', wsUrl);
                  
                  const testWs = new WebSocket(wsUrl);
                  testWs.onopen = () => {
                    console.log('✅ Manual test: WebSocket opened successfully');
                    testWs.close();
                  };
                  testWs.onerror = (error) => {
                    console.error('❌ Manual test: WebSocket error:', error);
                  };
                  testWs.onclose = (event) => {
                    console.log('Manual test: WebSocket closed:', event.code, event.reason);
                  };
                }}
              >
                Test WebSocket
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
      
      <ChannelSidebar
        channels={state.channels}
        agents={state.agents}
        currentChannel={state.currentChannel}
        currentDirectMessage={state.currentDirectMessage}
        onSelectChannel={selectChannel}
        onSelectDirectMessage={selectDirectMessage}
        currentTheme={currentTheme}
      />
      
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
          </div>
        </div>
        
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
          replyingTo={replyingTo}
          quotingMessage={quotingMessage}
          onCancelReply={cancelReply}
          onCancelQuote={cancelQuote}
        />
      </div>
    </div>
  );
};

export default ThreadMessagingView;
