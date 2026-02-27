import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { AIService, ChatRequest } from '../types';

const cerebras = new Cerebras();

const MODELS: { id: string; supportsTools: boolean }[] = [
  { id: 'llama-3.3-70b', supportsTools: true },
  { id: 'llama3.1-8b', supportsTools: true },
  { id: 'llama-4-scout-17b-16e-instruct', supportsTools: true },
];

function createCerebrasService({ id: model, supportsTools }: { id: string; supportsTools: boolean }): AIService {
  return {
    name: `Cerebras/${model}`,
    supportsTools,
    async chat(request: ChatRequest, id: string) {
      const {
        messages, tools, tool_choice,
        temperature = 0.6, max_tokens = 8192, top_p = 0.95,
      } = request;

      const stream = await cerebras.chat.completions.create({
        messages: messages as any,
        model,
        stream: true,
        max_completion_tokens: max_tokens,
        temperature,
        top_p,
        ...(supportsTools && tools?.length && { tools }),
        ...(supportsTools && tool_choice !== undefined && { tool_choice }),
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield `data: ${JSON.stringify({ ...(chunk as any), id, model: `Cerebras/${model}` })}\n\n`;
        }
        yield 'data: [DONE]\n\n';
      })();
    },
  };
}

export const cerebrasServices: AIService[] = MODELS.map(createCerebrasService);
