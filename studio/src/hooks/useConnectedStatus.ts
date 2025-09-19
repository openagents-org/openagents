import { useOpenAgents } from "@/hooks/useOpenAgents";
import { useNetworkStore } from "@/stores/networkStore";
import { ConnectionStatusEnum } from "@/types/connection";

export default function useConnectedStatus() {
  const { agentName, selectedNetwork } = useNetworkStore();

  // Use the new event system when we have network connection
  // Only initialize when we have real values, not fallbacks
  const openAgentsHook = useOpenAgents({
    agentId: agentName || "studio_user",
    host: selectedNetwork?.host,
    port: selectedNetwork?.port,
    autoConnect: !!selectedNetwork && !!agentName,
  });

  const { connectionStatus, channels } = openAgentsHook;

  // Determine if we're connected
  const isConnected =
    connectionStatus.status === ConnectionStatusEnum.CONNECTED;

  return {
    openAgentsHook,
    isConnected,
    channels,
    connectionStatus,
  };
}
