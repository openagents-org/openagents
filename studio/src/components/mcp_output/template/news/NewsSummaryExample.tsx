import React from 'react';
import NewsSummaryList, { NewsSummaryItem } from './NewsSummaryList';

// 示例数据
const exampleNewsItems: NewsSummaryItem[] = [
  {
    id: '1',
    title: 'Scientists Discover New Renewable Energy Source',
    date: 'May 15, 2023',
    source: 'Science Today',
    url: 'https://example.com/news/1',
    imageUrl: 'https://images.unsplash.com/photo-1508514177221-188b1cf16e9d'
  },
  {
    id: '2',
    title: 'Global Tech Conference Announces Dates for Next Year',
    date: 'June 3, 2023',
    source: 'Tech Weekly',
    imageUrl: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c'
  },
  {
    id: '3',
    title: 'New Study Reveals Benefits of Mediterranean Diet',
    date: 'June 10, 2023',
    source: 'Health Journal',
    url: 'https://example.com/news/3',
    // 故意不提供图片以使用placeholder
  },
  {
    id: '4',
    title: 'Major Tech Company Announces New Smartphone Series',
    date: 'June 15, 2023',
    source: 'Tech News',
    url: 'https://example.com/news/4'
  },
  {
    id: '5',
    title: 'Stock Market Reaches Record High Amid Economic Recovery',
    date: 'June 18, 2023',
    source: 'Financial Times',
    imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3'
  },
  {
    id: '6',
    title: 'New Film Festival Celebrates Independent Filmmakers',
    date: 'June 20, 2023',
    source: 'Entertainment Weekly',
    url: 'https://example.com/news/6',
    imageUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728'
  }
];

// 没有图片的新闻，用于演示placeholder
const noImageNewsItems: NewsSummaryItem[] = [
  {
    id: '7',
    title: 'Government Announces New Education Policy',
    date: 'June 22, 2023',
    source: 'Policy Today'
  },
  {
    id: '8',
    title: 'Local Community Hosts Cultural Festival',
    date: 'June 25, 2023',
    source: 'Community News'
  },
  {
    id: '9',
    title: 'Sports Team Wins Championship After Decade-Long Drought',
    date: 'June 28, 2023',
    source: 'Sports Network'
  }
];

const NewsSummaryExample: React.FC = () => {
  return (
    <div className="max-w-6xl mx-auto">
      <NewsSummaryList 
        newsItems={exampleNewsItems} 
        title="Today's Top Headlines" 
        columns={3}
      />
      
      {/* 演示不同列数的布局 */}
      <div className="mt-10">
        <NewsSummaryList 
          newsItems={exampleNewsItems.slice(0, 4)} 
          title="Technology News" 
          columns={2}
        />
      </div>

      {/* 演示placeholder效果 */}
      <div className="mt-10">
        <NewsSummaryList 
          newsItems={noImageNewsItems} 
          title="Without Images (Using Placeholders)" 
          columns={3}
        />
      </div>
    </div>
  );
};

export default NewsSummaryExample; 