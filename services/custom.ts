import OpenAI from 'openai';
import { getDecryptedCustomProviderKey, listActiveCustomProviders } from '../core/customProviders';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

function createCustomService(input: {
  providerSlug: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  supportsTools: boolean;
  supportsVision: boolean;
}): AIService {
  const { providerSlug, modelId, baseUrl, apiKey, supportsTools, supportsVision } = input;
  const serviceName = `${providerSlug}/${modelId}`;

  return {
    name: serviceName,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      const client = new OpenAI({ apiKey: apiKey || 'no-key', baseURL: baseUrl });
      const {
        messages,
        tools,
        tool_choice,
        temperature = 0.6,
        max_tokens = 4096,
        top_p = 1,
        response_format,
      } = request;

      const stream = await client.chat.completions.create({
        model: modelId,
        messages: messages as never,
        stream: true,
        stream_options: { include_usage: true },
        temperature,
        max_tokens,
        top_p,
        ...(supportsTools && tools?.length && { tools }),
        ...(supportsTools && tool_choice !== undefined && { tool_choice }),
        ...(response_format && { response_format }),
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield `data: ${JSON.stringify({ ...chunk, id, model: serviceName })}\n\n`;
        }
        yield 'data: [DONE]\n\n';
      })();
    },
  };
}

export async function loadCustomServices(): Promise<AIService[]> {
  const providers = listActiveCustomProviders();
  if (providers.length === 0) {
    return [];
  }

  const services: AIService[] = [];

  for (const provider of providers) {
    if (provider.models.length === 0) {
      continue;
    }

    const apiKey = getDecryptedCustomProviderKey(provider.id) ?? 'no-key';

    for (const model of provider.models) {
      services.push(
        createCustomService({
          providerSlug: provider.slug,
          modelId: model.id,
          baseUrl: provider.baseUrl,
          apiKey,
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
        }),
      );
    }
  }

  logger.info({ count: services.length }, 'Custom provider services loaded');
  return services;
}
