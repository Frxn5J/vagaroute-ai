import OpenAI from 'openai';
import {
  getDecryptedCustomProviderKey,
  listActiveCustomProviders,
  type CustomProviderProtocol,
} from '../core/customProviders';
import type { AIService, ChatMessage, ChatRequest, MessageContentPart } from '../types';
import { logger } from '../utils/logger';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function createChunk(input: {
  id: string;
  model: string;
  content?: string;
  tool_calls?: unknown[];
  finish_reason?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}): string {
  return `data: ${JSON.stringify({
    id: input.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [{
      index: 0,
      delta: {
        ...(input.content ? { content: input.content } : {}),
        ...(input.tool_calls?.length ? { tool_calls: input.tool_calls } : {}),
      },
      finish_reason: input.finish_reason ?? null,
    }],
    ...(input.usage ? { usage: input.usage } : {}),
  })}\n\n`;
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function asText(value: string | MessageContentPart[] | null | undefined): string {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return value
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function parseJsonMaybe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (payload && typeof payload === 'object') {
    const record = payload as {
      error?: { message?: unknown; details?: unknown } | unknown;
      message?: unknown;
    };
    if (record.error && typeof record.error === 'object' && typeof (record.error as { message?: unknown }).message === 'string') {
      return String((record.error as { message: string }).message);
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim().slice(0, 400);
  }

  return `Provider HTTP ${response.status}`;
}

async function* iterateLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n');
      while (boundary >= 0) {
        let line = buffer.slice(0, boundary);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        yield line;
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf('\n');
      }
    }
  } finally {
    buffer += decoder.decode();
    if (buffer) {
      yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
    }
    reader.releaseLock();
  }
}

async function* iterateSSEData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let dataLines: string[] = [];
  for await (const line of iterateLines(stream)) {
    if (line === '') {
      if (dataLines.length > 0) {
        yield dataLines.join('\n');
        dataLines = [];
      }
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length > 0) {
    yield dataLines.join('\n');
  }
}

function openAIContentToGeminiParts(content: string | MessageContentPart[] | null): any[] {
  if (!content) {
    return [{ text: '' }];
  }
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  return content.map((part) => {
    if (part.type === 'text') {
      return { text: part.text };
    }
    if (part.type === 'image_url') {
      const url = part.image_url.url;
      if (url.startsWith('data:')) {
        const match = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/);
        if (match) {
          return { inlineData: { mimeType: match[1], data: match[2] } };
        }
      }
      return { fileData: { mimeType: 'image/*', fileUri: url } };
    }

    return { text: `[Unsupported part: ${part.type}]` };
  });
}

function openAIContentToAnthropicBlocks(content: string | MessageContentPart[] | null): any[] {
  if (!content) {
    return [{ type: 'text', text: '' }];
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }

    if (part.type === 'image_url') {
      const url = part.image_url.url;
      const match = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/);
      if (match) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2],
          },
        };
      }
      return { type: 'text', text: `[Image URL: ${url}]` };
    }

    return { type: 'text', text: `[Unsupported part: ${part.type}]` };
  });
}

function buildGeminiPayload(request: ChatRequest): {
  body: Record<string, unknown>;
} {
  const systemInstruction = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => asText(message.content))
    .filter(Boolean)
    .join('\n\n');

  const toolNameById = new Map<string, string>();
  const contents = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (message.role === 'tool') {
        const toolName = toolNameById.get(message.tool_call_id || '') || 'tool';
        return {
          role: 'user',
          parts: [{
            functionResponse: {
              name: toolName,
              response: { content: parseJsonMaybe(asText(message.content)) },
            },
          }],
        };
      }

      const parts = openAIContentToGeminiParts(message.content);
      if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          toolNameById.set(toolCall.id, toolCall.function.name);
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: parseJsonMaybe(toolCall.function.arguments || '{}'),
            },
          });
        }
      }

      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

  const tools = request.tools?.length
    ? [{
        functionDeclarations: request.tools
          .filter((tool) => tool?.type === 'function' && tool.function?.name)
          .map((tool) => ({
            name: String(tool.function.name),
            description: typeof tool.function.description === 'string' ? tool.function.description : '',
            parameters: tool.function.parameters ?? { type: 'object', properties: {} },
          })),
      }]
    : undefined;

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: request.temperature ?? 0.6,
      maxOutputTokens: request.max_tokens ?? 4096,
      ...(request.top_p !== undefined ? { topP: request.top_p } : {}),
      ...(request.response_format?.type === 'json_object' ? { responseMimeType: 'application/json' } : {}),
    },
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    ...(tools && (tools[0] as { functionDeclarations: unknown[] }).functionDeclarations.length > 0 ? { tools } : {}),
  };

  if (request.tools?.length && request.tool_choice !== undefined) {
    const choice = request.tool_choice as string | { type?: string; function?: { name?: string } };
    if (choice === 'none') {
      body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    } else if (choice === 'required') {
      body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
    } else if (choice && typeof choice === 'object' && choice.type === 'function' && choice.function?.name) {
      body.toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [choice.function.name],
        },
      };
    }
  }

  return { body };
}

