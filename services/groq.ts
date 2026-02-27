import { Groq } from 'groq-sdk';
import type { AIService, ChatRequest } from '../types';

const groq = new Groq();

// Per-model tool calling support on Groq
// Not all models support function/tool calling — mark explicitly
const MODELS: { id: string; supportsTools: boolean }[] = [
  // ✅ Supports tool calling
  { id: 'groq/compound', supportsTools: true },
  { id: 'groq/compound-mini', supportsTools: true },
  { id: 'llama-3.3-70b-versatile', supportsTools: true },
  { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', supportsTools: true },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', supportsTools: true },
  { id: 'qwen/qwen3-32b', supportsTools: true },
  { id: 'mixtral-8x7b-32768', supportsTools: true },
  // ❌ No tool calling support (or too small context for tools)
  { id: 'moonshotai/kimi-k2-instruct', supportsTools: false },
  { id: 'moonshotai/kimi-k2-instruct-0905', supportsTools: false },
  { id: 'openai/gpt-oss-120b', supportsTools: false },
  { id: 'openai/gpt-oss-20b', supportsTools: false },
  { id: 'deepseek-r1-distill-llama-70b', supportsTools: false },
];

function createGroqService({ id: model, supportsTools }: { id: string; supportsTools: boolean }): AIService {
  return {
    name: `Groq/${model}`,
    supportsTools,
    async chat(request: ChatRequest, id: string) {
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
        // Only pass tools if this model supports them
        ...(supportsTools && tools?.length && { tools }),
        ...(supportsTools && tool_choice !== undefined && { tool_choice }),
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

export const groqServices: AIService[] = MODELS.map(createGroqService);
