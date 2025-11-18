import React, { useState, useRef, useEffect } from "react";

/**
 * AgentWorld主页面 - 使用 iframe 嵌套显示外部页面
 */
const AgentWorldMainPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleIframeLoad = () => {
    // 延迟一点时间确保 CSS 也加载完成
    timeoutRef.current = setTimeout(() => {
      setIsLoading(false);
    }, 500);
  };

  useEffect(() => {
    return () => {
      // 清理定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="h-full w-full relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">
              Loading AgentWorld...
            </p>
          </div>
        </div>
      )}
      <iframe
        src="http://narita1.acenta.ai:7032/"
        className="w-full h-full border-0"
        title="AgentWorld"
        allow="fullscreen"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-top-navigation"
        onLoad={handleIframeLoad}
        style={{ opacity: isLoading ? 0 : 1, transition: "opacity 0.3s ease-in-out" }}
      />
    </div>
  );
};

export default AgentWorldMainPage;

