import OpenAI from 'openai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

function createNvidiaService({
  id: model,
  supportsTools,
}: {
  id: string;
  supportsTools: boolean;
}): AIService {
  return {
    name: `NVIDIA/${model}`,
    supportsTools,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('nvidia', async ({ key }) => {
        const client = new OpenAI({
          baseURL: 'https://integrate.api.nvidia.com/v1',
          apiKey: key,
        });
        const {
          messages,
          tools,
          tool_choice,
          temperature = 0.6,
          max_tokens = 4096,
        } = request;

        const stream = await client.chat.completions.create({
          model,
          messages: messages as never,
          stream: true,
          stream_options: { include_usage: true },
          temperature,
          max_tokens,
          ...(supportsTools && tools?.length && { tools }),
          ...(supportsTools && tool_choice !== undefined && { tool_choice }),
        });

        return (async function* () {
          for await (const chunk of stream) {
            yield `data: ${JSON.stringify({ ...chunk, id, model: `NVIDIA/${model}` })}\n\n`;
          }
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadNvidiaServices(): Promise<AIService[]> {
  try {
    const models = await withProviderKey('nvidia', async ({ key }) => {
      const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!response.ok) {
        throw new Error(`NVIDIA models HTTP ${response.status}`);
      }

      const data = await response.json() as {
        data?: Array<{ id: string }>;
      };

      return (data.data ?? []).map((model) => createNvidiaService({
        id: model.id,
        supportsTools: true,
      }));
    });

    logger.info({ provider: 'nvidia', count: models.length }, 'NVIDIA models loaded');
    return models;
  } catch (err) {
    logger.warn({ err }, 'NVIDIA models could not be loaded');
    return [];
  }
}
