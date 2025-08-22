import React, { useRef, useEffect, useState } from 'react';
import { ServerIcon } from './icons';

interface McpCardProps {
  title: string;
  description: string;
  status: 'on' | 'off';
  icon: string;
  id: string;
  onUse?: (id: string, title: string, description: string, icon: string) => void;
}

const McpCard: React.FC<McpCardProps> = ({ title, description, status, icon, id, onUse }) => {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [displayTitle, setDisplayTitle] = useState(title);

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

      let currentTitle = title;
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
  }, [title]);

  const handleUse = () => {
    if (onUse) {
      onUse(id, title, description, icon);
    }
  };

  return (
    <div className="relative w-full" style={{ paddingBottom: '70%' }}>
      <div className="absolute inset-0 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200">
        <div className="flex-none">
          <div className="flex flex-wrap items-center">
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-lg overflow-hidden mr-3 flex-shrink-0">
                <ServerIcon type={icon} className="w-full h-full" />
              </div>
              <h4 ref={titleRef} className="text-lg font-medium">
                {displayTitle}
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ml-2 ${status === 'on'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }`}>
                  {status === 'on' ? (
                    <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M5 12L10 17L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {status.toUpperCase()}
                </span>
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
              {description}
            </p>
          </div>
        </div>
        <div className="flex-none flex space-x-2 mt-4">
          <button 
            className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
            onClick={handleUse}
          >
            Use
          </button>
          <button className="px-3 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700">
            Detail
          </button>
        </div>
      </div>
    </div>
  );
};

export default McpCard; 