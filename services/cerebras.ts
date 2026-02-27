import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { AIService, ChatMessage } from '../types';

const cerebras = new Cerebras();

// Free models available on Cerebras Cloud
const MODELS = [
  'llama-3.3-70b',
  'llama3.1-8b',
  'llama-4-scout-17b-16e-instruct',
];

function createCerebrasService(model: string): AIService {
  return {
    name: `Cerebras/${model}`,
    async chat(messages: ChatMessage[]) {
      const stream = await cerebras.chat.completions.create({
        messages: messages as any,
        model,
        stream: true,
        max_completion_tokens: 8192,
        temperature: 0.6,
        top_p: 0.95,
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield (chunk as any).choices[0]?.delta?.content || '';
        }
      })();
    },
  };
}

export const cerebrasServices: AIService[] = MODELS.map(createCerebrasService);