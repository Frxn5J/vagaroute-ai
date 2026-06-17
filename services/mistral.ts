import { Mistral } from '@mistralai/mistralai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { loadOpenAICompatibleServices } from './_base';

function createMistralService(modelId: string): AIService {
  return {
    name: `Mistral/${modelId}`,
    supportsTools: true,
    supportsVision: modelId.includes('pixtral'),
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('mistral', async ({ key }) => {
        const client = new Mistral({ apiKey: key });
        const {
          messages,
          tools,
          tool_choice,
          temperature = 0.6,
          max_tokens = 4096,
        } = request;
        const created = Math.floor(Date.now() / 1000);

        const stream = await client.chat.stream({
          model: modelId,
          messages: messages as never,
          temperature,
          maxTokens: max_tokens,
          ...(tools?.length && { tools }),
          ...(tool_choice !== undefined && { toolChoice: tool_choice as never }),
          ...(request.response_format && { responseFormat: request.response_format as never }),
        });

        return (async function* () {
          for await (const event of stream) {
            const chunk = event.data;
            const choice = chunk.choices[0];
            const rawContent = choice?.delta?.content;
            const content = typeof rawContent === 'string' ? rawContent : undefined;

            yield `data: ${JSON.stringify({
              id,
              object: 'chat.completion.chunk',
              created,
              model: `Mistral/${modelId}`,
              choices: [{
                index: 0,
                delta: {
                  ...(content !== undefined && { content }),
                  ...((choice?.delta as { toolCalls?: unknown[] } | undefined)?.toolCalls?.length && {
                    tool_calls: (choice?.delta as { toolCalls?: unknown[] }).toolCalls,
                  }),
                },
                finish_reason: choice?.finishReason ?? null,
              }],
            })}\n\n`;
          }
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadMistralServices(): Promise<AIService[]> {
  return loadOpenAICompatibleServices(
    'mistral',
    'https://api.mistral.ai/v1/models',
    (models) => models.map((model) => createMistralService(model.id)),
  );
}
