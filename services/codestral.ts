import { Mistral } from '@mistralai/mistralai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

function createCodestralService({ id: model }: { id: string }): AIService {
  return {
    name: `Codestral/${model}`,
    supportsTools: true,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('codestral', async ({ key, metadata }) => {
        const dedicatedEndpoint = Boolean(metadata?.dedicatedEndpoint);
        const client = new Mistral({
          apiKey: key,
          ...(dedicatedEndpoint && { serverURL: 'https://codestral.mistral.ai' }),
        });
        const {
          messages,
          tools,
          tool_choice,
          temperature = 0.3,
          max_tokens = 8192,
        } = request;
        const created = Math.floor(Date.now() / 1000);

        const stream = await client.chat.stream({
          model,
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
              model: `Codestral/${model}`,
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

export async function loadCodestralServices(): Promise<AIService[]> {
  try {
    const models = await withProviderKey('codestral', async ({ key, metadata }) => {
      const dedicatedEndpoint = Boolean(metadata?.dedicatedEndpoint);
      const url = dedicatedEndpoint
        ? 'https://codestral.mistral.ai/v1/models'
        : 'https://api.mistral.ai/v1/models';

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!response.ok) {
        throw new Error(`Codestral models HTTP ${response.status}`);
      }

      const data = await response.json() as {
        data?: Array<{ id: string }>;
      };

      const services = (data.data ?? [])
        .filter((model) => model.id.includes('codestral'))
        .map((model) => createCodestralService({ id: model.id }));

      return services.length > 0 ? services : [createCodestralService({ id: 'codestral-latest' })];
    });

    logger.info({ provider: 'codestral', count: models.length }, 'Codestral models loaded');
    return models;
  } catch (err) {
    logger.warn({ err }, 'Codestral models could not be loaded');
    return [];
  }
}
