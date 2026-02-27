export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: any[];
  tool_choice?: any;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface AIService {
  name: string;
  /** Whether this service can handle requests that include tool definitions */
  supportsTools: boolean;
  /**
   * Returns an async iterable of raw SSE lines in OpenAI format:
   *   data: {...}\n\n
   *   data: [DONE]\n\n
   */
  chat: (request: ChatRequest, id: string) => Promise<AsyncIterable<string>>;
}