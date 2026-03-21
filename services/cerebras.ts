import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { AIService, ChatRequest } from '../types';

let cerebras: Cerebras | null = null;
if (process.env.CEREBRAS_API_KEY) {
    cerebras = new Cerebras();
}

function createCerebrasService({ id: model, supportsTools }: { id: string; supportsTools: boolean }): AIService {
  return {
    name: `Cerebras/${model}`,
    supportsTools,
    async chat(request: ChatRequest, id: string) {
      if (!cerebras) throw new Error("CEREBRAS_API_KEY missing");
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

export let cerebrasServices: AIService[] = [];

if (process.env.CEREBRAS_API_KEY) {
    try {
        const res = await fetch('https://api.cerebras.ai/v1/models', {
            headers: { Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            cerebrasServices = data.data.map((m: any) => createCerebrasService({ id: m.id, supportsTools: true }));
            console.log(`[Cerebras] ✅ Loaded ${cerebrasServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Cerebras] ❌ Fetch failed: ${e.message}`);
    }
}

