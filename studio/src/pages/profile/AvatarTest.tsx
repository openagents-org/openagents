/**
 * Avatar Test Page
 * 
 * A page for testing avatar functionality
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "sonner";
import Avatar from "@/components/avatar/Avatar";

const AvatarTest: React.FC = () => {
  const { connector } = useOpenAgents();
  const { agentName } = useAuthStore();
  const [networkHost, setNetworkHost] = useState<string | undefined>();
  const [networkPort, setNetworkPort] = useState<number | undefined>();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCurrentAvatar = useCallback(async () => {
    if (!connector || !agentName) {
      return;
    }

    try {
      // Use avatar.get event to load current avatar
      const response = await connector.sendEvent({
        event_name: "avatar.get",
        source_id: agentName,
        destination_id: "mod:openagents.mods.misc.agent_avatar",
        payload: {
          agent_id: agentName,
          include_data: false,
        },
      });

      if (response.success && response.data?.has_avatar && response.data?.avatar_url) {
        // Convert relative URL to absolute
        const host = connector.getHost();
        const port = connector.getPort();
        const protocol = window.location.protocol === "https:" ? "https:" : "http:";
        const baseUrl = `${protocol}//${host}:${port}`;
        const fullUrl = response.data.avatar_url.startsWith("/")
          ? `${baseUrl}${response.data.avatar_url}`
          : response.data.avatar_url;
        setAvatarUrl(fullUrl);
      } else {
        setAvatarUrl(null);
      }
    } catch (error) {
      console.error("Failed to load current avatar:", error);
    }
  }, [connector, agentName]);

  useEffect(() => {
    if (connector) {
      setNetworkHost(connector.getHost());
      setNetworkPort(connector.getPort());
      // Load current avatar on mount
      loadCurrentAvatar();
    }
  }, [connector, loadCurrentAvatar]);

  const runTests = async () => {
    if (!connector || !agentName) {
      toast.error("Not connected to network or not logged in");
      return;
    }

    setIsLoading(true);
    setTestResults("Starting tests...\n");
    
    try {
      // Test 1: avatar.get - Get single agent's avatar
      setTestResults((prev) => prev + "Test 1: avatar.get event (get own avatar)...\n");
      const getResponse = await connector.sendEvent({
        event_name: "avatar.get",
        source_id: agentName,
        destination_id: "mod:openagents.mods.misc.agent_avatar",
        payload: {
          agent_id: agentName,
          include_data: false,
        },
      });

      if (getResponse.success && getResponse.data) {
        const avatarData = getResponse.data;
        setTestResults(
          (prev) =>
            prev +
            `✅ avatar.get response:\n${JSON.stringify(avatarData, null, 2)}\n`
        );
        
        if (avatarData.has_avatar && avatarData.avatar_url) {
          // Convert relative URL to absolute
          const host = connector.getHost();
          const port = connector.getPort();
          const protocol = window.location.protocol === "https:" ? "https:" : "http:";
          const baseUrl = `${protocol}//${host}:${port}`;
          const fullUrl = avatarData.avatar_url.startsWith("/")
            ? `${baseUrl}${avatarData.avatar_url}`
            : avatarData.avatar_url;
          setAvatarUrl(fullUrl);
        } else {
          setAvatarUrl(null);
        }
      } else {
        setTestResults(
          (prev) => prev + `❌ avatar.get failed: ${getResponse.message || "Unknown error"}\n`
        );
      }

      // Test 2: avatar.get_batch - Get multiple avatars
      setTestResults((prev) => prev + "\nTest 2: avatar.get_batch event...\n");
      const batchResponse = await connector.sendEvent({
        event_name: "avatar.get_batch",
        source_id: agentName,
        destination_id: "mod:openagents.mods.misc.agent_avatar",
        payload: {
          agent_ids: [agentName, "test-agent-1", "test-agent-2"],
        },
      });

      if (batchResponse.success && batchResponse.data) {
        const batchData = batchResponse.data;
        setTestResults(
          (prev) =>
            prev +
            `✅ avatar.get_batch response:\n${JSON.stringify(batchData, null, 2)}\n`
        );
      } else {
        setTestResults(
          (prev) =>
            prev + `❌ avatar.get_batch failed: ${batchResponse.message || "Unknown error"}\n`
        );
      }

      // Test 3: Test avatar.get with another agent (if different agent exists)
      setTestResults((prev) => prev + "\nTest 3: avatar.get event (get another agent's avatar)...\n");
      const otherAgentResponse = await connector.sendEvent({
        event_name: "avatar.get",
        source_id: agentName,
        destination_id: "mod:openagents.mods.misc.agent_avatar",
        payload: {
          agent_id: "test-agent-1",
          include_data: false,
        },
      });

      if (otherAgentResponse.success && otherAgentResponse.data) {
        setTestResults(
          (prev) =>
            prev +
            `✅ avatar.get (other agent) response:\n${JSON.stringify(otherAgentResponse.data, null, 2)}\n`
        );
      } else {
        setTestResults(
          (prev) =>
            prev +
            `ℹ️ avatar.get (other agent): ${otherAgentResponse.message || "Agent may not exist"}\n`
        );
      }

      setTestResults((prev) => prev + "\n✅ All event tests completed!\n");
      toast.success("All tests completed successfully");
    } catch (error: any) {
      console.error("Avatar test error:", error);
      const errorMsg = `❌ Test failed: ${error.message || "Unknown error"}\n`;
      setTestResults((prev) => prev + errorMsg);
      toast.error(`Avatar test failed: ${error.message || "Unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) {
      toast.error("Invalid file type. Please select PNG, JPG, GIF, or WebP image.");
      return;
    }

    // Validate file size (512KB max)
    if (file.size > 512 * 1024) {
      toast.error("File too large. Maximum size is 512KB.");
      return;
    }

    setIsUploading(true);
    setTestResults("Uploading avatar...\n");

    try {
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix (e.g., "data:image/png;base64,")
          const base64Data = result.split(",")[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      if (!connector || !agentName) {
        throw new Error("Not connected to network or not logged in");
      }

      setTestResults((prev) => prev + "Sending avatar.set event...\n");

      // Send avatar.set event
      const response = await connector.sendEvent({
        event_name: "avatar.set",
        source_id: agentName,
        destination_id: "mod:openagents.mods.misc.agent_avatar",
        payload: {
          image_data: base64,
          mime_type: file.type,
          original_filename: file.name,
        },
      });

      if (response.success) {
        setTestResults(
          (prev) => prev + `✅ Avatar uploaded successfully!\nAvatar URL: ${response.data?.avatar_url || "N/A"}\n`
        );
        toast.success("Avatar uploaded successfully!");

        // Reload avatar
        await loadCurrentAvatar();
      } else {
        throw new Error(response.message || "Failed to upload avatar");
      }
    } catch (error: any) {
      console.error("Avatar upload error:", error);
      const errorMsg = `❌ Upload failed: ${error.message || "Unknown error"}\n`;
      setTestResults((prev) => prev + errorMsg);
      toast.error(`Avatar upload failed: ${error.message || "Unknown error"}`);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleClearAvatar = async () => {
    if (!connector || !agentName) {
      toast.error("Not connected to network or not logged in");
      return;
    }

    setIsUploading(true);
    setTestResults("Clearing avatar...\n");

    try {
      const response = await connector.sendEvent({
        event_name: "avatar.clear",
        source_id: agentName,
        destination_id: "mod:openagents.mods.misc.agent_avatar",
        payload: {},
      });

      if (response.success) {
        setTestResults((prev) => prev + "✅ Avatar cleared successfully!\n");
        toast.success("Avatar cleared successfully!");
        setAvatarUrl(null);

        // Reload avatar
        await loadCurrentAvatar();
      } else {
        throw new Error(response.message || "Failed to clear avatar");
      }
    } catch (error: any) {
      console.error("Avatar clear error:", error);
      const errorMsg = `❌ Clear failed: ${error.message || "Unknown error"}\n`;
      setTestResults((prev) => prev + errorMsg);
      toast.error(`Avatar clear failed: ${error.message || "Unknown error"}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-6 dark:bg-gray-900 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
          Avatar Functionality Test
        </h1>

        {/* Connection Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
            Connection Info
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Agent Name:</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {agentName || "Not logged in"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Network Address:</span>
              <span className="font-mono text-gray-900 dark:text-gray-100">
                {networkHost && networkPort
                  ? `${networkHost}:${networkPort}`
                  : "Not connected"}
              </span>
            </div>
          </div>
        </div>

        {/* Avatar Display */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
            Current Avatar
          </h2>
          <div className="flex items-center gap-4 mb-4">
            <Avatar
              src={avatarUrl}
              fallback={agentName || "?"}
              alt={agentName || "Unknown"}
              size={80}
            />
            <div className="flex-1">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {avatarUrl ? "Avatar is set" : "No avatar set"}
              </p>
              {avatarUrl && (
                <a
                  href={avatarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                >
                  {avatarUrl}
                </a>
              )}
            </div>
          </div>

          {/* Upload Avatar */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Upload Avatar
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                onChange={handleFileSelect}
                disabled={isUploading || !connector || !agentName}
                className="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  dark:file:bg-blue-900/30 dark:file:text-blue-300
                  disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Supported formats: PNG, JPG, GIF, WebP. Max size: 512KB
              </p>
            </div>

            {avatarUrl && (
              <button
                onClick={handleClearAvatar}
                disabled={isUploading || !connector || !agentName}
                className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isUploading ? "Processing..." : "Clear Avatar"}
              </button>
            )}
          </div>
        </div>

        {/* Event Tests */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
            Event Tests
          </h2>
          <div className="space-y-3">
            <button
              onClick={runTests}
              disabled={isLoading || !connector || !agentName}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {isLoading ? "Testing..." : "Test All Events (avatar.get, avatar.get_batch)"}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tests all avatar events: avatar.get, avatar.get_batch
            </p>
          </div>
        </div>

        {/* Test Results */}
        {testResults && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
              Test Results
            </h2>
            <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded text-sm font-mono text-gray-900 dark:text-gray-100 whitespace-pre-wrap overflow-x-auto">
              {testResults}
            </pre>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mt-6">
          <h3 className="text-sm font-semibold mb-2 text-blue-900 dark:text-blue-100">
            Instructions
          </h3>
          <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
            <li><strong>avatar.set</strong>: Upload an image file to set your avatar</li>
            <li><strong>avatar.clear</strong>: Click "Clear Avatar" to remove your avatar</li>
            <li><strong>avatar.get</strong>: Tested automatically when loading or via "Test All Events"</li>
            <li><strong>avatar.get_batch</strong>: Tested via "Test All Events" button</li>
            <li>All operations use the event system (connector.sendEvent)</li>
            <li>You can view avatar display effects in the chatroom</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AvatarTest;

