import { useOpenAgentsService } from "@/contexts/OpenAgentsServiceContext";
import { ConnectionStatusEnum } from "@/types/connection";

export default function useConnectedStatus() {
  const {
    service,
    connectionStatus,
    isConnected,
    loadChannels,
    ...otherMethods
  } = useOpenAgentsService();

  // 为了保持向后兼容，返回包含 openAgentsHook 的对象
  // 实际上现在的 openAgentsHook 就是全局服务的方法集合
  const openAgentsHook = {
    service,
    connectionStatus,
    loadChannels,
    ...otherMethods,
    // 这些字段保持空数组，因为数据应该在组件层管理
    channels: [],
    messages: [],
    setMessages: () => {},
    isLoading: false,
    setLoading: () => {},
  };

  return {
    openAgentsHook,
    isConnected,
    channels: [], // 现在返回空数组，channels 应该由组件层管理
    connectionStatus,
  };
}
