import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolSection } from '../../types';

interface ToolPanelProps {
  isOpen: boolean;
  onClose: () => void;
  toolSection: ToolSection | null;
}

// 自定义的Markdown渲染组件
const CustomReactMarkdown: React.FC<{children: string}> = ({ children }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 自定义pre标签的渲染
        pre: (props) => (
          <pre 
            className="whitespace-pre-wrap break-words max-w-full overflow-x-auto"
            style={{ maxWidth: '100%', overflowWrap: 'break-word' }}
            {...props}
          />
        ),
        // 自定义code标签的渲染
        code: ({className, children, ...props}: any) => {
          const match = /language-(\w+)/.exec(className || '');
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const language = match ? match[1] : '';
          const isInline = !className || !match;
          
          if (!isInline) {
            // 代码块
            return (
              <div className="max-w-full overflow-x-auto">
                <pre 
                  className="max-w-full whitespace-pre-wrap overflow-x-auto break-words"
                  style={{ maxWidth: '100%', overflowWrap: 'break-word' }}
                >
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          }
          
          // 行内代码
          return (
            <code 
              className={`whitespace-pre-wrap break-words ${className || ''}`}
              style={{ wordBreak: 'break-word' }}
              {...props}
            >
              {children}
            </code>
          );
        },
        // 自定义p标签的渲染
        p: (props) => (
          <p 
            className="whitespace-pre-wrap break-words"
            style={{ maxWidth: '100%', overflowWrap: 'break-word' }}
            {...props}
          />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
};

const ToolPanel: React.FC<ToolPanelProps> = ({ isOpen, onClose, toolSection }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(isOpen);
  
  // 确保组件挂载时状态正确
  useEffect(() => {
    // 如果初始状态为打开，则应用打开动画
    if (isOpen) {
      requestAnimationFrame(() => {
        setIsAnimating(true);
      });
    }
  }, [isOpen]); // 添加isOpen作为依赖项

  useEffect(() => {
    if (isOpen) {
      // 首先显示面板但保持在初始位置（transform: translateX(100%)）
      setIsAnimating(false); // 先设置为false，确保初始状态正确
      setIsVisible(true);
      
      // 使用requestAnimationFrame确保DOM更新后再应用动画
      requestAnimationFrame(() => {
        // 在下一帧应用打开动画
        requestAnimationFrame(() => {
          setIsAnimating(true); // 然后设置为true触发过渡动画
        });
      });
      
    } else {
      // 开始关闭动画
      setIsAnimating(false);
      
      // 等待动画完成后隐藏面板
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 400); // 与过渡持续时间相同
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // 控制台输出，帮助调试 - 移动到单独的useEffect
  useEffect(() => {
    // 仅在工具部分变更时输出日志，避免与动画状态变化交互
    if (isOpen && toolSection) {
      console.log("Tool panel opened with section:", toolSection);
    }
  }, [isOpen, toolSection]);

  // 如果面板既不可见也不在动画中，则不渲染任何内容
  if (!isVisible && !isOpen) return null;

  // 增强的工具面板样式
  const toolPanelStyles = `
    /* 确保内容会正确换行 */
    .tool-panel-content {
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      word-break: break-word !important;
      max-width: 100% !important;
    }
    
    /* 保持代码块的格式 */
    .tool-panel-content pre {
      white-space: pre-wrap !important;
      overflow-x: auto;
      max-width: 100%;
      margin: 0.5em 0;
      border-radius: 0.5rem;
    }
    
    /* 给行内代码添加样式 */
    .tool-panel-content code {
      white-space: pre-wrap !important;
      word-break: break-word !important;
      border-radius: 0.25rem;
    }
    
    /* JSON内容的样式 */
    .tool-panel-json {
      white-space: pre-wrap !important;
      word-break: break-word !important;
      font-family: monospace;
      max-height: 300px;
      overflow-y: auto;
      max-width: 100% !important;
      font-size: 0.875rem;
      line-height: 1.25rem;
      border-radius: 0.5rem;
    }
    
    /* 覆盖任何可能干扰换行的样式 */
    .tool-panel .overflow-auto {
      max-width: 100% !important;
      overflow-x: auto !important;
      border-radius: 0.5rem;
    }
    
    /* 确保内容区域可以正确展示 */
    .tool-panel-section {
      width: 100%;
      max-width: 100%;
    }
  `;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <style>{toolPanelStyles}</style>
      <div className="absolute inset-0 overflow-hidden">
        {/* Backdrop with click handler to close */}
        <div 
          className={`absolute inset-0 bg-gray-500 bg-opacity-75 dark:bg-gray-900 dark:bg-opacity-80 transition-opacity duration-300 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />
        
        {/* Sliding panel - 直接使用内联过渡样式，添加缩放效果 */}
        <section 
          className={`absolute inset-y-4 right-4 w-full sm:w-3/4 md:w-1/2 lg:w-2/5 xl:w-1/3 tool-panel`}
          style={{
            transform: isAnimating ? 'translateX(0)' : 'translateX(100%)',
            opacity: isAnimating ? 1 : 0,
            transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease-in-out',
            willChange: 'transform, opacity'
          }}
        >
          <div className="h-full w-full bg-white dark:bg-gray-800 shadow-xl overflow-y-auto rounded-lg">
            {/* Panel header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center rounded-t-lg">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white truncate max-w-[80%]">
                {toolSection ? `工具: ${toolSection.name}` : '工具详情'}
              </h2>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-500 focus:outline-none dark:text-gray-300 dark:hover:text-gray-200"
                onClick={onClose}
              >
                <span className="sr-only">关闭面板</span>
                <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Panel content - 优化内部间距 */}
            <div className="px-5 py-4 w-full max-w-full">
              {toolSection ? (
                <div className="space-y-4 tool-panel-section w-full max-w-full">
                  {/* Tool type/status */}
                  <div>
                    <div className="flex items-center">
                      <div className={`h-3 w-3 rounded-full mr-2 ${
                        toolSection.type === 'tool_start' ? 'bg-blue-500' : 
                        toolSection.type === 'tool_execution' ? 'bg-yellow-500' : 
                        toolSection.type === 'tool_result' ? 'bg-green-500' : 'bg-red-500'
                      }`}></div>
                      <h3 className="text-md font-medium text-gray-900 dark:text-white">
                        {toolSection.type === 'tool_start' ? '工具启动' : 
                         toolSection.type === 'tool_execution' ? '工具执行中' : 
                         toolSection.type === 'tool_result' ? '工具结果' : '工具错误'}
                      </h3>
                    </div>
                  </div>

                  {/* Tool name */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">工具名称</h4>
                    <p className="mt-1 text-md text-gray-900 dark:text-white break-words">{toolSection.name}</p>
                  </div>

                  {/* Original content */}
                  {toolSection.content && (
                    <div className="w-full max-w-full">
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">原始内容</h4>
                      <div className="mt-1 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg overflow-auto max-h-40 w-full">
                        <div className="tool-panel-content prose prose-sm dark:prose-invert max-w-full w-full break-words">
                          <CustomReactMarkdown>
                            {toolSection.content}
                          </CustomReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tool input */}
                  {toolSection.input && (
                    <div className="w-full max-w-full">
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">输入参数</h4>
                      <div className="mt-1 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg overflow-auto w-full">
                        <pre className="tool-panel-json text-sm text-gray-900 dark:text-gray-100 break-words w-full" style={{ maxWidth: '100%', overflowWrap: 'break-word' }}>
                          {typeof toolSection.input === 'string' 
                            ? toolSection.input 
                            : JSON.stringify(toolSection.input, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Tool result */}
                  {toolSection.result && (
                    <div className="w-full max-w-full">
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">结果</h4>
                      <div className="mt-1 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg overflow-auto w-full">
                        <div className="tool-panel-content prose prose-sm dark:prose-invert max-w-full w-full break-words" style={{ maxWidth: '100%' }}>
                          {typeof toolSection.result === 'string' ? (
                            <CustomReactMarkdown>
                              {toolSection.result}
                            </CustomReactMarkdown>
                          ) : (
                            <pre className="tool-panel-json break-words w-full" style={{ maxWidth: '100%', overflowWrap: 'break-word' }}>
                              {JSON.stringify(toolSection.result, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tool error */}
                  {toolSection.error && (
                    <div className="w-full max-w-full">
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">错误</h4>
                      <div className="mt-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 rounded-lg w-full">
                        <p className="tool-panel-content text-sm text-red-800 dark:text-red-300 break-words w-full">{toolSection.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">没有可用的工具详情</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ToolPanel; 