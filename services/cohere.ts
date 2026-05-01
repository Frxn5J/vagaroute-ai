import { CohereClient } from 'cohere-ai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

function createCohereService({ id: modelId }: { id: string }): AIService {
  return {
    name: `Cohere/${modelId}`,
    supportsTools: false,
    emulateTools: true,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('cohere', async ({ key }) => {
        const client = new CohereClient({ token: key });
        const { messages, temperature = 0.6, max_tokens = 4096 } = request;
        const created = Math.floor(Date.now() / 1000);

        const systemMessage = messages.find((message) => message.role === 'system')?.content;
        const conversationMessages = messages.filter((message) => message.role !== 'system');
        const lastMessage = conversationMessages[conversationMessages.length - 1];

        const chatHistory = conversationMessages.slice(0, -1).map((message) => {
          let text = '';
          if (typeof message.content === 'string') {
            text = message.content;
          } else if (Array.isArray(message.content)) {
            text = message.content.find((part) => part.type === 'text')?.text ?? '';
          }

          return {
            role: message.role === 'assistant' ? 'CHATBOT' as const : 'USER' as const,
            message: text,
          };
        });

        const stream = await client.chatStream({
          model: modelId,
          message: typeof lastMessage?.content === 'string'
            ? lastMessage.content
            : lastMessage?.content?.find((part) => part.type === 'text')?.text ?? '',
          chatHistory,
          ...(systemMessage && { preamble: typeof systemMessage === 'string' ? systemMessage : JSON.stringify(systemMessage) }),
          temperature,
          maxTokens: max_tokens,
        });

        return (async function* () {
          for await (const event of stream) {
            if (event.eventType === 'text-generation') {
              yield `data: ${JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model: `Cohere/${modelId}`,
                choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
              })}\n\n`;
            }
          }

          yield `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: `Cohere/${modelId}`,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`;
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadCohereServices(): Promise<AIService[]> {
  try {
    const models = await withProviderKey('cohere', async ({ key }) => {
      const response = await fetch('https://api.cohere.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });

      if (!response.ok) {
        throw new Error(`Cohere models HTTP ${response.status}`);
      }

      const data = await response.json() as {
        models?: Array<{ name: string; endpoints?: string[] }>;
      };

      return (data.models ?? [])
        .filter((model) => model.endpoints?.includes('chat'))
        .map((model) => createCohereService({ id: model.name }));
    });

    logger.info({ provider: 'cohere', count: models.length }, 'Cohere models loaded');
    return models;
  } catch (err) {
    logger.warn({ err }, 'Cohere models could not be loaded');
    return [];
  }
}
