import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

function createCerebrasService({
  id: model,
  supportsTools,
}: {
  id: string;
  supportsTools: boolean;
}): AIService {
  return {
    name: `Cerebras/${model}`,
    supportsTools,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('cerebras', async ({ key }) => {
        const client = new Cerebras({ apiKey: key });
        const {
          messages,
          tools,
          tool_choice,
          temperature = 0.6,
          max_tokens = 8192,
          top_p = 0.95,
        } = request;

        const stream = await client.chat.completions.create({
          messages: messages as never,
          model,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: max_tokens,
          temperature,
          top_p,
          ...(supportsTools && tools?.length && { tools }),
          ...(supportsTools && tool_choice !== undefined && { tool_choice }),
        });

        return (async function* () {
          for await (const chunk of stream) {
            yield `data: ${JSON.stringify({ ...(chunk as object), id, model: `Cerebras/${model}` })}\n\n`;
          }
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadCerebrasServices(): Promise<AIService[]> {
  try {
    const models = await withProviderKey('cerebras', async ({ key }) => {
      const response = await fetch('https://api.cerebras.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        throw new Error(`Cerebras models HTTP ${response.status}`);
      }

      const data = await response.json() as {
        data?: Array<{ id: string }>;
      };

      return (data.data ?? []).map((model) => createCerebrasService({
        id: model.id,
        supportsTools: true,
      }));
    });

    logger.info({ provider: 'cerebras', count: models.length }, 'Cerebras models loaded');
    return models;
  } catch (err) {
    logger.warn({ err }, 'Cerebras models could not be loaded');
    return [];
  }
}
