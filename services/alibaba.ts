import OpenAI from 'openai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

function createAlibabaService({
  id: model,
  supportsTools,
  supportsVision,
}: {
  id: string;
  supportsTools: boolean;
  supportsVision?: boolean;
}): AIService {
  return {
    name: `Alibaba/${model}`,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('alibaba', async ({ key }) => {
        const client = new OpenAI({
          baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
          apiKey: key,
        });
        const {
          messages,
          tools,
          tool_choice,
          temperature = 0.6,
          max_tokens = 4096,
          top_p = 0.95,
        } = request;

        const stream = await client.chat.completions.create({
          messages: messages as never,
          model,
          stream: true,
          stream_options: { include_usage: true },
          temperature,
          max_tokens,
          top_p,
          ...(supportsTools && tools?.length && { tools }),
          ...(supportsTools && tool_choice !== undefined && { tool_choice }),
        });

        return (async function* () {
          for await (const chunk of stream) {
            yield `data: ${JSON.stringify({ ...chunk, id, model: `Alibaba/${model}` })}\n\n`;
          }
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadAlibabaServices(): Promise<AIService[]> {
  try {
    const models = await withProviderKey('alibaba', async ({ key }) => {
      const response = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!response.ok) {
        throw new Error(`Alibaba models HTTP ${response.status}`);
      }

      const data = await response.json() as {
        data?: Array<{ id: string }>;
      };

      return (data.data ?? []).map((model) => createAlibabaService({
        id: model.id,
        supportsTools:
          !model.id.includes('-vl-')
          && !model.id.includes('-mt-')
          && !model.id.startsWith('wan')
          && !model.id.startsWith('qvq'),
        supportsVision: model.id.includes('-vl-'),
      }));
    });

    logger.info({ provider: 'alibaba', count: models.length }, 'Alibaba models loaded');
    return models;
  } catch (err) {
    logger.warn({ err }, 'Alibaba models could not be loaded');
    return [];
  }
}
