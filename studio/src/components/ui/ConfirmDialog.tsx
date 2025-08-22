import React, { useEffect, useState } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  type = 'warning'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setIsLeaving(false);
      // Add keydown listener for Escape key
      const handleEscapeKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          handleCancel();
        }
      };
      document.addEventListener('keydown', handleEscapeKey);
      return () => {
        document.removeEventListener('keydown', handleEscapeKey);
      };
    }
  }, [isOpen]);

  const handleClose = (callback: () => void) => {
    setIsLeaving(true);
    setTimeout(() => {
      setIsVisible(false);
      callback();
    }, 200); // Animation duration
  };

  const handleConfirm = () => {
    handleClose(onConfirm);
  };

  const handleCancel = () => {
    handleClose(onCancel);
  };

  if (!isVisible) return null;

  // Determine the styles based on type
  let iconColor = '';
  let confirmButtonStyle = '';
  let icon = null;

  switch (type) {
    case 'danger':
      iconColor = 'text-red-500';
      confirmButtonStyle = 'bg-red-600 hover:bg-red-700 focus:ring-red-500';
      icon = (
        <svg className={`h-6 w-6 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
      break;
    case 'info':
      iconColor = 'text-blue-500';
      confirmButtonStyle = 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500';
      icon = (
        <svg className={`h-6 w-6 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
      break;
    case 'warning':
    default:
      iconColor = 'text-yellow-500';
      confirmButtonStyle = 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500';
      icon = (
        <svg className={`h-6 w-6 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
  }

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity ${
        isLeaving ? 'opacity-0' : 'opacity-100'
      }`}
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-40 transition-opacity"></div>
      
      {/* Dialog */}
      <div 
        className={`relative bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full m-4 transform transition-all ${
          isLeaving ? 'scale-95' : 'scale-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0 mr-4">
              {icon}
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">{title}</h3>
          </div>
          
          {/* Message */}
          <div className="mt-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
          </div>
          
          {/* Actions */}
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              className="inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 shadow-sm px-4 py-2 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              onClick={handleCancel}
            >
              {cancelText}
            </button>
            <button
              type="button"
              className={`inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${confirmButtonStyle}`}
              onClick={handleConfirm}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog; 