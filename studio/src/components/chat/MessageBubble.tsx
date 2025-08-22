import React, { useEffect, useState, memo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, ToolSection } from '../../types';
import useTheme from '../../hooks/useTheme';
import CodeBlock from './CodeBlock';
import ToolPanel from './ToolPanel';
import { NewsSummaryExample } from '../mcp_output/template';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  toolSections?: ToolSection[];
}

interface CodeProps {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  [key: string]: any;
}

interface ParagraphProps {
  children?: React.ReactNode;
  [key: string]: any;
}

// Update the message styles to better prevent layout shifts
const messageStyles = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .delay-75 {
    animation-delay: 0.2s;
  }
  
  .delay-150 {
    animation-delay: 0.4s;
  }
  
  .animate-pulse {
    animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
  
  .message-content {
    min-height: 1.5rem;
    contain: paint;
    content-visibility: auto;
    overflow-anchor: none;
  }
  
  .streaming-indicator {
    display: inline-block;
    vertical-align: middle;
    height: 1em;
  }
  
  .streaming-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background-color: #6366f1;
    margin-left: 2px;
    animation: blink 1s step-end infinite;
    vertical-align: middle;
    border-radius: 1px;
  }
  
  .dark .streaming-cursor {
    background-color: #a855f7;
  }
  
  .prose p, .prose div {
    margin-bottom: 1rem;
    min-height: 1.5rem;
  }
  
  .message-bubble {
    animation: fadeIn 0.3s ease-in-out;
  }
  
  .user-message {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    color: white;
    border-radius: 18px 18px 4px 18px;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.2);
  }
  
  .assistant-message {
    background: #ffffff;
    color: #1f2937;
    border-radius: 18px 18px 18px 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    border: 1px solid #e5e7eb;
  }
  
  .dark .assistant-message {
    background: #374151;
    color: #f9fafb;
    border: 1px solid #4b5563;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  
  .system-message {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #f9d71c;
    border-radius: 12px;
  }
  
  .dark .system-message {
    background: #451a03;
    color: #fbbf24;
    border: 1px solid #92400e;
  }
`;

// Create a memoized version of MessageBubble component to optimize rendering
const MessageBubble: React.FC<MessageBubbleProps> = memo(({ message, isStreaming, toolSections }) => {
  // Keep the hook call but ignore the returned theme
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { theme } = useTheme();
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  const [selectedToolSection, setSelectedToolSection] = useState<ToolSection | null>(null);
  
  // Keep track of renders for debugging
  const renderCount = useRef<number>(0);
  
  useEffect(() => {
    if (renderCount.current !== null) {
      renderCount.current += 1;
    }
    console.log(`MessageBubble rendering: id=${message.id}, isStreaming=${isStreaming}, text length=${message.text.length}, render=${renderCount.current}`);
  });

  // Function to open the tool panel with a specific tool section
  const openToolPanel = (toolSection: ToolSection) => {
    setSelectedToolSection(toolSection);
    setIsToolPanelOpen(true);
  };

  // Streaming indicator component
  const StreamingIndicator = React.memo(() => {
    // 添加一个闪烁的光标
    return (
      <span className="streaming-cursor"></span>
    );
  });

  // 不再需要单独的processMessageText，直接在renderMessageContent中处理
  const renderMessageContent = (): React.ReactNode => {
    if (message.sender === 'user') {
      // 用户消息纯文本，确保暗黑模式下文本颜色正确
      return <div className="whitespace-pre-wrap text-gray-900 dark:text-gray-100 message-content">{message.text}</div>;
    }

    // 检查是否有工具部分
    const hasToolData = toolSections && toolSections.length > 0;

    if (message.sender === 'assistant' && hasToolData) {
      // 如果是助手消息且有工具，处理消息文本来插入工具按钮
      // 拆分消息文本来定位工具调用标记
      const zhToolStartRegex = /\n\n\*使用工具: ([^*]+)\*\n\n/g;
      const zhToolExecRegex = /\n\n\*调用工具 ([^*]+) 中，输入:\*\n```json\n([\s\S]*?)\n```\n\n/g;
      const zhToolResultRegex = /\n\n\*工具结果:\*\n```json\n([\s\S]*?)\n```\n\n/g;
      const zhToolErrorRegex = /\n\n\*错误: ([^*]+)\*\n\n/g;
      
      const enToolStartRegex = /\n\n\*Using tool: ([^*]+)\*\n\n/g;
      const enToolExecRegex = /\n\n\*Calling tool ([^*]+) with input:\*\n```json\n([\s\S]*?)\n```\n\n/g;
      const enToolResultRegex = /\n\n\*Tool result:\*\n```json\n([\s\S]*?)\n```\n\n/g;
      const enToolErrorRegex = /\n\n\*Error: ([^*]+)\*\n\n/g;
      
      // 保存原始文本
      const originalText = message.text;
      
      // 重置正则表达式
      zhToolStartRegex.lastIndex = 0;
      zhToolExecRegex.lastIndex = 0;
      zhToolResultRegex.lastIndex = 0;
      zhToolErrorRegex.lastIndex = 0;
      enToolStartRegex.lastIndex = 0;
      enToolExecRegex.lastIndex = 0;
      enToolResultRegex.lastIndex = 0;
      enToolErrorRegex.lastIndex = 0;
      
      // 渲染工具按钮
      const renderToolButton = (toolSection: ToolSection, index: number) => {
        switch (toolSection.type) {
          case 'tool_start':
            return (
              <div key={`tool-${index}`} className="my-1 py-1 border-l-2 border-blue-300 dark:border-blue-700 pl-2">
                <button
                  onClick={() => openToolPanel(toolSection)}
                  className="tool-button inline-flex items-center rounded-md px-2.5 py-1 text-sm 
                           font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500
                           bg-blue-100 text-blue-700 hover:bg-blue-200
                           dark:bg-blue-900 dark:text-blue-200 dark:hover:bg-blue-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  使用工具: {toolSection.name}
                </button>
              </div>
            );
          case 'tool_execution':
            return (
              <div key={`tool-${index}`} className="my-1 py-1 border-l-2 border-yellow-300 dark:border-yellow-700 pl-2">
                <button
                  onClick={() => openToolPanel(toolSection)}
                  className="tool-button inline-flex items-center rounded-md px-2.5 py-1 text-sm 
                           font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-500
                           bg-yellow-100 text-yellow-700 hover:bg-yellow-200
                           dark:bg-yellow-900 dark:text-yellow-200 dark:hover:bg-yellow-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  正在调用: {toolSection.name}
                </button>
              </div>
            );
          case 'tool_result':
            return (
              <div key={`tool-${index}`} className="my-1 py-1 border-l-2 border-green-300 dark:border-green-700 pl-2">
                <button
                  onClick={() => openToolPanel(toolSection)}
                  className="tool-button inline-flex items-center rounded-md px-2.5 py-1 text-sm 
                           font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500
                           bg-green-100 text-green-700 hover:bg-green-200
                           dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  工具执行完成 (点击查看结果)
                </button>
              </div>
            );
          case 'tool_error':
            return (
              <div key={`tool-${index}`} className="my-1 py-1 border-l-2 border-red-300 dark:border-red-700 pl-2">
                <button
                  onClick={() => openToolPanel(toolSection)}
                  className="tool-button inline-flex items-center rounded-md px-2.5 py-1 text-sm 
                           font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500
                           bg-red-100 text-red-700 hover:bg-red-200
                           dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  工具执行出错
                </button>
              </div>
            );
          default:
            return null;
        }
      };

      // 创建一个统一处理函数，处理有标记工具和无标记工具两种情况
      const processTextWithTools = () => {
        const markerPositions: Array<{
          start: number;
          end: number;
          section: ToolSection;
        }> = [];
        
        // 工具名称与ID的映射
        const toolNameToSection = new Map<string, ToolSection>();
        if (toolSections) {
          toolSections.forEach(section => {
            if (!toolNameToSection.has(section.name)) {
              toolNameToSection.set(section.name, section);
            }
          });
        }
        
        // 尝试找到文本中的工具标记
        let match;
        let hasFoundMarkers = false;
        
        // 中文工具启动标记
        zhToolStartRegex.lastIndex = 0;
        while ((match = zhToolStartRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const toolName = match[1];
          const matchedSection = toolSections.find(s => s.name === toolName && s.type === 'tool_start') || 
                                toolNameToSection.get(toolName);
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 中文工具执行标记
        zhToolExecRegex.lastIndex = 0;
        while ((match = zhToolExecRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const toolName = match[1];
          const matchedSection = toolSections.find(s => s.name === toolName && s.type === 'tool_execution') || 
                                toolNameToSection.get(toolName);
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 中文工具结果标记
        zhToolResultRegex.lastIndex = 0;
        while ((match = zhToolResultRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const recentToolMarker = markerPositions.length > 0 ? 
            markerPositions[markerPositions.length - 1].section : null;
          
          const matchedSection = toolSections.find(s => s.type === 'tool_result') || recentToolMarker;
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 中文工具错误标记
        zhToolErrorRegex.lastIndex = 0;
        while ((match = zhToolErrorRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const recentToolMarker = markerPositions.length > 0 ? 
            markerPositions[markerPositions.length - 1].section : null;
          
          const matchedSection = toolSections.find(s => s.type === 'tool_error') || recentToolMarker;
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 英文工具启动标记
        enToolStartRegex.lastIndex = 0;
        while ((match = enToolStartRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const toolName = match[1];
          const matchedSection = toolSections.find(s => s.name === toolName && s.type === 'tool_start') || 
                                toolNameToSection.get(toolName);
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 英文工具执行标记
        enToolExecRegex.lastIndex = 0;
        while ((match = enToolExecRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const toolName = match[1];
          const matchedSection = toolSections.find(s => s.name === toolName && s.type === 'tool_execution') || 
                                toolNameToSection.get(toolName);
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 英文工具结果标记
        enToolResultRegex.lastIndex = 0;
        while ((match = enToolResultRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const recentToolMarker = markerPositions.length > 0 ? 
            markerPositions[markerPositions.length - 1].section : null;
          
          const matchedSection = toolSections.find(s => s.type === 'tool_result') || recentToolMarker;
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 英文工具错误标记
        enToolErrorRegex.lastIndex = 0;
        while ((match = enToolErrorRegex.exec(originalText)) !== null) {
          hasFoundMarkers = true;
          const recentToolMarker = markerPositions.length > 0 ? 
            markerPositions[markerPositions.length - 1].section : null;
          
          const matchedSection = toolSections.find(s => s.type === 'tool_error') || recentToolMarker;
          
          if (matchedSection) {
            markerPositions.push({
              start: match.index,
              end: match.index + match[0].length,
              section: matchedSection
            });
          }
        }

        // 如果没有找到标记但有工具部分，则创建人工插入位置
        if (!hasFoundMarkers && toolSections && toolSections.length > 0) {
          console.log('No tool markers found in text, inserting tools artificially');
          
          // 从原始文本中去除所有已有的工具标记（可能是格式不匹配）
          let cleanedText = originalText;
          
          // 清理可能的工具标记相关文本
          // 删除以*开始的整行（可能包含工具相关指令）
          cleanedText = cleanedText.replace(/\n\*.*?\*\n/g, '\n');
          // 删除可能的JSON代码块
          cleanedText = cleanedText.replace(/```json\n[\s\S]*?\n```/g, '');
          // 清理连续多个换行
          cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');
          
          // 为确保位置稳定，使用更为确定的方式插入工具按钮
          // 我们将根据消息ID和工具类型来确定位置，使每次渲染位置一致
          
          // 首先找到所有段落边界作为候选位置
          const paragraphs = cleanedText.split(/\n\n+/);
          const candidatePositions: number[] = [];
          
          // 计算段落边界位置
          let position = 0;
          paragraphs.forEach(p => {
            position += p.length + 2; // +2 for '\n\n'
            if (position < cleanedText.length) {
              candidatePositions.push(position);
            }
          });
          
          // 如果没有足够的段落边界，添加一些句子边界
          if (candidatePositions.length < toolSections.length) {
            const sentences = cleanedText.split(/[.!?]\s+/);
            position = 0;
            sentences.forEach(s => {
              position += s.length + 2; // +2 for '. ' or similar
              if (position < cleanedText.length && !candidatePositions.includes(position)) {
                candidatePositions.push(position);
              }
            });
          }
          
          // 如果仍然没有足够的边界，添加均匀分布的位置
          if (candidatePositions.length < toolSections.length) {
            const textLength = cleanedText.length;
            const segmentLength = textLength / (toolSections.length + 1);
            
            for (let i = 1; i <= toolSections.length; i++) {
              const pos = Math.floor(i * segmentLength);
              if (!candidatePositions.includes(pos)) {
                candidatePositions.push(pos);
              }
            }
          }
          
          // 排序候选位置
          candidatePositions.sort((a, b) => a - b);
          
          // 确保工具的显示顺序是确定的，根据工具ID和消息ID生成确定的顺序
          const orderedToolSections = [...toolSections].sort((a, b) => {
            // 首先按工具类型排序（保持工具流程的自然顺序）
            const typeOrder = { 'tool_start': 0, 'tool_execution': 1, 'tool_result': 2, 'tool_error': 3 };
            const typeA = typeOrder[a.type as keyof typeof typeOrder] || 0;
            const typeB = typeOrder[b.type as keyof typeof typeOrder] || 0;
            
            if (typeA !== typeB) return typeA - typeB;
            
            // 相同类型则按名称排序
            return a.name.localeCompare(b.name);
          });
          
          // 为每个工具选择一个插入位置
          // 使用工具的索引以确保相同的工具在不同渲染中总是放在相同的位置
          orderedToolSections.forEach((section, idx) => {
            // 如果有足够的候选位置，使用它们
            if (candidatePositions.length > 0) {
              // 使用确定性算法选择位置（基于工具索引）
              const posIndex = idx % candidatePositions.length;
              const insertPosition = candidatePositions[posIndex];
              
              markerPositions.push({
                start: insertPosition,
                end: insertPosition,
                section: section
              });
            } else {
              // 如果没有候选位置，在文本开头放置工具（应该很少发生）
              markerPositions.push({
                start: 0,
                end: 0,
                section: section
              });
            }
          });
        }
        
        // 按位置排序，确保按照出现顺序处理
        markerPositions.sort((a, b) => a.start - b.start);
        
        // 创建ReactNode数组
        const segments: React.ReactNode[] = [];
        let lastEnd = 0;
        
        // 对每个标记位置处理，在每个位置前添加文本，在位置处添加工具按钮
        markerPositions.forEach((position, idx) => {
          // 添加标记之前的文本
          if (position.start > lastEnd) {
            const textSegment = originalText.substring(lastEnd, position.start);
            if (textSegment.trim()) {
              segments.push(
                <div key={`text-${idx}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code: ({ inline, className, children, ...props }: CodeProps) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';
                        
                        if (!inline) {
                          const codeContent = String(children).replace(/\n$/, '');
                          return (
                            <CodeBlock
                              code={codeContent}
                              language={language}
                            />
                          );
                        }
                        
                        return (
                          <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-sm" {...props}>
                            {children}
                          </code>
                        );
                      },
                      p: ({ children, ...props }: ParagraphProps) => {
                        // 判断是否为最后一段并且是正在流式传输的消息
                        const isLastParagraph = props.node && 
                          props.node.position && 
                          props.node.position.end.offset === textSegment.length;
                          
                        // 只有在没有后续文本和工具的情况下才在这个段落显示光标
                        const isLastContentSegment = idx === markerPositions.length - 1 && 
                          position.end >= originalText.length;
                          
                        return (
                          <div className="mb-4" {...props}>
                            {children}
                            {isLastParagraph && isLastContentSegment && isStreaming && <StreamingIndicator />}
                          </div>
                        );
                      },
                      br: () => <br />,
                      ul: ({ children, ...props }) => (
                        <ul className="list-disc pl-5 mb-4" {...props}>{children}</ul>
                      ),
                      ol: ({ children, ...props }) => (
                        <ol className="list-decimal pl-5 mb-4" {...props}>{children}</ol>
                      ),
                      a: ({ children, href, ...props }) => (
                        <a className="text-blue-600 dark:text-blue-400 hover:underline" href={href} target="_blank" rel="noopener noreferrer" {...props}>
                          {children}
                        </a>
                      )
                    }}
                  >
                    {textSegment}
                  </ReactMarkdown>
                </div>
              );
            }
          }

          // 添加工具按钮
          segments.push(renderToolButton(position.section, idx));

          // 更新最后处理的位置
          lastEnd = position.end;
        });

        // 添加最后一个标记后的剩余文本
        if (lastEnd < originalText.length) {
          const textSegment = originalText.substring(lastEnd);
          if (textSegment.trim()) {
            segments.push(
              <div key={`text-final`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: ({ inline, className, children, ...props }: CodeProps) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const language = match ? match[1] : '';
                      
                      if (!inline) {
                        const codeContent = String(children).replace(/\n$/, '');
                        return (
                          <CodeBlock
                            code={codeContent}
                            language={language}
                          />
                        );
                      }
                      
                      return (
                        <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-sm" {...props}>
                          {children}
                        </code>
                      );
                    },
                    p: ({ children, ...props }: ParagraphProps) => {
                      // 在最后一个段落后添加光标
                      const isLastParagraph = props.node && 
                        props.node.position && 
                        props.node.position.end.offset === textSegment.length;
                        
                      return (
                        <div className="mb-4" {...props}>
                          {children}
                          {isLastParagraph && isStreaming && <StreamingIndicator />}
                        </div>
                      );
                    },
                    br: () => <br />,
                    ul: ({ children, ...props }) => (
                      <ul className="list-disc pl-5 mb-4" {...props}>{children}</ul>
                    ),
                    ol: ({ children, ...props }) => (
                      <ol className="list-decimal pl-5 mb-4" {...props}>{children}</ol>
                    ),
                    a: ({ children, href, ...props }) => (
                      <a className="text-blue-600 dark:text-blue-400 hover:underline" href={href} target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    )
                  }}
                >
                  {textSegment}
                </ReactMarkdown>
              </div>
            );
          }
        }

        return segments;
      };

      // 统一使用处理函数，不区分有无标记
      const elements = processTextWithTools();
      
      return (
        <div className='flex flex-col gap-2'>
          <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100 message-content">
            {elements}
            {isStreaming && elements.length === 0 && <StreamingIndicator />}
          </div>
          <NewsSummaryExample />
        </div>
      );
    }

    // 默认渲染方式（无工具或系统消息）
    // 创建一个带有光标或无光标的消息文本
    const messageText = message.text || '';
    
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100 message-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: ({ inline, className, children, ...props }: CodeProps) => {
              const match = /language-(\w+)/.exec(className || '');
              const language = match ? match[1] : '';
              
              if (!inline) {
                const codeContent = String(children).replace(/\n$/, '');
                return (
                  <CodeBlock
                    code={codeContent}
                    language={language}
                  />
                );
              }
              
              return (
                <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-sm" {...props}>
                  {children}
                </code>
              );
            },
            // Override paragraph to use div instead to avoid nesting validation errors
            p: ({ children, ...props }: ParagraphProps) => {
              // 在最后一个段落后添加光标
              const isLastParagraph = props.node && 
                props.node.position && 
                props.node.position.end.offset === messageText.length;
                
              return (
                <div className="mb-4" {...props}>
                  {children}
                  {isLastParagraph && isStreaming && <StreamingIndicator />}
                </div>
              );
            },
            // Properly handle line breaks
            br: () => <br />,
            // Add proper styling for lists
            ul: ({ children, ...props }) => (
              <ul className="list-disc pl-5 mb-4" {...props}>{children}</ul>
            ),
            ol: ({ children, ...props }) => (
              <ol className="list-decimal pl-5 mb-4" {...props}>{children}</ol>
            ),
            // Add proper styling for links
            a: ({ children, href, ...props }) => (
              <a className="text-blue-600 dark:text-blue-400 hover:underline" href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            )
          }}
        >
          {messageText}
        </ReactMarkdown>
        {/* 如果消息为空或没有段落元素，显示光标 */}
        {isStreaming && !messageText && <StreamingIndicator />}
      </div>
    );
  };

  // Determine icon based on sender
  const renderIcon = () => {
    if (message.sender === 'user') {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white shadow-md">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
          </svg>
        </div>
      );
    } else if (message.sender === 'assistant') {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-blue-500 flex items-center justify-center text-white shadow-md">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M12 2l3.09 6.26L22 9l-5 4.87L18.18 22 12 18.82 5.82 22 7 13.87 2 9l6.91-.74L12 2z" />
          </svg>
        </div>
      );
    } else { // system message
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-md">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
          </svg>
        </div>
      );
    }
  };

  return (
    <div className={`message-bubble flex gap-3 w-full ${
      message.sender === 'user' 
        ? 'justify-end'
        : 'justify-start'
    }`}>
      {/* Add the style block for animations and layout stability */}
      <style>{messageStyles}</style>
      
      {/* Avatar and content container */}
      <div className={`flex gap-3 max-w-[80%] ${
        message.sender === 'user' 
          ? 'flex-row-reverse'
          : 'flex-row'
      }`}>
        {/* Avatar */}
        <div className="flex-shrink-0">
          {renderIcon()}
        </div>
        
        {/* Message content */}
        <div className={`px-4 py-3 min-w-0 ${
          message.sender === 'user'
            ? 'user-message'
            : message.sender === 'assistant'
            ? 'assistant-message'
            : 'system-message'
        }`}>
          {renderMessageContent()}
        </div>
      </div>

      {/* Tool panel */}
      <ToolPanel 
        isOpen={isToolPanelOpen}
        onClose={() => setIsToolPanelOpen(false)}
        toolSection={selectedToolSection}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function - only re-render when these properties change
  const textChanged = prevProps.message.text !== nextProps.message.text;
  const streamingChanged = prevProps.isStreaming !== nextProps.isStreaming;
  const toolSectionsChanged = 
    (prevProps.toolSections?.length || 0) !== (nextProps.toolSections?.length || 0);
  const shouldUpdate = textChanged || streamingChanged || toolSectionsChanged;
  
  // Log re-render decision
  if (shouldUpdate) {
    console.log('MessageBubble re-rendering because:', 
      textChanged ? 'text changed' : 
      streamingChanged ? 'streaming status changed' : 'tool sections changed');
  }
  
  // Return false to cause re-render
  return !shouldUpdate;
});

export default MessageBubble; 