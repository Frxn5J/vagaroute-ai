export interface MessageContentPartText {
  type: 'text';
  text: string;
}

export interface MessageContentPartImage {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface MessageContentPartAudio {
  type: 'audio_url';
  audio_url: {
    url: string;
  };
}

export interface MessageContentPartVideo {
  type: 'video_url';
  video_url: {
    url: string;
  };
}

export interface MessageContentPartFile {
  type: 'file_url';
  file_url: {
    url: string;
  };
}

export type MessageContentPart =
  | MessageContentPartText
  | MessageContentPartImage
  | MessageContentPartAudio
  | MessageContentPartVideo
  | MessageContentPartFile;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  // Soporta texto estricto o un array multimodal (vision)
  content: string | MessageContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: any[];
  tool_choice?: any;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  // Soporte para JSON Output
  response_format?: { type: 'text' | 'json_object' };
  enable_thinking?: boolean;
  thinking_budget?: number;
  stream?: boolean;
}

export interface AIService {
  name: string;
  /** Whether this service can handle requests that include tool definitions */
  supportsTools: boolean;
  supportsVision?: boolean;
  /**
   * Returns an async iterable of raw SSE lines in OpenAI format:
   *   data: {...}\n\n
   *   data: [DONE]\n\n
   */
  chat: (request: ChatRequest, id: string) => Promise<AsyncIterable<string>>;
}
