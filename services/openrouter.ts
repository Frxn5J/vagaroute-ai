import OpenAI from 'openai';
import type { AIService, ChatMessage } from '../types';

const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
});

// Free models on OpenRouter (identified by the :free suffix)
const FREE_MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'deepseek/deepseek-r1:free',
    'deepseek/deepseek-v3-0324:free',
    'microsoft/phi-4-reasoning-plus:free',
    'qwen/qwen3-30b-a3b:free',
    'mistralai/mistral-7b-instruct:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    'nvidia/llama-3.1-nemotron-70b-instruct:free',
];

function createOpenRouterService(model: string): AIService {
    return {
        name: `OpenRouter/${model}`,
        async chat(messages: ChatMessage[]) {
            const stream = await client.chat.completions.create({
                model,
                messages,
                stream: true,
                temperature: 0.6,
                max_tokens: 4096,
            });

            return (async function* () {
                for await (const chunk of stream) {
                    yield chunk.choices[0]?.delta?.content || '';
                }
            })();
        },
    };
}

export const openrouterServices: AIService[] = FREE_MODELS.map(createOpenRouterService);
