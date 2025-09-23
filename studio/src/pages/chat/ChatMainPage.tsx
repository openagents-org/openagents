import React, { useCallback, useRef, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import ThreadMessagingViewEventBased from "@/components/chat/ThreadMessagingViewEventBased";
import { useThreadStore } from "@/stores/threadStore";
import { useNetworkStore } from "@/stores/networkStore";
import { ThreadState } from "@/types/thread";
/**
 * 聊天主页面 - 处理聊天相关的所有功能
 */
const ChatMainPage: React.FC = () => {
  const { agentName } = useNetworkStore();

  const { threadState, setThreadState } = useThreadStore();

  // 线程消息引用
  const threadMessagingRef = useRef<{
    getState: () => ThreadState;
    selectChannel: (channel: string) => void;
    selectDirectMessage: (agentId: string) => void;
  } | null>(null);

  // 线程状态变化处理器
  const handleThreadStateChange = useCallback(
    (newState: ThreadState) => {
      setThreadState(newState);
    },
    [setThreadState]
  );

  // 注意：自动选择第一个channel的逻辑现在由ThreadMessagingViewEventBased负责

  // 监听 threadStore 状态变化，同步到 ThreadMessagingViewEventBased
  useEffect(() => {
    const currentChannel = threadState?.currentChannel;
    const currentDirectMessage = threadState?.currentDirectMessage;

    if (threadMessagingRef.current) {
      if (currentChannel) {
        console.log(`🔄 Syncing to channel: ${currentChannel}`);
        threadMessagingRef.current.selectChannel(currentChannel);
      } else if (currentDirectMessage) {
        console.log(`🔄 Syncing to DM: ${currentDirectMessage}`);
        threadMessagingRef.current.selectDirectMessage(currentDirectMessage);
      }
    }
  }, [threadState?.currentChannel, threadState?.currentDirectMessage]);

  return (
    <Routes>
      {/* 默认聊天视图 */}
      <Route
        index
        element={
          <ThreadMessagingViewEventBased
            ref={threadMessagingRef}
            agentName={agentName!}
            onThreadStateChange={handleThreadStateChange}
          />
        }
      />

      {/* 其他聊天相关的子路由可以在这里添加 */}
    </Routes>
  );
};

export default ChatMainPage;
