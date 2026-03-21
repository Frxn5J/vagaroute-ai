import { Groq } from 'groq-sdk';
import type { AIService, ChatRequest } from '../types';

let groq: Groq | null = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq();
}

function createGroqService({ id: model, supportsTools, supportsVision }: { id: string; supportsTools: boolean; supportsVision?: boolean }): AIService {
  return {
    name: `Groq/${model}`,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      if (!groq) throw new Error("GROQ_API_KEY is missing");
      const {
        messages, tools, tool_choice,
        temperature = 0.6, max_tokens = 4096, top_p = 1,
      } = request;

      const stream = await groq.chat.completions.create({
        messages: messages as any,
        model,
        temperature,
        max_completion_tokens: max_tokens,
        top_p,
        stream: true,
        stop: null,
        ...(supportsTools && tools?.length && { tools }),
        ...(supportsTools && tool_choice !== undefined && { tool_choice }),
        ...(request.response_format && { response_format: request.response_format }),
      });

      return (async function* () {
        for await (const chunk of stream) {
          yield `data: ${JSON.stringify({ ...chunk, id, model: `Groq/${model}` })}\n\n`;
        }
        yield 'data: [DONE]\n\n';
      })();
    },
  };
}

export let groqServices: AIService[] = [];

if (process.env.GROQ_API_KEY) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            groqServices = data.data
                .filter((m: any) => !m.id.includes('whisper'))
                .map((m: any) => createGroqService({ 
                    id: m.id, 
                    supportsTools: !m.id.includes('gpt-oss') && !m.id.includes('deepseek-r1'),
                    supportsVision: m.id.includes('vision') || m.id.includes('llava')
                }));
            console.log(`[Groq] ✅ Loaded ${groqServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Groq] ❌ Failed to fetch dynamic models: ${e.message}`);
    }
}

