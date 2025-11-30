import { ThreadChannel, AgentInfo } from "./events";

/**
 * Thread state - maintain backward compatibility
 */
export interface ThreadState {
  currentChannel?: string | null;
  currentDirectMessage?: string | null;
  // Backward compatibility fields - managed by component layer, not stored in store
  channels?: ThreadChannel[];
  agents?: AgentInfo[];
}

/**
 * Complete thread data state (managed by hooks)
 */
export interface ThreadDataState {
  channels: ThreadChannel[];
  agents: AgentInfo[];
  isLoading: boolean;
}