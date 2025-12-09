import React, { useEffect, useState } from "react";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import KanbanBoard from "./components/KanbanBoard";
import ArtifactsPanel from "./components/ArtifactsPanel";

interface ChatMessage {
  id: string;
  content: string;
  sender: string;
  timestamp: number;
}

// Simple chat panel - integrates with existing messaging infrastructure
const ChatPanel: React.FC = () => {
  const { currentSession } = usePlaygroundStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");

  // In a full implementation, this would connect to the messaging system
  // using the currentSession.channel_id

  const handleSend = () => {
    if (!newMessage.trim()) return;

    const msg: ChatMessage = {
      id: Date.now().toString(),
      content: newMessage.trim(),
      sender: "You",
      timestamp: Date.now(),
    };

    setMessages([...messages, msg]);
    setNewMessage("");
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Chat Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Chat
        </h2>
        {currentSession && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Channel: {currentSession.channel_id}
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-sm font-medium">
                  {msg.sender.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-gray-900 dark:text-white text-sm">
                    {msg.sender}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-gray-700 dark:text-gray-300 text-sm mt-1">
                  {msg.content}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
              bg-white dark:bg-gray-700 text-gray-900 dark:text-white
              focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            onClick={handleSend}
            disabled={!newMessage.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

// Panel resize handle
const ResizeHandle: React.FC<{ onResize: (delta: number) => void; direction: "horizontal" | "vertical" }> = ({
  onResize,
  direction,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      onResize(direction === "horizontal" ? e.movementX : e.movementY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, onResize, direction]);

  return (
    <div
      className={`
        ${direction === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}
        bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600
        transition-colors flex-shrink-0
        ${isDragging ? "bg-blue-500" : ""}
      `}
      onMouseDown={() => setIsDragging(true)}
    />
  );
};

const PlaygroundView: React.FC = () => {
  const { currentSession, currentBoard } = usePlaygroundStore();
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);

  const handleLeftResize = (delta: number) => {
    setLeftPanelWidth((w) => Math.max(200, Math.min(500, w + delta)));
  };

  const handleRightResize = (delta: number) => {
    setRightPanelWidth((w) => Math.max(200, Math.min(500, w - delta)));
  };

  if (!currentSession) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <svg
            className="w-20 h-20 mx-auto mb-4 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
            No Session Selected
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Select or create a playground session to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-gray-100 dark:bg-gray-900">
      {/* Left Panel - Chat */}
      <div
        className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700"
        style={{ width: leftPanelWidth }}
      >
        <ChatPanel />
      </div>

      <ResizeHandle onResize={handleLeftResize} direction="horizontal" />

      {/* Center Panel - Kanban Board */}
      <div className="flex-1 min-w-0 bg-white dark:bg-gray-800">
        <KanbanBoard />
      </div>

      <ResizeHandle onResize={handleRightResize} direction="horizontal" />

      {/* Right Panel - Artifacts */}
      <div
        className="flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        style={{ width: rightPanelWidth }}
      >
        <ArtifactsPanel />
      </div>
    </div>
  );
};

export default PlaygroundView;
