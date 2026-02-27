import OpenAI from 'openai';
import type { AIService, ChatRequest } from '../types';

const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
});

// Free models on OpenRouter with per-model tool calling support
const MODELS: { id: string; supportsTools: boolean }[] = [
    // ✅ Supports tool calling
    { id: 'google/gemma-3-12b-it:free', supportsTools: true },
    { id: 'google/gemma-3-27b-it:free', supportsTools: true },
    { id: 'nousresearch/hermes-3-llama-3.1-405b:free', supportsTools: true },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', supportsTools: true },
    { id: 'mistralai/mistral-small-3.1-24b-instruct:free', supportsTools: true },
    { id: 'nvidia/nemotron-3-nano-30b-a3b:free', supportsTools: true },
    { id: 'qwen/qwen3-next-80b-a3b-instruct:free', supportsTools: true },
    { id: 'qwen/qwen3-coder:free', supportsTools: true },
    { id: 'qwen/qwen3-4b:free', supportsTools: true },
    { id: 'z-ai/glm-4.5-air:free', supportsTools: true },
    { id: 'upstage/solar-pro-3:free', supportsTools: true },
    { id: 'arcee-ai/trinity-large-preview:free', supportsTools: true },
    // ❌ No/limited tool calling (small models or unknown support)
    { id: 'google/gemma-3-4b-it:free', supportsTools: false },
    { id: 'google/gemma-3n-e2b-it:free', supportsTools: false },
    { id: 'google/gemma-3n-e4b-it:free', supportsTools: false },
    { id: 'meta-llama/llama-3.2-3b-instruct:free', supportsTools: false },
    { id: 'liquid/lfm-2.5-1.2b-instruct:free', supportsTools: false },
    { id: 'liquid/lfm-2.5-1.2b-thinking:free', supportsTools: false },
    { id: 'nvidia/nemotron-nano-12b-v2-vl:free', supportsTools: false },
    { id: 'nvidia/nemotron-nano-9b-v2:free', supportsTools: false },
    { id: 'openai/gpt-oss-120b:free', supportsTools: false },
    { id: 'openai/gpt-oss-20b:free', supportsTools: false },
    { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', supportsTools: false },
    { id: 'arcee-ai/trinity-mini:free', supportsTools: false },
    { id: 'stepfun/step-3.5-flash:free', supportsTools: false },
];

function createOpenRouterService({ id: model, supportsTools }: { id: string; supportsTools: boolean }): AIService {
    return {
        name: `OpenRouter/${model}`,
        supportsTools,
        async chat(request: ChatRequest, id: string) {
            const {
                messages, tools, tool_choice,
                temperature = 0.6, max_tokens = 4096,
            } = request;

            const stream = await client.chat.completions.create({
                model,
                messages: messages as any,
                stream: true,
                temperature,
                max_tokens,
                // Only send tools if this model supports them
                ...(supportsTools && tools?.length && { tools }),
                ...(supportsTools && tool_choice !== undefined && { tool_choice }),
            });

            return (async function* () {
                for await (const chunk of stream) {
                    yield `data: ${JSON.stringify({ ...chunk, id, model: `OpenRouter/${model}` })}\n\n`;
                }
                yield 'data: [DONE]\n\n';
            })();
        },
    };
}

export const openrouterServices: AIService[] = MODELS.map(createOpenRouterService);
