import React, { createContext, useState, useContext, useCallback, useRef, ReactNode } from 'react';
import ConfirmDialog from '../components/ui/ConfirmDialog';

interface ConfirmContextType {
  confirm: (
    title: string,
    message: string,
    options?: {
      confirmText?: string;
      cancelText?: string;
      type?: 'danger' | 'warning' | 'info';
    }
  ) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

interface ConfirmProviderProps {
  children: ReactNode;
}

export const ConfirmProvider: React.FC<ConfirmProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [confirmText, setConfirmText] = useState('Confirm');
  const [cancelText, setCancelText] = useState('Cancel');
  const [dialogType, setDialogType] = useState<'danger' | 'warning' | 'info'>('warning');

  // Use ref instead of state to avoid stale closure issues
  const resolverRef = useRef<(value: boolean) => void>();

  const confirm = useCallback(
    (
      title: string,
      message: string,
      options?: {
        confirmText?: string;
        cancelText?: string;
        type?: 'danger' | 'warning' | 'info';
      }
    ): Promise<boolean> => {
      setTitle(title);
      setMessage(message);
      setConfirmText(options?.confirmText || 'Confirm');
      setCancelText(options?.cancelText || 'Cancel');
      setDialogType(options?.type || 'warning');
      setIsOpen(true);

      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    resolverRef.current?.(true);
    setIsOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    resolverRef.current?.(false);
    setIsOpen(false);
  }, []);
  
  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <ConfirmDialog
        isOpen={isOpen}
        title={title}
        message={message}
        confirmText={confirmText}
        cancelText={cancelText}
        type={dialogType}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  
  if (context === undefined) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  
  return context;
}; 