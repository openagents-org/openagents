import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HttpEventConnector } from '../services/eventConnector';
import { useAuthStore } from '../stores/authStore';
import { eventRouter } from '../services/eventRouter';

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

export interface ConnectionStatus {
  state: ConnectionState;
  agentId?: string;
  originalAgentId?: string;
  isUsingModifiedId?: boolean;
  error?: string;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
}

interface OpenAgentsContextType {
  connector: HttpEventConnector | null;
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  clearError: () => void;
}

export const OpenAgentsContext = createContext<
  OpenAgentsContextType | undefined
>(undefined);

interface OpenAgentsProviderProps {
  children: ReactNode;
}

export const OpenAgentsProvider: React.FC<OpenAgentsProviderProps> = ({
  children,
}) => {
  const { agentName, selectedNetwork, getPasswordHash } = useAuthStore();
  const navigate = useNavigate();
  const [connector, setConnector] = useState<HttpEventConnector | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    state: ConnectionState.DISCONNECTED,
  });

  const connectorRef = useRef<HttpEventConnector | null>(null);

  const cleanUpConnector = useCallback(() => {
    if (connectorRef.current) {
      const connectorTemp = connectorRef.current;
      connectorRef.current = null;
      setConnector(null);
      setConnectionStatus({
        state: ConnectionState.DISCONNECTED,
      });
      eventRouter.cleanup();
      connectorTemp.disconnect().catch((error) => {
        console.warn('Error during connector cleanup:', error);
      });
    }
  }, []);

  const setupConnectionListeners = useCallback(
    (newConnector: HttpEventConnector) => {
      newConnector.on('connected', () => {
        setConnectionStatus({
          state: ConnectionState.CONNECTED,
          agentId: newConnector.getAgentId(),
          originalAgentId: newConnector.getOriginalAgentId(),
          isUsingModifiedId: newConnector.isUsingModifiedId(),
        });
        eventRouter.initialize(newConnector);
      });

      newConnector.on('disconnected', () => {
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.DISCONNECTED,
          error: undefined,
        }));
      });

      newConnector.on('connectionError', (data: any) => {
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.ERROR,
          error: data.error || 'Connection error',
        }));
      });

      newConnector.on('reconnecting', (data: any) => {
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.RECONNECTING,
          reconnectAttempt: data.attempt,
          maxReconnectAttempts: data.maxAttempts,
          error: undefined,
        }));
        if (data.attempt === data.maxAttempts) {
          setConnectionStatus((prev) => ({
            ...prev,
            state: ConnectionState.ERROR,
            error: 'Failed to reconnect',
          }));
        }
      });

      newConnector.on('reconnected', () => {
        setConnectionStatus({
          state: ConnectionState.CONNECTED,
          agentId: newConnector.getAgentId(),
          originalAgentId: newConnector.getOriginalAgentId(),
          isUsingModifiedId: newConnector.isUsingModifiedId(),
          reconnectAttempt: undefined,
          maxReconnectAttempts: undefined,
        });
      });

      newConnector.on('connectionLost', (data: any) => {
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.ERROR,
          error: data.reason || 'Connection lost',
        }));
      });

      newConnector.on('system.kicked', (event: any) => {
        const kickedBy = event.payload?.kicked_by || event.kicked_by || 'admin';
        toast.error(`You have been kicked by ${kickedBy}`, {
          description: 'You will be redirected to network selection',
        });

        setTimeout(() => {
          useAuthStore.getState().clearNetwork();
          useAuthStore.getState().clearAgentName();
          useAuthStore.getState().clearPasswordHash();
          navigate('/', { replace: true });
        }, 2000);
      });

      eventRouter.initialize(newConnector);
    },
    [navigate]
  );

  const initializeConnector = useCallback(() => {
    if (!agentName || !selectedNetwork?.host || !selectedNetwork?.port) {
      return;
    }

    const passwordHash = getPasswordHash();

    const newConnector = new HttpEventConnector({
      agentId: agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
      passwordHash,
    });

    setupConnectionListeners(newConnector);

    connectorRef.current = newConnector;
    setConnector(newConnector);

    newConnector.connect().catch((error) => {
      setConnectionStatus((prev) => ({
        ...prev,
        state: ConnectionState.ERROR,
        error: `Auto-connect failed: ${error.message}`,
      }));
    });
  }, [
    agentName,
    selectedNetwork?.host,
    selectedNetwork?.port,
    getPasswordHash,
    setupConnectionListeners,
  ]);

  useEffect(() => {
    cleanUpConnector();
    initializeConnector();
  }, [cleanUpConnector, initializeConnector]);

  useEffect(() => {
    return () => {
      cleanUpConnector();
    };
  }, [cleanUpConnector]);

  const connect = useCallback(async (): Promise<boolean> => {
    if (!connector) {
      return false;
    }

    setConnectionStatus((prev) => ({
      ...prev,
      state: ConnectionState.CONNECTING,
      error: undefined,
    }));

    try {
      const success = await connector.connect();
      if (!success) {
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.ERROR,
          error: 'Failed to connect to OpenAgents network',
        }));
      }
      return success;
    } catch (error: any) {
      setConnectionStatus((prev) => ({
        ...prev,
        state: ConnectionState.ERROR,
        error: error.message || 'Connection error',
      }));
      return false;
    }
  }, [connector]);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connector) return;

    try {
      await connector.disconnect();
    } catch (error: any) {
      console.error('Disconnect error:', error);
    }
  }, [connector]);

  const clearError = useCallback(() => {
    setConnectionStatus((prev) => ({
      ...prev,
      error: undefined,
    }));
  }, []);

  const isConnected = connectionStatus.state === ConnectionState.CONNECTED;

  const value: OpenAgentsContextType = {
    connector,
    connectionStatus,
    isConnected,
    connect,
    disconnect,
    clearError,
  };

  useEffect(() => {
    // @ts-ignore
    window.__OPENAGENTS_CONTEXT__ = value;
    return () => {
      // @ts-ignore
      delete window.__OPENAGENTS_CONTEXT__;
    };
  }, [value]);

  return (
    <OpenAgentsContext.Provider value={value}>
      {children}
    </OpenAgentsContext.Provider>
  );
};

export const useOpenAgents = (): OpenAgentsContextType => {
  const context = useContext(OpenAgentsContext);
  if (context === undefined) {
    throw new Error('useOpenAgents must be used within an OpenAgentsProvider');
  }
  return context;
};

