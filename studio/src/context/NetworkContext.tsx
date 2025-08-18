import React, { createContext, useContext, useState, ReactNode } from 'react';
import { NetworkConnection } from '../services/networkService';

interface NetworkContextType {
  currentNetwork: NetworkConnection | null;
  setCurrentNetwork: (network: NetworkConnection | null) => void;
  isConnected: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export const useNetwork = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};

interface NetworkProviderProps {
  children: ReactNode;
}

export const NetworkProvider: React.FC<NetworkProviderProps> = ({ children }) => {
  const [currentNetwork, setCurrentNetwork] = useState<NetworkConnection | null>(null);

  const isConnected = currentNetwork?.status === 'connected';

  const value: NetworkContextType = {
    currentNetwork,
    setCurrentNetwork,
    isConnected,
  };

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};