function buildAnthropicPayload(request: ChatRequest): Record<string, unknown> {
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => asText(message.content))
    .filter(Boolean)
    .join('\n\n');

  const messages = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => toAnthropicMessage(message))
    .filter(Boolean);

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens ?? 4096,
    temperature: request.temperature ?? 0.6,
    stream: true,
    ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
    ...(system ? { system } : {}),
  };

  if (request.tools?.length) {
    body.tools = request.tools
      .filter((tool) => tool?.type === 'function' && tool.function?.name)
      .map((tool) => ({
        name: String(tool.function.name),
        description: typeof tool.function.description === 'string' ? tool.function.description : '',
        input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
      }));
  }

  if (request.tools?.length && request.tool_choice !== undefined) {
    const choice = request.tool_choice as string | { type?: string; function?: { name?: string } };
    if (choice === 'auto') {
      body.tool_choice = { type: 'auto' };
    } else if (choice === 'required') {
      body.tool_choice = { type: 'any' };
    } else if (choice === 'none') {
      // Anthropic does not support an explicit none mode. Omitting tool_choice keeps it optional.
    } else if (choice && typeof choice === 'object' && choice.type === 'function' && choice.function?.name) {
      body.tool_choice = { type: 'tool', name: choice.function.name };
    }
  }

  return body;
}

function toAnthropicMessage(message: ChatMessage): { role: 'user' | 'assistant'; content: any[] } | null {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: message.tool_call_id || 'tool',
        content: asText(message.content),
      }],
    };
  }

  if (message.role !== 'user' && message.role !== 'assistant') {
    return null;
  }

  const content = openAIContentToAnthropicBlocks(message.content);
  if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: parseJsonMaybe(toolCall.function.arguments || '{}'),
      });
    }
  }

  return {
    role: message.role,
    content,
  };
}

async function createGeminiStream(input: {
  id: string;
  serviceName: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  request: ChatRequest;
}): Promise<AsyncIterable<string>> {
  const { body } = buildGeminiPayload(input.request);
  const response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/models/${encodeURIComponent(input.modelId)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(input.apiKey ? { 'x-goog-api-key': input.apiKey } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response));
  }
  const bodyStream = response.body;

  return (async function* () {
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
    let finishReason = 'stop';
    let toolIndex = 0;

    for await (const data of iterateSSEData(bodyStream)) {
      if (!data || data === '[DONE]') {
        continue;
      }

      const chunk = JSON.parse(data) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      if (chunk.usageMetadata) {
        usage = {
          prompt_tokens: Number(chunk.usageMetadata.promptTokenCount ?? 0),
          completion_tokens: Number(chunk.usageMetadata.candidatesTokenCount ?? 0),
          total_tokens: Number(chunk.usageMetadata.totalTokenCount ?? 0),
        };
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate) {
        continue;
      }

      if (candidate.finishReason) {
        finishReason = candidate.finishReason === 'MAX_TOKENS'
          ? 'length'
          : candidate.finishReason === 'STOP'
            ? 'stop'
            : candidate.finishReason === 'SAFETY'
              ? 'content_filter'
              : 'stop';
      }

      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          yield createChunk({ id: input.id, model: input.serviceName, content: part.text });
        }

        if (part.functionCall?.name) {
          yield createChunk({
            id: input.id,
            model: input.serviceName,
            tool_calls: [{
              index: toolIndex,
              id: randomId('call'),
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args ?? {}),
              },
            }],
          });
          toolIndex += 1;
          finishReason = 'tool_calls';
        }
      }
    }

    yield createChunk({
      id: input.id,
      model: input.serviceName,
      finish_reason: finishReason,
      usage,
    });
    yield 'data: [DONE]\n\n';
  })();
}

