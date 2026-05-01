import { Groq } from 'groq-sdk';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

function createGroqService({
  id: model,
  supportsTools,
  supportsVision,
}: {
  id: string;
  supportsTools: boolean;
  supportsVision?: boolean;
}): AIService {
  return {
    name: `Groq/${model}`,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('groq', async ({ key }) => {
        const client = new Groq({ apiKey: key });
        const {
          messages,
          tools,
          tool_choice,
          temperature = 0.6,
          max_tokens = 4096,
          top_p = 1,
        } = request;

        const stream = await client.chat.completions.create({
          messages: messages as never,
          model,
          temperature,
          max_completion_tokens: max_tokens,
          top_p,
          stream: true,
          stream_options: { include_usage: true },
          stop: null,
          ...(supportsTools && tools?.length && { tools }),
          ...(supportsTools && tool_choice !== undefined && { tool_choice }),
          ...(request.response_format && { response_format: request.response_format }),
        });

        return (async function* () {
          for await (const chunk of stream) {
            yield `data: ${JSON.stringify({ ...chunk, id, model: `Groq/${model}` })}\n\n`;
          }
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadGroqServices(): Promise<AIService[]> {
  try {
    const models = await withProviderKey('groq', async ({ key }) => {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        throw new Error(`Groq models HTTP ${res.status}`);
      }
      const data = await res.json() as {
        data?: Array<{ id: string }>;
      };
      return (data.data ?? [])
        .filter((model) => !model.id.includes('whisper'))
        .map((model) => createGroqService({
          id: model.id,
          supportsTools: !model.id.includes('gpt-oss') && !model.id.includes('deepseek-r1'),
          supportsVision: model.id.includes('vision') || model.id.includes('llava'),
          emulateTools: model.id.includes('deepseek-r1'),
        }));
    });

    logger.info({ provider: 'groq', count: models.length }, 'Groq models loaded');
    return models;
  } catch (err) {
    logger.warn({ err }, 'Groq models could not be loaded');
    return [];
  }
}
