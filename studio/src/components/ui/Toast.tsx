import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  onClose: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ id, message, type, duration = 3000, onClose }) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLeaving(true);
      setTimeout(() => {
        setIsVisible(false);
        onClose(id);
      }, 300); // animation duration
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, id, onClose]);

  if (!isVisible) return null;

  // Determine background color based on type
  let bgColor = '';
  let textColor = '';
  let icon = null;

  switch (type) {
    case 'success':
      bgColor = 'bg-green-100 dark:bg-green-900/30';
      textColor = 'text-green-800 dark:text-green-200';
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      );
      break;
    case 'error':
      bgColor = 'bg-red-100 dark:bg-red-900/30';
      textColor = 'text-red-800 dark:text-red-200';
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      );
      break;
    case 'warning':
      bgColor = 'bg-yellow-100 dark:bg-yellow-900/30';
      textColor = 'text-yellow-800 dark:text-yellow-200';
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500 dark:text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      );
      break;
    case 'info':
    default:
      bgColor = 'bg-blue-100 dark:bg-blue-900/30';
      textColor = 'text-blue-800 dark:text-blue-200';
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      );
  }

  return (
    <div 
      className={`flex items-center p-4 mb-3 rounded-lg shadow-md ${bgColor} ${textColor} transition-all transform ${
        isLeaving ? 'opacity-0 translate-y-[-10px]' : 'opacity-100'
      }`}
      role="alert"
    >
      <div className="flex-shrink-0 mr-3">
        {icon}
      </div>
      <div className="flex-1 text-sm font-medium">{message}</div>
      <button 
        type="button" 
        className="ml-auto -mx-1.5 -my-1.5 rounded-lg p-1.5 inline-flex h-8 w-8 hover:bg-black/10 dark:hover:bg-white/10"
        onClick={() => {
          setIsLeaving(true);
          setTimeout(() => {
            setIsVisible(false);
            onClose(id);
          }, 300);
        }}
        aria-label="Close"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path>
        </svg>
      </button>
    </div>
  );
};

export default Toast; 