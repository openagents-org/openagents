import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  truncate?: boolean;
  maxLength?: number;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
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
            <h1 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-200">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mb-2 text-gray-700 dark:text-gray-300">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-semibold mb-2 text-gray-700 dark:text-gray-300">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-sm font-semibold mb-2 text-gray-600 dark:text-gray-400">
              {children}
            </h6>
          ),
          
          // Customize paragraph styles
          p: ({ children }) => (
            <p className="mb-3 leading-relaxed text-gray-700 dark:text-gray-300">
              {children}
            </p>
          ),
          
          // Customize link styles
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline transition-colors text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {children}
            </a>
          ),
          
          // Customize list styles
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-3 space-y-1 text-gray-700 dark:text-gray-300">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1 text-gray-700 dark:text-gray-300">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="mb-1">{children}</li>
          ),
          
          // Customize blockquote styles
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 pl-4 py-2 mb-3 italic border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {children}
            </blockquote>
          ),
          
          // Customize code styles
          code: ({ children, className }) => {
            const isInline = !className || !className.includes('language-');
            if (isInline) {
              return (
                <code className="px-1 py-0.5 rounded text-sm font-mono bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                  {children}
                </code>
              );
            }
            return (
              <code className={`block p-3 rounded-lg text-sm font-mono overflow-x-auto bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 ${className || ''}`}>
                {children}
              </code>
            );
          },
          
          // Customize pre styles (code blocks)
          pre: ({ children }) => (
            <pre className="mb-3 rounded-lg overflow-x-auto bg-gray-100 dark:bg-gray-800">
              {children}
            </pre>
          ),
          
          // Customize table styles
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="min-w-full border-collapse border-gray-300 dark:border-gray-600">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border px-3 py-2 text-left font-semibold border-gray-300 bg-gray-50 text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border px-3 py-2 border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300">
              {children}
            </td>
          ),
          
          // Customize horizontal rule
          hr: () => (
            <hr className="my-4 border-gray-300 dark:border-gray-600" />
          ),
          
          // Customize strong/bold text
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-800 dark:text-gray-200">
              {children}
            </strong>
          ),

          // Customize emphasis/italic text
          em: ({ children }) => (
            <em className="italic text-gray-700 dark:text-gray-300">
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