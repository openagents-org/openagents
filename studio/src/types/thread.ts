import { ThreadChannel, AgentInfo } from "./events";

/**
 * Thread state for compatibility with existing UI components
 */
export interface ThreadState {
  channels?: ThreadChannel[];
  agents?: AgentInfo[];
  currentChannel?: string | null;
  currentDirectMessage?: string | null;
}