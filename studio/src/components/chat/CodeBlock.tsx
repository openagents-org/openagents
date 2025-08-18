import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import useTheme from '../../hooks/useTheme';

interface CodeBlockProps {
  code: string;
  language: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Map common language aliases to proper ones
  const normalizeLanguage = (lang: string): string => {
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'bash',
      'zsh': 'bash',
      'shell': 'bash',
      'md': 'markdown',
      'json': 'json',
      'html': 'html',
      'css': 'css',
      'csharp': 'cs',
      'c#': 'cs',
      'c++': 'cpp',
      'rust': 'rust',
      'go': 'go',
      'java': 'java',
      'xml': 'xml',
      'yml': 'yaml',
      'yaml': 'yaml',
    };

    return languageMap[lang.toLowerCase()] || lang || 'plaintext';
  };

  const normalizedLanguage = normalizeLanguage(language);

  return (
    <div className="code-block-wrapper relative group bg-gray-100 dark:bg-gray-800 rounded-md my-4 text-sm overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="code-header flex justify-between items-center px-3 py-2 bg-gray-200 dark:bg-gray-700 text-sm text-gray-600 dark:text-gray-300 border-b border-gray-300 dark:border-gray-600">
        <span className="font-mono">{normalizedLanguage}</span>
        <button 
          onClick={copyToClipboard}
          className="copy-button bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 px-2 py-1 rounded text-xs transition-colors"
        >
          {copied ? 'Copied!' : 'Copy code'}
        </button>
      </div>
      <SyntaxHighlighter 
        language={normalizedLanguage}
        style={theme === 'dark' ? oneDark : oneLight}
        customStyle={{ 
          margin: 0, 
          padding: '1rem', 
          backgroundColor: 'transparent', 
          fontSize: '0.875rem',
        }}
        wrapLongLines={true}
        showLineNumbers={true}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

export default CodeBlock; 