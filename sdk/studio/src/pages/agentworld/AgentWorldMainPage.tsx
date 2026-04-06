import React, { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/authStore";
import { getCurrentNetworkHealth } from "@/services/networkService";

/**
 * AgentWorld main page - Use iframe to display external page
 */
const AgentWorldMainPage: React.FC = () => {
  const { t } = useTranslation('agentWorld');
  const [isLoading, setIsLoading] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { agentName, selectedNetwork } = useAuthStore();

  const [networkConfig, setNetworkConfig] = useState<{
    channel?: string;
    spawn_position?: string;
    username_prefix?: string;
  }>({});

  // Fetch network config from health endpoint
  useEffect(() => {
    const fetchNetworkConfig = async () => {
      if (selectedNetwork) {
        try {
          const healthResponse = await getCurrentNetworkHealth(selectedNetwork);
          if (healthResponse.success && healthResponse.data) {
            // Extract agentworld config from mods
            const modsData = healthResponse.data.data?.mods || [];
            const agentworldMod = modsData.find(
              (mod: any) => mod.name === "openagents.mods.games.agentworld"
            );

            if (agentworldMod?.config) {
              setNetworkConfig({
                channel: agentworldMod.config.channel,
                spawn_position: agentworldMod.config.spawn_position,
                // username_prefix defaults to channel if not specified
                username_prefix: agentworldMod.config.username_prefix ?? agentworldMod.config.channel,
              });
            }
          }
        } catch (error) {
          console.error("Failed to fetch network config:", error);
        }
      }
    };

    fetchNetworkConfig();
  }, [selectedNetwork]);

  // Build AgentWorld URL with autologin parameters
  const agentworldUrl = useMemo(() => {
    const baseUrl = "https://play.agentworld.io/";

    // If no agent name, just return base URL
    if (!agentName) {
      return baseUrl;
    }

    // Apply username prefix if configured (e.g., team_alpha.raphael)
    const prefixedAgentName = networkConfig.username_prefix
      ? `${networkConfig.username_prefix}.${agentName}`
      : agentName;

    // Build query parameters
    const params = new URLSearchParams({
      source: "openagents",
      agent_id: prefixedAgentName,
    });

    // Add channel if available
    if (networkConfig.channel) {
      params.append("channel", networkConfig.channel);
    }

    // Add spawn_position if available
    if (networkConfig.spawn_position) {
      params.append("spawn_position", networkConfig.spawn_position);
    }

    return `${baseUrl}?${params.toString()}`;
  }, [agentName, networkConfig]);

  const handleIframeLoad = () => {
    // Delay to ensure CSS is also loaded
    timeoutRef.current = setTimeout(() => {
      setIsLoading(false);
    }, 500);
  };

  useEffect(() => {
    return () => {
      // Clean up timer
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="h-full w-full relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">
              {t('loading')}
            </p>
          </div>
        </div>
      )}
      <iframe
        src={agentworldUrl}
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

