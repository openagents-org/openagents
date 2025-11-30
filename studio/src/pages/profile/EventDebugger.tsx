import React, { useState, useEffect, useCallback } from "react";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { Event, EventResponse } from "@/types/events";

const EventDebugger: React.FC = () => {
  const { connector, isConnected } = useOpenAgents();
  const { agentName } = useAuthStore();
  const [eventName, setEventName] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [payload, setPayload] = useState("");
  const [response, setResponse] = useState<EventResponse | null>(null);
  const [sentEvent, setSentEvent] = useState<Event | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);

  // Validate and parse JSON payload
  const validatePayload = (jsonString: string): any | null => {
    if (!jsonString.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(jsonString);
      setPayloadError(null);
      return parsed;
    } catch (e: any) {
      setPayloadError(`Invalid JSON format: ${e.message}`);
      return null;
    }
  };

  // Clear response and errors
  const clearResponse = () => {
    setResponse(null);
    setSentEvent(null);
    setError(null);
    setPayloadError(null);
  };

  // Load example event
  const loadExample = (exampleName: string) => {
    const examples: Record<string, { eventName: string; destinationId: string; payload: string }> = {
      directMessage: {
        eventName: "thread.direct_message.send",
        destinationId: "agent:target_agent_id",
        payload: JSON.stringify(
          {
            target_agent_id: "target_agent_id",
            content: { text: "Hello, this is a test message" },
            message_type: "direct_message",
          },
          null,
          2
        ),
      },
      channelMessage: {
        eventName: "thread.channel_message.post",
        destinationId: "channel:general",
        payload: JSON.stringify(
          {
            channel: "general",
            content: { text: "Hello channel!" },
            message_type: "channel_message",
          },
          null,
          2
        ),
      },
      projectList: {
        eventName: "project.list",
        destinationId: "mod:openagents.mods.workspace.project",
        payload: JSON.stringify({}, null, 2),
      },
      channelsList: {
        eventName: "thread.channels.list",
        destinationId: "mod:openagents.mods.workspace.messaging",
        payload: JSON.stringify({}, null, 2),
      },
    };

    const example = examples[exampleName];
    if (example) {
      setEventName(example.eventName);
      setDestinationId(example.destinationId);
      setPayload(example.payload);
      clearResponse();
    }
  };

  // Send event
  const handleSend = useCallback(async () => {
    if (!connector) {
      setError("Not connected to network, please connect first");
      return;
    }

    if (!isConnected) {
      setError("Network not connected, please check connection status");
      return;
    }

    if (!eventName.trim()) {
      setError("Please enter event name");
      return;
    }

    setError(null);
    setPayloadError(null);
    setIsSending(true);

      // Define event outside try block so it can be used in catch block
      let event: Event | null = null;

      try {
        // Parse payload
        const parsedPayload = validatePayload(payload);
        if (parsedPayload === null) {
          setIsSending(false);
          return;
        }

        // Build event
        event = {
          event_name: eventName.trim(),
          source_id: agentName || "debugger",
          destination_id: destinationId.trim() || undefined,
          payload: parsedPayload,
          timestamp: Math.floor(Date.now() / 1000),
        };

        // Save sent event (for display)
        setSentEvent(event);
        setResponse(null);

        // Send event (will be automatically logged)
        const eventResponse = await connector.sendEvent(event);

        // Display response
        setResponse(eventResponse);
      } catch (err: any) {
        console.error("Failed to send event:", err);
        const errorMessage = err.message || "Failed to send event";
        setError(errorMessage);
      
      // Record response even on failure
      const errorResponse: EventResponse = {
        success: false,
        message: errorMessage,
        event_name: event?.event_name || eventName.trim(),
      };
      setResponse(errorResponse);
    } finally {
      setIsSending(false);
    }
  }, [connector, isConnected, eventName, payload, agentName, destinationId]);

  // Keyboard shortcut support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Enter or Cmd+Enter to send event
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (!isSending && eventName.trim() && connector && isConnected) {
          handleSend();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSending, eventName, connector, isConnected, handleSend]);

  // Format JSON
  const formatJSON = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Event Debugger
          </h1>
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected && connector
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isConnected && connector ? "Connected" : "Not Connected"}
            </span>
          </div>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          For debugging and testing event sending. All sent events will be automatically recorded to Event Logs page.
        </p>
      </div>

      {/* Example Events */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => loadExample("directMessage")}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Example: Direct Message
        </button>
        <button
          onClick={() => loadExample("channelMessage")}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Example: Channel Message
        </button>
        <button
          onClick={() => loadExample("projectList")}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Example: Project List
        </button>
        <button
          onClick={() => loadExample("channelsList")}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Example: Channels List
        </button>
      </div>

      {/* Form */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="space-y-4">
          {/* Event Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Event Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => {
                setEventName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (!isSending && eventName.trim() && connector && isConnected) {
                    handleSend();
                  }
                }
              }}
              placeholder="e.g., thread.direct_message.send"
              className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Destination ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Destination ID
            </label>
            <input
              type="text"
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              placeholder="e.g., agent:target_agent_id or channel:general (optional)"
              className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Leave empty to send to entire network
            </p>
          </div>

          {/* Payload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Payload (JSON)
            </label>
            <textarea
              value={payload}
              onChange={(e) => {
                setPayload(e.target.value);
                setPayloadError(null);
              }}
              rows={10}
              placeholder='{"key": "value"}'
              className={`w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm ${
                payloadError
                  ? "border-red-300 dark:border-red-600"
                  : ""
              }`}
            />
            {payloadError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {payloadError}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Enter valid JSON data, leave empty to use empty object
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <svg
                    className="h-5 w-5 text-red-400 mr-2 flex-shrink-0"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm text-red-800 dark:text-red-200">
                    {error}
                  </span>
                </div>
                <button
                  onClick={clearResponse}
                  className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 ml-2"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Send Button */}
          <div className="flex justify-between items-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tip: Press <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded">Ctrl+Enter</kbd> or <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded">Cmd+Enter</kbd> to send quickly
            </p>
            <button
              onClick={handleSend}
              disabled={isSending || !eventName.trim() || !connector || !isConnected}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? "Sending..." : "Send Event"}
            </button>
          </div>
        </div>
      </div>

      {/* Sent Event Details */}
      {sentEvent && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Sent Event
            </h2>
            <button
              onClick={clearResponse}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="Clear"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-600 dark:text-gray-400 font-medium">Event Name:</span>
              <span className="ml-2 text-gray-900 dark:text-gray-100 font-mono">{sentEvent.event_name}</span>
            </div>
            {sentEvent.source_id && (
              <div>
                <span className="text-gray-600 dark:text-gray-400 font-medium">Source ID:</span>
                <span className="ml-2 text-gray-900 dark:text-gray-100 font-mono">{sentEvent.source_id}</span>
              </div>
            )}
            {sentEvent.destination_id && (
              <div>
                <span className="text-gray-600 dark:text-gray-400 font-medium">Destination ID:</span>
                <span className="ml-2 text-gray-900 dark:text-gray-100 font-mono">{sentEvent.destination_id}</span>
              </div>
            )}
          </div>
          <div className="mt-4 bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 font-medium">Complete Event Data:</div>
            <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {formatJSON(sentEvent)}
            </pre>
          </div>
        </div>
      )}

      {/* Event Response */}
      {response && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Event Response
            </h2>
            <button
              onClick={clearResponse}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title="Clear"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="mb-4">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                response.success
                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
              }`}
            >
              {response.success ? "✓ Success" : "✗ Failed"}
            </span>
            {response.message && (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {response.message}
              </p>
            )}
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {formatJSON(response)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventDebugger;

