import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { loadOpenAICompatibleServices, reEmitSSE } from './_base';

function createCerebrasService({
  id: model,
  supportsTools,
}: {
  id: string;
  supportsTools: boolean;
}): AIService {
  const name = `Cerebras/${model}`;
  return {
    name,
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

        return reEmitSSE(stream as AsyncIterable<unknown>, id, name);
      });
    },
  };
}

export async function loadCerebrasServices(): Promise<AIService[]> {
  return loadOpenAICompatibleServices(
    'cerebras',
    'https://api.cerebras.ai/v1/models',
    (models) => models.map((model) => createCerebrasService({ id: model.id, supportsTools: true })),
  );
}
