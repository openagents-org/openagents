import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  currentTheme?: 'light' | 'dark';
  truncate?: boolean;
  maxLength?: number;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  currentTheme = 'light',
  truncate = false,
  maxLength = 200
}) => {
  // Truncate content if needed (for previews)
  const displayContent = truncate && content.length > maxLength 
    ? content.substring(0, maxLength) + '...'
    : content;

  return (
    <div className={`markdown-content ${truncate ? 'truncated' : ''} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          // Customize heading styles
          h1: ({ children }) => (
            <h1 className={`text-2xl font-bold mb-4 ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
            }`}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={`text-xl font-semibold mb-3 ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
            }`}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={`text-lg font-semibold mb-2 ${
              currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className={`text-base font-semibold mb-2 ${
              currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className={`text-sm font-semibold mb-2 ${
              currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className={`text-sm font-semibold mb-2 ${
              currentTheme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {children}
            </h6>
          ),
          
          // Customize paragraph styles
          p: ({ children }) => (
            <p className={`mb-3 leading-relaxed ${
              currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {children}
            </p>
          ),
          
          // Customize link styles
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline hover:no-underline transition-colors ${
                currentTheme === 'dark' 
                  ? 'text-blue-400 hover:text-blue-300' 
                  : 'text-blue-600 hover:text-blue-700'
              }`}
            >
              {children}
            </a>
          ),
          
          // Customize list styles
          ul: ({ children }) => (
            <ul className={`list-disc list-inside mb-3 space-y-1 ${
              currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className={`list-decimal list-inside mb-3 space-y-1 ${
              currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="mb-1">{children}</li>
          ),
          
          // Customize blockquote styles
          blockquote: ({ children }) => (
            <blockquote className={`border-l-4 pl-4 py-2 mb-3 italic ${
              currentTheme === 'dark' 
                ? 'border-gray-600 bg-gray-800 text-gray-300' 
                : 'border-gray-300 bg-gray-50 text-gray-600'
            }`}>
              {children}
            </blockquote>
          ),
          
          // Customize code styles
          code: ({ children, className }) => {
            const isInline = !className || !className.includes('language-');
            if (isInline) {
              return (
                <code className={`px-1 py-0.5 rounded text-sm font-mono ${
                  currentTheme === 'dark' 
                    ? 'bg-gray-700 text-gray-300' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {children}
                </code>
              );
            }
            return (
              <code className={`block p-3 rounded-lg text-sm font-mono overflow-x-auto ${
                currentTheme === 'dark' 
                  ? 'bg-gray-800 text-gray-300' 
                  : 'bg-gray-100 text-gray-800'
              } ${className || ''}`}>
                {children}
              </code>
            );
          },
          
          // Customize pre styles (code blocks)
          pre: ({ children }) => (
            <pre className={`mb-3 rounded-lg overflow-x-auto ${
              currentTheme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'
            }`}>
              {children}
            </pre>
          ),
          
          // Customize table styles
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className={`min-w-full border-collapse ${
                currentTheme === 'dark' ? 'border-gray-600' : 'border-gray-300'
              }`}>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className={`border px-3 py-2 text-left font-semibold ${
              currentTheme === 'dark' 
                ? 'border-gray-600 bg-gray-700 text-gray-200' 
                : 'border-gray-300 bg-gray-50 text-gray-800'
            }`}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className={`border px-3 py-2 ${
              currentTheme === 'dark' 
                ? 'border-gray-600 text-gray-300' 
                : 'border-gray-300 text-gray-700'
            }`}>
              {children}
            </td>
          ),
          
          // Customize horizontal rule
          hr: () => (
            <hr className={`my-4 ${
              currentTheme === 'dark' ? 'border-gray-600' : 'border-gray-300'
            }`} />
          ),
          
          // Customize strong/bold text
          strong: ({ children }) => (
            <strong className={`font-semibold ${
              currentTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
            }`}>
              {children}
            </strong>
          ),
          
          // Customize emphasis/italic text
          em: ({ children }) => (
            <em className={`italic ${
              currentTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {children}
            </em>
          ),
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;