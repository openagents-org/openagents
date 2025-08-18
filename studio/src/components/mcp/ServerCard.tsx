import React, { useRef, useEffect, useState } from 'react';
import { ServerIcon } from './icons';

interface ServerCardProps {
  name: string;
  url: string;
  status: 'connected' | 'disconnected';
  type: string;
  description?: string;
  icon?: string;
  onDelete?: () => void;
}

const ServerCard: React.FC<ServerCardProps> = ({ 
  name, 
  url,
  status,
  type,
  description,
  icon,
  onDelete
}) => {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [displayTitle, setDisplayTitle] = useState(name);

  useEffect(() => {
    const updateTitle = () => {
      if (!titleRef.current) return;

      const titleElement = titleRef.current;
      const statusElement = titleElement.querySelector('span');
      if (!statusElement) return;

      const lineHeightStr = window.getComputedStyle(titleRef.current).lineHeight;
      const lineHeight = parseFloat(lineHeightStr);

      if (titleRef.current.offsetHeight > lineHeight) {
        if (descriptionRef.current) {
          (descriptionRef.current.style as any).webkitLineClamp = '2';
          descriptionRef.current.style.maxHeight = '3em';
        }
      } else {
        if (descriptionRef.current) {
          (descriptionRef.current.style as any).webkitLineClamp = '3';
          descriptionRef.current.style.maxHeight = '4.5em';
        }
      }

      if (titleRef.current.offsetHeight <= lineHeight * 2) {
        return;
      }

      const clonedNode = titleRef.current.cloneNode(true) as HTMLElement;
      const textNode = Array.from(clonedNode.childNodes).find(
        node => node.nodeType === Node.TEXT_NODE
      );
      if (!textNode) return;

      clonedNode.style.position = 'absolute';
      clonedNode.style.width = titleElement.offsetWidth + 'px';
      clonedNode.style.visibility = 'hidden';
      clonedNode.style.left = '-9999px';

      document.body.appendChild(clonedNode);

      let currentTitle = name;
      let currentHeight = titleRef.current.offsetHeight;

      while (currentHeight > lineHeight * 2) {
        let nowSlice = currentTitle.slice(0, currentTitle.length - 1);
        textNode.textContent = nowSlice + "...";
        currentTitle = nowSlice;
        currentHeight = clonedNode.offsetHeight;
      }
      setDisplayTitle(currentTitle + "...");

      document.body.removeChild(clonedNode);
    };

    updateTitle();
    window.addEventListener('resize', updateTitle);
    return () => window.removeEventListener('resize', updateTitle);
  }, [name]);

  return (
    <div className="relative w-full" style={{ paddingBottom: '70%' }}>
      <div className="absolute inset-0 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200">
        <div className="flex-none">
          <div className="flex flex-wrap items-center">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-lg overflow-hidden mr-3 flex-shrink-0">
                {icon ? (
                  <ServerIcon type={icon} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    <svg 
                      className="w-5 h-5 text-gray-600 dark:text-gray-300" 
                      xmlns="http://www.w3.org/2000/svg" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                      <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                      <line x1="6" y1="6" x2="6.01" y2="6"></line>
                      <line x1="6" y1="18" x2="6.01" y2="18"></line>
                    </svg>
                  </div>
                )}
              </div>
              <h4 ref={titleRef} className="text-lg font-medium">
                {displayTitle}
              </h4>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0 mt-2">
            <p 
              ref={descriptionRef} 
              className="text-gray-600 dark:text-gray-400 h-full text-sm"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                lineHeight: '1.5em',
                maxHeight: '4.5em'
              }}
            >
              {description || "No description available"}
            </p>
          </div>
        </div>
        <div className="flex-none flex space-x-2 mt-4">
          <button 
            onClick={onDelete}
            className="px-3 py-1 text-sm rounded-md bg-red-600 text-white hover:bg-red-700"
          >
            Delete
          </button>
          <button className="px-3 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700">
            Detail
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServerCard; 