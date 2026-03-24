import { GoogleGenerativeAI } from '@google/generative-ai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest, MessageContentPart } from '../types';
import { logger } from '../utils/logger';

function parseGeminiContent(content: string | MessageContentPart[] | null): any[] {
  if (!content) {
    return [{ text: '' }];
  }
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  return content.map((part) => {
    if (part.type === 'text') {
      return { text: part.text };
    }

    const url = part.image_url.url;
    if (url.startsWith('data:')) {
      const match = url.match(/^data:(image\/[a-zA-Z0-9+-]+);base64,(.*)$/);
      if (match) {
        return {
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        };
      }
    }

    return { text: `[Image URL: ${url}]` };
  });
}

function createGeminiService({
  id: modelId,
  supportsTools,
  supportsVision,
}: {
  id: string;
  supportsTools: boolean;
  supportsVision?: boolean;
}): AIService {
  return {
    name: `Gemini/${modelId}`,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('gemini', async ({ key }) => {
        const genAI = new GoogleGenerativeAI(key);
        const { messages, temperature = 0.6, max_tokens, response_format } = request;
        const created = Math.floor(Date.now() / 1000);

        const systemInstruction = messages.find((message) => message.role === 'system')?.content;
        const conversationMessages = messages.filter((message) => message.role !== 'system');
        const history = conversationMessages.slice(0, -1).map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: parseGeminiContent(message.content),
        })) as any[];

        const model = genAI.getGenerativeModel({
          model: modelId,
          ...(systemInstruction && {
            systemInstruction: typeof systemInstruction === 'string'
              ? systemInstruction
              : JSON.stringify(systemInstruction),
          }),
          generationConfig: {
            temperature,
            maxOutputTokens: max_tokens ?? 8192,
            responseMimeType: response_format?.type === 'json_object' ? 'application/json' : 'text/plain',
          },
        });

        const chat = model.startChat({ history: history as never });
        const lastMessage = conversationMessages[conversationMessages.length - 1];
        const result = await chat.sendMessageStream(parseGeminiContent(lastMessage?.content ?? '') as never);

        return (async function* () {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              yield `data: ${JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model: `Gemini/${modelId}`,
                choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
              })}\n\n`;
            }
          }
          yield `data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model: `Gemini/${modelId}`,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`;
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadGeminiServices(): Promise<AIService[]> {
  try {
    const models = await withProviderKey('gemini', async ({ key }) => {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (!response.ok) {
        throw new Error(`Gemini models HTTP ${response.status}`);
      }

      const data = await response.json() as {
        models?: Array<{
          name: string;
          supportedGenerationMethods?: string[];
        }>;
      };

      return (data.models ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
        .map((model) => model.name.replace('models/', ''))
        .map((id) => createGeminiService({
          id,
          supportsTools: false,
          supportsVision: !id.includes('gemma'),
        }));
    });

    logger.info({ provider: 'gemini', count: models.length }, 'Gemini models loaded');
    return models;
  } catch (err) {
    logger.warn({ err }, 'Gemini models could not be loaded');
    return [];
  }
}
