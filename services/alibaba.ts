import OpenAI from 'openai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { loadOpenAICompatibleServices, reEmitSSE } from './_base';

function createAlibabaService({
  id: model,
  supportsTools,
  supportsVision,
}: {
  id: string;
  supportsTools: boolean;
  supportsVision?: boolean;
}): AIService {
  const name = `Alibaba/${model}`;
  return {
    name,
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

        return reEmitSSE(stream, id, name);
      });
    },
  };
}

export async function loadAlibabaServices(): Promise<AIService[]> {
  return loadOpenAICompatibleServices(
    'alibaba',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
    (models) => models.map((model) => createAlibabaService({
      id: model.id,
      supportsTools:
        !model.id.includes('-vl-')
        && !model.id.includes('-mt-')
        && !model.id.startsWith('wan')
        && !model.id.startsWith('qvq'),
      supportsVision: model.id.includes('-vl-'),
    })),
  );
}
