import { ThreadChannel, AgentInfo } from "./events";

/**
 * Thread state - 保持向后兼容
 */
export interface ThreadState {
  currentChannel?: string | null;
  currentDirectMessage?: string | null;
  // 向后兼容字段 - 由组件层管理，不存储在store中
  channels?: ThreadChannel[];
  agents?: AgentInfo[];
}

/**
 * 完整的线程数据状态（由hooks管理）
 */
export interface ThreadDataState {
  channels: ThreadChannel[];
  agents: AgentInfo[];
  isLoading: boolean;
}