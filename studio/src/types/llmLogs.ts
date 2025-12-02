export interface LLMLogEntry {
  id: string;
  timestamp: number; // Unix timestamp in milliseconds
  agent_id: string;
  model: string;
  latency_ms: number;
  prompt: string;
  completion: string;
  error?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  messages?: Array<{
    role: string;
    content: string;
  }>;
}

export interface LLMLogFilters {
  model?: string;
  agent_id?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  hasError?: boolean;
  searchQuery?: string;
}

export interface LLMLogStats {
  total_calls: number;
  total_tokens: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  average_latency_ms: number;
  error_count: number;
  models: Record<string, number>; // model -> count
}

