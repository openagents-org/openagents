import React from 'react';

interface NewsPlaceholderProps {
  className?: string;
}

const NewsPlaceholder: React.FC<NewsPlaceholderProps> = ({ className = '' }) => {
  return (
    <div className={`flex items-center justify-center w-full h-full bg-gray-100 dark:bg-gray-700 ${className}`}>
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        className="w-10 h-10 text-gray-400 dark:text-gray-500"
      >
        <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"></path>
        <path d="M10 4v16"></path>
        <path d="M4 8h6"></path>
        <path d="M4 12h6"></path>
        <path d="M4 16h6"></path>
        <path d="M14 12h4"></path>
        <path d="M14 16h4"></path>
        <path d="M14 8h4"></path>
      </svg>
    </div>
  );
};

export default NewsPlaceholder; 