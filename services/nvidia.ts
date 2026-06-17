import OpenAI from 'openai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { loadOpenAICompatibleServices, reEmitSSE } from './_base';

function createNvidiaService({
  id: model,
  supportsTools,
}: {
  id: string;
  supportsTools: boolean;
}): AIService {
  const name = `NVIDIA/${model}`;
  return {
    name,
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

        return reEmitSSE(stream, id, name);
      });
    },
  };
}

export async function loadNvidiaServices(): Promise<AIService[]> {
  return loadOpenAICompatibleServices(
    'nvidia',
    'https://integrate.api.nvidia.com/v1/models',
    (models) => models.map((m) => createNvidiaService({ id: m.id, supportsTools: true })),
  );
}
