import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolSection } from '../../types';

interface ToolPanelProps {
  isOpen: boolean;
  onClose: () => void;
  toolSection: ToolSection | null;
}

// Custom Markdown rendering component
const CustomReactMarkdown: React.FC<{children: string}> = ({ children }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Custom pre tag rendering
        pre: (props) => (
          <pre 
            className="whitespace-pre-wrap break-words max-w-full overflow-x-auto"
            style={{ maxWidth: '100%', overflowWrap: 'break-word' }}
            {...props}
          />
        ),
        // Custom code tag rendering
        code: ({className, children, ...props}: any) => {
          const match = /language-(\w+)/.exec(className || '');
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const language = match ? match[1] : '';
          const isInline = !className || !match;
          
          if (!isInline) {
            // Code block
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
          
          // Inline code
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
        // Custom p tag rendering
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
  
  // Ensure state is correct when component mounts
  useEffect(() => {
    // If initial state is open, apply open animation
    if (isOpen) {
      requestAnimationFrame(() => {
        setIsAnimating(true);
      });
    }
  }, [isOpen]); // Add isOpen as dependency

  useEffect(() => {
    if (isOpen) {
      // First show panel but keep in initial position (transform: translateX(100%))
      setIsAnimating(false); // First set to false to ensure correct initial state
      setIsVisible(true);
      
      // Use requestAnimationFrame to ensure DOM updates before applying animation
      requestAnimationFrame(() => {
        // Apply open animation in the next frame
        requestAnimationFrame(() => {
          setIsAnimating(true); // Then set to true to trigger transition animation
        });
      });
      
    } else {
      // Start close animation
      setIsAnimating(false);
      
      // Wait for animation to complete then hide panel
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 400); // Same as transition duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Console output for debugging - moved to separate useEffect
  useEffect(() => {
    // Only log when tool section changes, avoid interaction with animation state changes
    if (isOpen && toolSection) {
      console.log("Tool panel opened with section:", toolSection);
    }
  }, [isOpen, toolSection]);

  // If panel is neither visible nor animating, don't render anything
  if (!isVisible && !isOpen) return null;

  // Enhanced tool panel styles
  const toolPanelStyles = `
    /* Ensure content wraps correctly */
    .tool-panel-content {
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      overflow-wrap: break-word !important;
      word-break: break-word !important;
      max-width: 100% !important;
    }
    
    /* Preserve code block formatting */
    .tool-panel-content pre {
      white-space: pre-wrap !important;
      overflow-x: auto;
      max-width: 100%;
      margin: 0.5em 0;
      border-radius: 0.5rem;
    }
    
    /* Add styles for inline code */
    .tool-panel-content code {
      white-space: pre-wrap !important;
      word-break: break-word !important;
      border-radius: 0.25rem;
    }
    
    /* JSON content styles */
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
    
    /* Override any styles that may interfere with line wrapping */
    .tool-panel .overflow-auto {
      max-width: 100% !important;
      overflow-x: auto !important;
      border-radius: 0.5rem;
    }
    
    /* Ensure content area displays correctly */
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
        
        {/* Sliding panel - using inline transition styles with scale effect */}
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
                {toolSection ? `Tool: ${toolSection.name}` : 'Tool Details'}
              </h2>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-500 focus:outline-none dark:text-gray-300 dark:hover:text-gray-200"
                onClick={onClose}
              >
                <span className="sr-only">Close panel</span>
                <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Panel content - optimized internal spacing */}
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
                        {toolSection.type === 'tool_start' ? 'Tool Start' :
                         toolSection.type === 'tool_execution' ? 'Tool Executing' :
                         toolSection.type === 'tool_result' ? 'Tool Result' : 'Tool Error'}
                      </h3>
                    </div>
                  </div>

                  {/* Tool name */}
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Tool Name</h4>
                    <p className="mt-1 text-md text-gray-900 dark:text-white break-words">{toolSection.name}</p>
                  </div>

                  {/* Original content */}
                  {toolSection.content && (
                    <div className="w-full max-w-full">
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Original Content</h4>
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
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Input Parameters</h4>
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
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Result</h4>
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
                      <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400">Error</h4>
                      <div className="mt-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 rounded-lg w-full">
                        <p className="tool-panel-content text-sm text-red-800 dark:text-red-300 break-words w-full">{toolSection.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">No tool details available</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ToolPanel; 