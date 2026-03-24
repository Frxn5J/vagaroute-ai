import { logger } from './logger';

export function genId(): string {
  return `chatcmpl-${Math.random().toString(36).slice(2, 11)}`;
}

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function parseUsage(raw: unknown): StreamUsage | null {
  const usage = raw as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;

  if (!usage) {
    return null;
  }

  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);

  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens) || !Number.isFinite(totalTokens)) {
    return null;
  }

  return {
    promptTokens: Math.max(0, Math.floor(promptTokens)),
    completionTokens: Math.max(0, Math.floor(completionTokens)),
    totalTokens: Math.max(0, Math.floor(totalTokens)),
  };
}

function parseUsageFromSSELine(line: string): StreamUsage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') {
    return null;
  }

  try {
    const chunk = JSON.parse(trimmed.slice(6));
    return parseUsage(chunk.usage);
  } catch {
    return null;
  }
}

/** Wraps a stream to catch mid-stream errors and emit a proper SSE error before [DONE]. */
export async function* withErrorBoundary(
  source: AsyncIterable<string>,
  serviceName: string
): AsyncGenerator<string> {
  try {
    for await (const chunk of source) {
      yield chunk;
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    logger.error({ err, serviceName }, `Mid-stream error: ${msg}`);
    yield `data: ${JSON.stringify({
      error: { message: msg, type: 'stream_error' }
    })}\n\n`;
    yield 'data: [DONE]\n\n';
  }
}

/**
 * Collects a stream of SSE lines and assembles a complete message
 * (including tool_calls for agent use cases).
 */
export async function collectSSE(source: AsyncIterable<string>): Promise<{
  content: string;
  tool_calls: any[];
  finish_reason: string;
  usage: StreamUsage | null;
}> {
  let content = '';
  const toolCallMap: Record<number, any> = {};
  let finish_reason = 'stop';
  let usage: StreamUsage | null = null;

  for await (const line of source) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;

    try {
      const chunk = JSON.parse(trimmed.slice(6));
      usage = parseUsage(chunk.usage) ?? usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) finish_reason = choice.finish_reason;

      const delta = choice.delta;
      if (delta?.content) content += delta.content;

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallMap[idx]) {
            toolCallMap[idx] = {
              id: tc.id ?? '',
              type: 'function',
              function: { name: '', arguments: '' },
            };
          }
          if (tc.id) toolCallMap[idx].id = tc.id;
          if (tc.function?.name) toolCallMap[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallMap[idx].function.arguments += tc.function.arguments;
        }
      }
    } catch { /* non-JSON SSE lines, skip */ }
  }

  const tool_calls = Object.values(toolCallMap);
  return { content, tool_calls, finish_reason, usage };
}

export async function* observeSSE(
  source: AsyncIterable<string>,
  callbacks: {
    onComplete?: (meta: { usage: StreamUsage | null }) => void;
  } = {},
): AsyncGenerator<string> {
  let usage: StreamUsage | null = null;

  try {
    for await (const line of source) {
      usage = parseUsageFromSSELine(line) ?? usage;
      yield line;
    }
  } finally {
    callbacks.onComplete?.({ usage });
  }
}
