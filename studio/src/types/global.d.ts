export {};

declare global {
  // Message type definition
  interface Message {
    id: string;
    text: string;
    sender: 'user' | 'assistant' | 'system';
    timestamp: string;
  }

  // Conversation type definition
  interface Conversation {
    id: string;
    title: string;
    isActive: boolean;
  }

  // Keyed messages by conversation ID
  interface ConversationMessages {
    [conversationId: string]: Message[];
  }

  // Settings interface
  interface Settings {
    apiKey: string;
    modelName: string;
    temperature: number;
    maxTokens: number;
  }

  // Tool interface definitions
  interface ToolInputSchema {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  }

  interface Tool {
    name: string;
    description: string;
    inputSchema: ToolInputSchema;
    execute?: (args: any) => Promise<ToolCallResult>;
  }

  interface ToolCallResult {
    isError?: boolean;
    content: Array<{
      type: string;
      text: string;
    }>;
  }

  interface Resource {
    uri: string;
    text: string;
  }
} 