/**
 * 全局连接层 - OpenAgentsService Context
 *
 * 职责：
 * 1. 维护单一的 OpenAgentsService 实例
 * 2. 管理连接状态
 * 3. 提供基础 API（发送消息、连接管理等）
 * 4. 作为事件总线，让组件可以订阅事件
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { OpenAgentsService } from '@/services/openAgentsService';
import { ConnectionStatus, ConnectionStatusEnum } from '@/types/connection';
import { useNetworkStore } from '@/stores/networkStore';
import { ThreadMessage, ThreadChannel, AgentInfo } from '@/types/events';

interface OpenAgentsServiceContextType {
  // 服务实例（作为事件总线）
  service: OpenAgentsService | null;

  // 连接管理
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;

  // 基础 API
  sendChannelMessage: (channel: string, content: string, replyToId?: string) => Promise<any>;
  sendDirectMessage: (targetAgentId: string, content: string) => Promise<any>;
  addReaction: (messageId: string, reactionType: string, channel?: string) => Promise<any>;
  removeReaction: (messageId: string, reactionType: string, channel?: string) => Promise<any>;

  // 数据加载 API
  loadChannels: () => Promise<ThreadChannel[]>;
  loadChannelMessages: (channel: string, limit?: number, offset?: number) => Promise<ThreadMessage[]>;
  loadDirectMessages: (targetAgentId: string, limit?: number, offset?: number) => Promise<ThreadMessage[]>;
  loadConnectedAgents: () => Promise<AgentInfo[]>;

  // 错误处理
  lastError: string | null;
  clearError: () => void;
}

const OpenAgentsServiceContext = createContext<OpenAgentsServiceContextType | undefined>(undefined);

interface OpenAgentsServiceProviderProps {
  children: ReactNode;
}

export const OpenAgentsServiceProvider: React.FC<OpenAgentsServiceProviderProps> = ({ children }) => {
  const { agentName, selectedNetwork } = useNetworkStore();
  const [service, setService] = useState<OpenAgentsService | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: ConnectionStatusEnum.DISCONNECTED,
  });
  const [lastError, setLastError] = useState<string | null>(null);

  const serviceRef = useRef<OpenAgentsService | null>(null);

  // 清理服务
  const cleanUpService = useCallback(() => {
    if (serviceRef.current) {
      console.log('🔧 Cleaning up global OpenAgents service');
      const serviceTemp = serviceRef.current;
      serviceRef.current = null;
      setService(null);
      serviceTemp.disconnect().catch((error) => {
        console.warn('Error during service cleanup:', error);
      });
    }
  }, []);

  // 初始化服务
  const initializeService = useCallback(() => {
    if (!agentName || !selectedNetwork?.host || !selectedNetwork?.port) {
      return;
    }

    console.log('🔧 Initializing global OpenAgents service...', {
      agentId: agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
    });

    const newService = new OpenAgentsService({
      agentId: agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
    });

    // 设置连接状态监听
    newService.on('connectionStatusChanged', (status: ConnectionStatus) => {
      setConnectionStatus(status);
    });

    newService.on('connectionError', (data: any) => {
      setLastError(data.error || 'Connection error');
    });

    // 注意：这里不处理消息事件，让组件层自己订阅
    // newChannelMessage, newDirectMessage, newReaction 等事件
    // 由使用 useOpenAgentsData 的组件自己订阅

    serviceRef.current = newService;
    setService(newService);

    // 自动连接
    newService.connect().catch((error) => {
      setLastError(`Auto-connect failed: ${error.message}`);
    });
  }, [agentName, selectedNetwork?.host, selectedNetwork?.port]);

  // 初始化和清理
  useEffect(() => {
    cleanUpService();
    initializeService();
  }, [cleanUpService, initializeService]);

  useEffect(() => {
    return () => {
      cleanUpService();
    };
  }, [cleanUpService]);

  // API 方法
  const connect = useCallback(async (): Promise<boolean> => {
    if (!service) return false;

    setLastError(null);
    try {
      const success = await service.connect();
      if (!success) {
        setLastError('Failed to connect to OpenAgents network');
      }
      return success;
    } catch (error: any) {
      setLastError(error.message || 'Connection error');
      return false;
    }
  }, [service]);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!service) return;

    try {
      await service.disconnect();
    } catch (error: any) {
      console.error('Disconnect error:', error);
    }
  }, [service]);

  const sendChannelMessage = useCallback(async (
    channel: string,
    content: string,
    replyToId?: string
  ) => {
    if (!service) {
      throw new Error('Not connected to service');
    }

    setLastError(null);
    try {
      const result = await service.sendChannelMessage(channel, content, replyToId);
      if (!result.success && result.message) {
        setLastError(result.message);
      }
      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to send message';
      setLastError(errorMsg);
      throw error;
    }
  }, [service]);

  const sendDirectMessage = useCallback(async (
    targetAgentId: string,
    content: string
  ) => {
    if (!service) {
      throw new Error('Not connected to service');
    }

    setLastError(null);
    try {
      const result = await service.sendDirectMessage(targetAgentId, content);
      if (!result.success && result.message) {
        setLastError(result.message);
      }
      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to send direct message';
      setLastError(errorMsg);
      throw error;
    }
  }, [service]);

  const addReaction = useCallback(async (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => {
    if (!service) {
      throw new Error('Not connected to service');
    }

    try {
      const result = await service.addReaction(messageId, reactionType, channel);
      if (!result.success && result.message) {
        setLastError(result.message);
      }
      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to add reaction';
      setLastError(errorMsg);
      throw error;
    }
  }, [service]);

  const removeReaction = useCallback(async (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => {
    if (!service) {
      throw new Error('Not connected to service');
    }

    try {
      const result = await service.removeReaction(messageId, reactionType, channel);
      if (!result.success && result.message) {
        setLastError(result.message);
      }
      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to remove reaction';
      setLastError(errorMsg);
      throw error;
    }
  }, [service]);

  const loadChannels = useCallback(async (): Promise<ThreadChannel[]> => {
    if (!service) return [];

    setLastError(null);
    try {
      return await service.getChannels();
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to load channels';
      setLastError(errorMsg);
      return [];
    }
  }, [service]);

  const loadChannelMessages = useCallback(async (
    channel: string,
    limit?: number,
    offset?: number
  ): Promise<ThreadMessage[]> => {
    if (!service) return [];

    setLastError(null);
    try {
      return await service.getChannelMessages(channel, limit, offset);
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to load messages';
      setLastError(errorMsg);
      return [];
    }
  }, [service]);

  const loadDirectMessages = useCallback(async (
    targetAgentId: string,
    limit?: number,
    offset?: number
  ): Promise<ThreadMessage[]> => {
    if (!service) return [];

    setLastError(null);
    try {
      return await service.getDirectMessages(targetAgentId, limit, offset);
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to load direct messages';
      setLastError(errorMsg);
      return [];
    }
  }, [service]);

  const loadConnectedAgents = useCallback(async (): Promise<AgentInfo[]> => {
    if (!service) return [];

    setLastError(null);
    try {
      return await service.getConnectedAgents();
    } catch (error: any) {
      const errorMsg = error.message || 'Failed to load connected agents';
      setLastError(errorMsg);
      return [];
    }
  }, [service]);

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  const isConnected = connectionStatus.status === ConnectionStatusEnum.CONNECTED;

  const value: OpenAgentsServiceContextType = {
    service,
    connectionStatus,
    isConnected,
    connect,
    disconnect,
    sendChannelMessage,
    sendDirectMessage,
    addReaction,
    removeReaction,
    loadChannels,
    loadChannelMessages,
    loadDirectMessages,
    loadConnectedAgents,
    lastError,
    clearError,
  };

  return (
    <OpenAgentsServiceContext.Provider value={value}>
      {children}
    </OpenAgentsServiceContext.Provider>
  );
};

export const useOpenAgentsService = (): OpenAgentsServiceContextType => {
  const context = useContext(OpenAgentsServiceContext);
  if (context === undefined) {
    throw new Error('useOpenAgentsService must be used within an OpenAgentsServiceProvider');
  }
  return context;
};