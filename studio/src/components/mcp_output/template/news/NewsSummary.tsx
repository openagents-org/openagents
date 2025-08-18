import React from 'react';
import NewsPlaceholder from './NewsPlaceholder';

interface NewsSummaryProps {
  title: string;
  date: string;
  source?: string;
  imageUrl?: string;
  url?: string;
}

const NewsSummary: React.FC<NewsSummaryProps> = ({
  title,
  date,
  source,
  imageUrl,
  url
}) => {
  return (
    <div className="group news-card bg-white dark:bg-gray-800 rounded-lg overflow-hidden 
                    shadow-sm hover:shadow-md transition-all duration-200 h-full flex flex-col 
                    dark:border dark:border-gray-700 dark:hover:border-gray-500">
      {/* Image or Placeholder */}
      <div className="h-40 overflow-hidden">
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt={title} 
            className="w-full h-full object-cover"
          />
        ) : (
          <NewsPlaceholder />
        )}
      </div>
      
      <div className="p-3 flex flex-col flex-grow">
        {/* Title with optional link */}
        <h3 className="text-base font-medium text-gray-900 dark:text-white line-clamp-2">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </h3>
        
        {/* Date and source */}
        <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-auto pt-2">
          <span>{date}</span>
          {source && (
            <>
              <span className="mx-1">•</span>
              <span className="truncate">{source}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewsSummary; 