async function createAnthropicStream(input: {
  id: string;
  serviceName: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  request: ChatRequest;
}): Promise<AsyncIterable<string>> {
  const response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'anthropic-version': '2023-06-01',
      ...(input.apiKey ? { 'x-api-key': input.apiKey } : {}),
    },
    body: JSON.stringify(buildAnthropicPayload({ ...input.request, model: input.modelId })),
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorMessage(response));
  }
  const bodyStream = response.body;

  return (async function* () {
    const toolIndexes = new Map<number, number>();
    let nextToolIndex = 0;
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let finishReason = 'stop';

    for await (const data of iterateSSEData(bodyStream)) {
      if (!data || data === '[DONE]') {
        continue;
      }

      const event = JSON.parse(data) as {
        type?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        delta?: { text?: string; partial_json?: string; stop_reason?: string; usage?: { output_tokens?: number } };
        content_block?: { type?: string; id?: string; name?: string; text?: string; input?: unknown };
        index?: number;
      };

      const inputTokens = Number(event.message?.usage?.input_tokens ?? event.usage?.input_tokens ?? usage.prompt_tokens);
      const outputTokens = Number(event.delta?.usage?.output_tokens ?? event.usage?.output_tokens ?? event.message?.usage?.output_tokens ?? usage.completion_tokens);
      usage = {
        prompt_tokens: Number.isFinite(inputTokens) ? inputTokens : usage.prompt_tokens,
        completion_tokens: Number.isFinite(outputTokens) ? outputTokens : usage.completion_tokens,
        total_tokens: (Number.isFinite(inputTokens) ? inputTokens : usage.prompt_tokens) + (Number.isFinite(outputTokens) ? outputTokens : usage.completion_tokens),
      };

      if (event.type === 'content_block_start' && event.content_block?.type === 'text' && event.content_block.text) {
        yield createChunk({ id: input.id, model: input.serviceName, content: event.content_block.text });
        continue;
      }

      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        const blockIndex = Number(event.index ?? 0);
        const toolIndex = nextToolIndex++;
        toolIndexes.set(blockIndex, toolIndex);
        yield createChunk({
          id: input.id,
          model: input.serviceName,
          tool_calls: [{
            index: toolIndex,
            id: event.content_block.id || randomId('call'),
            type: 'function',
            function: {
              name: event.content_block.name || 'tool',
              arguments: event.content_block.input ? JSON.stringify(event.content_block.input) : '',
            },
          }],
        });
        finishReason = 'tool_calls';
        continue;
      }

      if (event.type === 'content_block_delta' && event.delta?.text) {
        yield createChunk({ id: input.id, model: input.serviceName, content: event.delta.text });
        continue;
      }

      if (event.type === 'content_block_delta' && typeof event.delta?.partial_json === 'string') {
        const toolIndex = toolIndexes.get(Number(event.index ?? 0)) ?? 0;
        yield createChunk({
          id: input.id,
          model: input.serviceName,
          tool_calls: [{
            index: toolIndex,
            function: { arguments: event.delta.partial_json },
          }],
        });
        finishReason = 'tool_calls';
        continue;
      }

      if (event.type === 'message_delta' && event.delta?.stop_reason) {
        finishReason = event.delta.stop_reason === 'max_tokens'
          ? 'length'
          : event.delta.stop_reason === 'tool_use'
            ? 'tool_calls'
            : 'stop';
      }
    }

    yield createChunk({ id: input.id, model: input.serviceName, finish_reason: finishReason, usage });
    yield 'data: [DONE]\n\n';
  })();
}

function createCustomService(input: {
  providerSlug: string;
  protocol: CustomProviderProtocol;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  supportsTools: boolean;
  supportsVision: boolean;
}): AIService {
  const { providerSlug, protocol, modelId, baseUrl, apiKey, supportsTools, supportsVision } = input;
  const serviceName = `${providerSlug}/${modelId}`;

  return {
    name: serviceName,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      if (protocol === 'gemini') {
        return createGeminiStream({
          id,
          serviceName,
          modelId,
          baseUrl,
          apiKey,
          request,
        });
      }

      if (protocol === 'anthropic') {
        return createAnthropicStream({
          id,
          serviceName,
          modelId,
          baseUrl,
          apiKey,
          request,
        });
      }

      const client = new OpenAI({ apiKey: apiKey || 'no-key', baseURL: baseUrl });
      const {
        messages,
        tools,
        tool_choice,
        temperature = 0.6,
        max_tokens = 4096,
        top_p = 1,
        response_format,
      } = request;

      const stream = await client.chat.completions.create({
        model: modelId,
        messages: messages as never,
        stream: true,
        stream_options: { include_usage: true },
        temperature,
        max_tokens,
        top_p,
        ...(supportsTools && tools?.length && { tools }),
        ...(supportsTools && tool_choice !== undefined && { tool_choice }),
        ...(response_format && { response_format }),
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield `data: ${JSON.stringify({ ...chunk, id, model: serviceName })}\n\n`;
        }
        yield 'data: [DONE]\n\n';
      })();
    },
  };
}

export async function loadCustomServices(): Promise<AIService[]> {
  const providers = listActiveCustomProviders();
  if (providers.length === 0) {
    return [];
  }

  const services: AIService[] = [];

  for (const provider of providers) {
    if (provider.models.length === 0) {
      continue;
    }

    const apiKey = getDecryptedCustomProviderKey(provider.id) ?? 'no-key';

    for (const model of provider.models) {
      services.push(
        createCustomService({
          providerSlug: provider.slug,
          protocol: provider.protocol,
          modelId: model.id,
          baseUrl: provider.baseUrl,
          apiKey,
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
        }),
      );
    }
  }

  logger.info({ count: services.length }, 'Custom provider services loaded');
  return services;
}
