import { Groq } from 'groq-sdk';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { loadOpenAICompatibleServices, reEmitSSE } from './_base';

function createGroqService({
  id: model,
  supportsTools,
  supportsVision,
}: {
  id: string;
  supportsTools: boolean;
  supportsVision?: boolean;
}): AIService {
  const name = `Groq/${model}`;
  return {
    name,
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

        return reEmitSSE(stream, id, name);
      });
    },
  };
}

export async function loadGroqServices(): Promise<AIService[]> {
  return loadOpenAICompatibleServices(
    'groq',
    'https://api.groq.com/openai/v1/models',
    (models) => models
      .filter((model) => !model.id.includes('whisper'))
      .map((model) => createGroqService({
        id: model.id,
        supportsTools: !model.id.includes('gpt-oss') && !model.id.includes('deepseek-r1'),
        supportsVision: model.id.includes('vision') || model.id.includes('llava'),
      })),
  );
}
