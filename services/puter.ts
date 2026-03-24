import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

const fallbackModels = [
  'claude-3-5-sonnet',
  'claude-3-haiku',
  'gpt-4o',
  'gpt-4o-mini',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'mistral-large',
  'llama-3.1-70b',
];

function createPuterService({
  id: modelId,
  supportsTools,
  supportsVision,
}: {
  id: string;
  supportsTools: boolean;
  supportsVision?: boolean;
}): AIService {
  return {
    name: `Puter/${modelId}`,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('puter', async ({ key }) => {
        const { messages, temperature, max_tokens, response_format, tools, tool_choice } = request;
        const cleanMessages = messages
          .filter((message) => message.content !== null)
          .map((message) => ({
            ...message,
            content: message.content || '',
          }));

        const body: Record<string, unknown> = {
          model: modelId,
          messages: cleanMessages,
          stream: false,
        };

        if (typeof temperature === 'number') body.temperature = temperature;
        if (typeof max_tokens === 'number') body.max_tokens = max_tokens;
        if (response_format) body.response_format = response_format;
        if (tools && tools.length > 0) {
          body.tools = tools;
          if (tool_choice) body.tool_choice = tool_choice;
        }

        const response = await fetch('https://api.puter.com/puterai/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Puter REST API Error ${response.status}: ${await response.text()}`);
        }

        const textData = await response.text();
        let content = '';
        let toolCalls: unknown[] | null = null;

        try {
          const json = JSON.parse(textData) as {
            choices?: Array<{
              message?: {
                content?: string;
                tool_calls?: unknown[];
              };
            }>;
          };
          content = json.choices?.[0]?.message?.content ?? '';
          toolCalls = json.choices?.[0]?.message?.tool_calls ?? null;
        } catch {
          content = textData;
        }

        return (async function* () {
          if (content || toolCalls) {
            yield `data: ${JSON.stringify({
              id,
              model: `Puter/${modelId}`,
              choices: [{
                index: 0,
                delta: { content: content || null, ...(toolCalls && { tool_calls: toolCalls }) },
                finish_reason: null,
              }],
            })}\n\n`;
          }

          yield `data: ${JSON.stringify({
            id,
            model: `Puter/${modelId}`,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`;
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

function buildFallbackServices(): AIService[] {
  return fallbackModels.map((id) => createPuterService({
    id,
    supportsTools: true,
    supportsVision: id.includes('gpt-4o') || id.includes('gemini') || id.includes('claude-3'),
  }));
}

export async function loadPuterServices(): Promise<AIService[]> {
  try {
    const services = await withProviderKey('puter', async ({ key }) => {
      const response = await fetch('https://api.puter.com/puterai/chat/models/details', {
        headers: { Authorization: `Bearer ${key}` },
      });

      let loadedModels = fallbackModels;
      if (response.ok) {
        const data = await response.json() as {
          models?: Array<{ id: string }>;
        };
        if (Array.isArray(data.models) && data.models.length > 0) {
          loadedModels = data.models.map((model) => model.id);
        }
      }

      return loadedModels.map((id) => createPuterService({
        id,
        supportsTools: true,
        supportsVision:
          id.includes('gpt-4o')
          || id.includes('gemini')
          || id.includes('claude-3')
          || id.includes('vision'),
      }));
    });

    logger.info({ provider: 'puter', count: services.length }, 'Puter models loaded');
    return services;
  } catch (err) {
    logger.warn({ err }, 'Puter models could not be loaded, using fallbacks');
    return buildFallbackServices();
  }
}
