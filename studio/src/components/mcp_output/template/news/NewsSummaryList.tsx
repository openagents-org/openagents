import React from 'react';
import NewsSummary from './NewsSummary';

export interface NewsSummaryItem {
  id: string;
  title: string;
  date: string;
  source?: string;
  imageUrl?: string;
  url?: string;
}

interface NewsSummaryListProps {
  newsItems: NewsSummaryItem[];
  title?: string;
  columns?: number;
}

const NewsSummaryList: React.FC<NewsSummaryListProps> = ({ 
  newsItems,
  title = "News Summary",
  columns = 3
}) => {
  if (!newsItems || newsItems.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        No news items available.
      </div>
    );
  }

  // 根据columns参数动态生成grid类名
  const gridClassName = `grid grid-cols-1 sm:grid-cols-2 gap-4 ${
    columns >= 3 ? 'md:grid-cols-3' : ''
  } ${
    columns >= 4 ? 'lg:grid-cols-4' : ''
  } ${
    columns >= 5 ? 'xl:grid-cols-5' : ''
  }`;

  return (
    <div className="news-summary-list">
      {title && (
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          {title}
        </h2>
      )}
      
      <div className={gridClassName}>
        {newsItems.map((item) => (
          <NewsSummary
            key={item.id}
            title={item.title}
            date={item.date}
            source={item.source}
            imageUrl={item.imageUrl}
            url={item.url}
          />
        ))}
      </div>
    </div>
  );
};

export default NewsSummaryList; 