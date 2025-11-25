import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useOpenAgents } from "../../context/OpenAgentsProvider";
import MessageRenderer from "../../components/chat/MessageRenderer";
import MessageInput from "../../components/chat/MessageInput";
import { useThemeStore } from "../../stores/themeStore";
import { CONNECTED_STATUS_COLOR } from "../../constants/chatConstants";
import { useAuthStore } from "../../stores/authStore";
import { toast } from "sonner";
import { UnifiedMessage } from "../../types/message";
import { ProjectTemplate } from "../../utils/projectUtils";

interface ProjectChatRoomProps {
  channelName?: string;
  projectId?: string;
}

const ProjectChatRoom: React.FC<ProjectChatRoomProps> = ({
  channelName: propChannelName,
  projectId: propProjectId,
}) => {
  const { agentName } = useAuthStore();
  const { theme: currentTheme } = useThemeStore();
  const { connector, connectionStatus, isConnected } = useOpenAgents();
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const routeOrPropProjectId = routeProjectId || propProjectId;

  const pendingTemplate = (location.state as any)?.pendingTemplate as
    | ProjectTemplate
    | undefined;
  const isPendingProject =
    routeOrPropProjectId === "new" && pendingTemplate !== undefined;
  const projectId = isPendingProject ? null : routeOrPropProjectId;

  const [projectInfo, setProjectInfo] = useState<{
    channelName?: string;
    name?: string;
    goal?: string;
    initiator_agent_id?: string;
    created_timestamp?: number;
    status?: string;
    summary?: string;
    completed_timestamp?: number;
  } | null>(null);

  const channelName =
    propChannelName ||
    projectInfo?.channelName ||
    (projectId ? `project-${projectId}` : null) ||
    (isPendingProject ? `pending-${pendingTemplate?.template_id}` : null);

  const isProjectCompleted =
    projectInfo?.status === "completed" ||
    projectInfo?.status === "stopped" ||
    projectInfo?.status === "failed";

  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [isStartingProject, setIsStartingProject] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef<number>(0);
  const prevScrollHeight = useRef<number>(0);

  useEffect(() => {
    const loadProjectInfo = async () => {
      if (!projectId || !connector || !isConnected) return;

      try {
        const agentId = connectionStatus.agentId || connector.getAgentId();
        const response = await connector.sendEvent({
          event_name: "project.get",
          source_id: agentId,
          destination_id: "mod:openagents.mods.workspace.project",
          payload: {
            project_id: projectId,
          },
        });

        if (response.success && response.data?.project) {
          const project = response.data.project;
          const projectChannelName =
            project.channel_name ||
            `project-${project.template_id || "unknown"}-${projectId}`;

          setProjectInfo({
            channelName: projectChannelName,
            name: project.name,
            goal: project.goal,
            initiator_agent_id: project.initiator_agent_id,
            created_timestamp: project.created_timestamp,
            status: project.status,
            summary: project.summary,
            completed_timestamp: project.completed_timestamp,
          });

          const allMessages: UnifiedMessage[] = [];

          if (project.goal) {
            const goalMessage: UnifiedMessage = {
              id: `goal-${projectId}`,
              senderId: project.initiator_agent_id || "",
              content: project.goal,
              timestamp: String(
                project.started_timestamp ||
                  project.created_timestamp ||
                  Date.now()
              ),
              type: "channel_message",
              channel: projectChannelName,
            };
            allMessages.push(goalMessage);
          }

          if (project.messages && Array.isArray(project.messages)) {
            const historyMessages = project.messages.map((msg: any) => {
              let messageContent = msg.content?.text || "";

              if (
                msg.attachments &&
                Array.isArray(msg.attachments) &&
                msg.attachments.length > 0
              ) {
                const attachmentNames = msg.attachments
                  .map((att: any) => att.filename || att.file_id)
                  .join(", ");
                messageContent += messageContent
                  ? ` 📎 ${attachmentNames}`
                  : `📎 ${attachmentNames}`;
              }

              return {
                id: msg.message_id,
                senderId: msg.sender_id || "",
                content: messageContent,
                timestamp: String(msg.timestamp || Date.now()),
                type: "channel_message",
                channel: projectChannelName,
              } as UnifiedMessage;
            });

            allMessages.push(...historyMessages);
          }

          if (
            project.summary &&
            (project.status === "completed" ||
              project.status === "stopped" ||
              project.status === "failed")
          ) {
            const summaryMessage: UnifiedMessage = {
              id: `summary-${projectId}`,
              senderId: "system",
              content: `📋 **Project ${
                project.status === "completed"
                  ? "Completed"
                  : project.status === "stopped"
                    ? "Stopped"
                    : "Failed"
              }**\n\n${project.summary}`,
              timestamp: String(project.completed_timestamp || Date.now()),
              type: "channel_message",
              channel: projectChannelName,
            };
            allMessages.push(summaryMessage);
          }

          setMessages(allMessages);
        }
      } catch (error) {
        console.error("Failed to load project info:", error);
        if (!propChannelName) {
          setProjectInfo({
            channelName: `project-${projectId}`,
          });
        }
      }
    };

    if (projectId) {
      loadProjectInfo();
    }
  }, [
    projectId,
    connector,
    isConnected,
    connectionStatus.agentId,
    propChannelName,
  ]);

  useEffect(() => {
    if (!isConnected || !connector) return;

    const handleProjectMessage = (event: any) => {
      if (event.event_name === "project.notification.message_received") {
        const messageData = event.payload || {};
        const eventProjectId = messageData.project_id;

        if (eventProjectId === projectId) {
          const messageId =
            messageData.message_id || `project-msg-${Date.now()}`;
          let messageContent = messageData.content?.text || "";

          if (
            messageData.attachments &&
            Array.isArray(messageData.attachments) &&
            messageData.attachments.length > 0
          ) {
            const attachmentNames = messageData.attachments
              .map((att: any) => att.filename || att.file_id)
              .join(", ");
            messageContent += messageContent
              ? ` 📎 ${attachmentNames}`
              : `📎 ${attachmentNames}`;
          }

          const unifiedMessage: UnifiedMessage = {
            id: messageId,
            senderId: messageData.sender_id || "",
            content: messageContent,
            timestamp: String(messageData.timestamp || Date.now()),
            type: "channel_message",
            channel: channelName,
          };

          setMessages((prev) => {
            const messageExists = prev.some(
              (msg) => msg.id === unifiedMessage.id
            );
            if (messageExists) {
              return prev;
            }

            const filtered = prev.filter((msg) => {
              if (
                msg.id.startsWith("temp-") &&
                msg.senderId === unifiedMessage.senderId &&
                msg.content === unifiedMessage.content
              ) {
                return false;
              }
              return true;
            });

            return [...filtered, unifiedMessage];
          });
        }
      }
    };

    connector.on("rawEvent", handleProjectMessage);

    return () => {
      connector.off("rawEvent", handleProjectMessage);
    };
  }, [isConnected, connector, projectId, channelName, connectionStatus.agentId]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const messagesEnd = messagesEndRef.current;

    if (!container || !messagesEnd) return;

    const isNewMessage = messages.length > (prevMessagesLength.current ?? 0);
    const currentScrollHeight = container.scrollHeight;
    const previousScrollHeight = prevScrollHeight.current || 0;

    prevMessagesLength.current = messages.length;
    prevScrollHeight.current = currentScrollHeight;

    if (isNewMessage) {
      const { scrollTop, clientHeight } = container;
      const originalDistanceFromBottom =
        previousScrollHeight - scrollTop - clientHeight;
      const isNearBottom = originalDistanceFromBottom < 100;

      if (isNearBottom) {
        messagesEnd.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      messagesEnd.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (!isConnected || !connector) return;

    const handleProjectCompletion = (event: any) => {
      if (event.event_name === "project.notification.completed") {
        const projectData = event.payload || {};
        const eventProjectId = projectData.project_id;
        const summary = projectData.summary || "Project completed";
        const completedTimestamp = projectData.completed_timestamp || Date.now();

        if (eventProjectId === projectId) {
          toast.success("Project completed", {
            description: summary,
            duration: 10000,
          });

          setProjectInfo((prev) =>
            prev
              ? {
                  ...prev,
                  status: "completed",
                  summary: summary,
                  completed_timestamp: completedTimestamp,
                }
              : prev
          );

          const summaryMessage: UnifiedMessage = {
            id: `summary-${projectId}`,
            senderId: "system",
            content: `📋 **Project Completed**\n\n${summary}`,
            timestamp: String(completedTimestamp),
            type: "channel_message",
            channel: channelName || "",
          };

          setMessages((prev) => {
            const summaryExists = prev.some(
              (msg) => msg.id === `summary-${projectId}`
            );
            if (summaryExists) {
              return prev;
            }
            return [...prev, summaryMessage];
          });
        }
      }

      if (event.event_name === "project.notification.stopped") {
        const projectData = event.payload || {};
        const eventProjectId = projectData.project_id;
        const reason = projectData.reason || "Project stopped";
        const stoppedTimestamp = projectData.stopped_timestamp || Date.now();

        if (eventProjectId === projectId) {
          toast.info("Project stopped", {
            description: reason,
            duration: 10000,
          });

          setProjectInfo((prev) =>
            prev
              ? {
                  ...prev,
                  status: "stopped",
                  summary: reason,
                  completed_timestamp: stoppedTimestamp,
                }
              : prev
          );

          const stoppedMessage: UnifiedMessage = {
            id: `summary-${projectId}`,
            senderId: "system",
            content: `⏹️ **Project Stopped**\n\n${reason}`,
            timestamp: String(stoppedTimestamp),
            type: "channel_message",
            channel: channelName || "",
          };

          setMessages((prev) => {
            const summaryExists = prev.some(
              (msg) => msg.id === `summary-${projectId}`
            );
            if (summaryExists) {
              return prev;
            }
            return [...prev, stoppedMessage];
          });
        }
      }
    };

    connector.on("rawEvent", handleProjectCompletion);

    return () => {
      connector.off("rawEvent", handleProjectCompletion);
    };
  }, [isConnected, connector, projectId, channelName]);

  const handleSendMessage = useCallback(
    async (
      content: string,
      attachmentData?: {
        file_id: string;
        filename: string;
        size: number;
      }
    ) => {
      if ((!content.trim() && !attachmentData) || sendingMessage || !connector)
        return;

      if (isPendingProject && pendingTemplate) {
        setIsStartingProject(true);
        setSendingMessage(true);

        try {
          const agentId = connectionStatus.agentId || connector.getAgentId();

          const startResponse = await connector.sendEvent({
            event_name: "project.start",
            source_id: agentId,
            destination_id: "mod:openagents.mods.workspace.project",
            payload: {
              template_id: pendingTemplate.template_id,
              goal: content.trim(),
              name: pendingTemplate.name,
              collaborators: [],
            },
          });

          if (!startResponse.success || !startResponse.data?.project_id) {
            throw new Error(startResponse.message || "Failed to start project");
          }

          const newProjectId = startResponse.data.project_id;

          toast.success("Project started successfully!");

          navigate(`/project/${newProjectId}`, { replace: true });
        } catch (error: any) {
          console.error("Failed to start project:", error);
          toast.error(
            `Failed to start project: ${error.message || "Unknown error"}`
          );
        } finally {
          setIsStartingProject(false);
          setSendingMessage(false);
        }
        return;
      }

      setSendingMessage(true);

      try {
        const agentId = connectionStatus.agentId || connector.getAgentId();

        const payload: any = {
          project_id: projectId,
          content: {
            text: content.trim() || "",
          },
        };

        if (attachmentData) {
          payload.attachments = [
            {
              file_id: attachmentData.file_id,
              filename: attachmentData.filename,
              size: attachmentData.size,
            },
          ];
        }

        const messageResponse = await connector.sendEvent({
          event_name: "project.message.send",
          source_id: agentId,
          destination_id: "mod:openagents.mods.workspace.project",
          payload,
        });

        if (messageResponse.success) {
          const currentAgentId = connectionStatus.agentId || connector.getAgentId();
          let messageContent = content.trim();
          if (attachmentData) {
            messageContent += messageContent
              ? ` 📎 ${attachmentData.filename}`
              : `📎 ${attachmentData.filename}`;
          }
          const optimisticMessage: UnifiedMessage = {
            id: `temp-${Date.now()}`,
            senderId: currentAgentId,
            content: messageContent,
            timestamp: String(Date.now()),
            type: "channel_message",
            channel: channelName,
          };

          setMessages((prev) => [...prev, optimisticMessage]);
        } else {
          throw new Error(
            messageResponse.message || "Failed to send project message"
          );
        }
      } catch (error: any) {
        console.error("Failed to send project message:", error);
        toast.error(
          `Failed to send message: ${error.message || "Unknown error"}`
        );
      } finally {
        setSendingMessage(false);
      }
    },
    [
      sendingMessage,
      connector,
      projectId,
      channelName,
      connectionStatus.agentId,
      isPendingProject,
      pendingTemplate,
      navigate,
    ]
  );

  const getConnectionStatusColor = useMemo(() => {
    return (
      CONNECTED_STATUS_COLOR[connectionStatus.state] ||
      CONNECTED_STATUS_COLOR["default"]
    );
  }, [connectionStatus.state]);

  const clearError = useCallback(() => {
    setMessagesError(null);
  }, []);

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const parseTimestamp = (timestamp: string | number): number => {
        if (!timestamp) return 0;

        const timestampStr = String(timestamp);

        if (timestampStr.includes("T") || timestampStr.includes("-")) {
          const time = new Date(timestampStr).getTime();
          return isNaN(time) ? 0 : time;
        }

        const num = parseInt(timestampStr);
        if (isNaN(num)) return 0;

        if (num < 10000000000) {
          return num * 1000;
        } else {
          return num;
        }
      };

      const aTime = parseTimestamp(a.timestamp);
      const bTime = parseTimestamp(b.timestamp);

      return aTime - bTime;
    });
  }, [messages]);

  if (!projectId && !isPendingProject) {
    return (
      <div className="project-chat-room h-full flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
            />
          </svg>
          <p className="text-lg mb-2">Select a Project</p>
          <p className="text-sm">
            Choose a project from the left sidebar to view its private chat room
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="project-chat-room h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="thread-header flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: getConnectionStatusColor }}
            title={`Connection: ${connectionStatus.state}`}
          />
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {isPendingProject
                ? `New Project: ${pendingTemplate?.name || "Pending"}`
                : channelName
                  ? `#${
                      channelName.startsWith("#")
                        ? channelName.slice(1)
                        : channelName
                    }`
                  : `Project ${projectId?.slice(0, 8)}...`}
            </span>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                isPendingProject
                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                  : isProjectCompleted
                    ? projectInfo?.status === "completed"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              }`}
            >
              {isPendingProject
                ? "Waiting for Goal"
                : isProjectCompleted
                  ? projectInfo?.status === "completed"
                    ? "✓ Completed"
                    : projectInfo?.status === "stopped"
                      ? "⏹️ Stopped"
                      : "Closed"
                  : "Project Chat Room"}
            </span>
          </div>
        </div>
      </div>

      {messagesError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm dark:bg-red-900 dark:border-red-700 dark:text-red-100">
          <span>Error: {messagesError}</span>
          <button
            onClick={clearError}
            className="ml-2 text-red-500 hover:text-red-700 dark:text-red-300 dark:hover:text-red-100"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0">
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
          {sortedMessages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              {isPendingProject ? (
                <>
                  <svg
                    className="w-16 h-16 mx-auto mb-4 text-yellow-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <p className="text-lg mb-2 font-semibold">
                    Ready to Start Project
                  </p>
                  <p className="text-sm mb-4">
                    Template: <strong>{pendingTemplate?.name}</strong>
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Type your first message below to define the project goal and
                    start the project.
                  </p>
                  <p className="text-xs mt-2 text-gray-400">
                    Your message will be used as the project goal.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg mb-2">Welcome to Project Chat Room</p>
                  <p className="text-sm">Send your first message!</p>
                </>
              )}
            </div>
          ) : (
            <>
              <MessageRenderer
                messages={sortedMessages}
                currentUserId={connectionStatus.agentId || agentName || ""}
                isDMChat={false}
                disableReactions={true}
                disableQuotes={true}
                renderMode="flat"
                onQuote={() => {
                  toast.error("Quote is not supported in project chat room");
                }}
                onReaction={() => {
                  toast.error("Reactions are not supported in project chat room");
                }}
              />
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {isProjectCompleted ? (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
            <div className="text-center text-gray-500 dark:text-gray-400 py-2">
              <span className="inline-flex items-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                This project has been{" "}
                {projectInfo?.status === "completed"
                  ? "completed"
                  : projectInfo?.status === "stopped"
                    ? "stopped"
                    : "closed"}
                . No further messages can be sent.
              </span>
            </div>
          </div>
        ) : (
          <MessageInput
            agents={[]}
            onSendMessage={(
              text: string,
              _replyTo?: string,
              _quotedMessageId?: string,
              attachmentData?: {
                file_id: string;
                filename: string;
                size: number;
              }
            ) => {
              handleSendMessage(text, attachmentData);
            }}
            disabled={sendingMessage || isStartingProject || !isConnected}
            placeholder={
              isStartingProject
                ? "Starting project..."
                : sendingMessage
                  ? "Sending..."
                  : isPendingProject
                    ? "Type your project goal to start the project..."
                    : `Send a message in project chat room...`
            }
            currentTheme={currentTheme}
            currentChannel={channelName}
            currentAgentId={connectionStatus.agentId || agentName || ""}
            replyingTo={null}
            quotingMessage={null}
            onCancelReply={() => {}}
            onCancelQuote={() => {}}
            disableEmoji={true}
            disableMentions={true}
            disableFileUpload={isPendingProject ? true : false}
          />
        )}
      </div>
    </div>
  );
};

ProjectChatRoom.displayName = "ProjectChatRoom";

export default ProjectChatRoom;

