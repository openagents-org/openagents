import React from 'react';
import DefaultSidebar from '@/components/layout/DefaultSidebar';

const ModManagementSidebar: React.FC = () => {
  return (
    <DefaultSidebar
      message="动态 Mod 管理侧边栏内容可以在这里显示"
      icon={
        <svg
          className="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M19.11 4.89l-1.72 1.72a8 8 0 010 11.32l1.72-1.72a6 6 0 000-8.48l-1.72-1.72zM8.29 6.29l-1.72 1.72a6 6 0 000 8.48l1.72 1.72a8 8 0 010-11.32L8.29 6.29zM7 12a5 5 0 011.46-3.54l7.08 7.08A5 5 0 0117 12a5 5 0 01-1.46-3.54L8.46 15.54A5 5 0 017 12z"
          />
        </svg>
      }
    />
  );
};

export default ModManagementSidebar;

