export interface LLMLogEntry {
  id: string;
  timestamp: number; // Unix timestamp in milliseconds
  agent_id: string;
  model: string;
  provider?: string; // e.g., "openai", "anthropic"
  latency_ms: number;
  prompt: string; // Full prompt or preview (from list endpoint)
  completion: string; // Full completion or preview (from list endpoint)
  preview?: string; // Preview text from list endpoint
  error?: string | null;
  usage?: {
    prompt_tokens?: number; // Also mapped from input_tokens
    completion_tokens?: number; // Also mapped from output_tokens
    total_tokens?: number;
  };
  messages?: Array<{
    role: string;
    content: string;
  }>;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description?: string;
      parameters?: any;
    };
  }>;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: string; // JSON string
  }>;
  has_tool_calls?: boolean;
  // Indicates if this entry has full details loaded
  isDetailLoaded?: boolean;
}

export interface LLMLogFilters {
  model?: string; // Filter by model name
  startDate?: string; // YYYY-MM-DD - converted to 'since' timestamp (Unix seconds)
  hasError?: boolean; // Filter by error status (true/false)
  searchQuery?: string; // Search in messages/completion - mapped to 'search' parameter
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

