import OpenAI from 'openai';
import type { AIService, ChatRequest } from '../types';

const client = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
});

export const nvidiaService: AIService = {
    name: 'NVIDIA NIM',
    supportsTools: true,
    async chat(request: ChatRequest, id: string) {
        const {
            messages, tools, tool_choice,
            temperature = 0.6, max_tokens = 4096,
        } = request;

        const stream = await client.chat.completions.create({
            model: 'moonshotai/kimi-k2.5',
            messages: messages as any,
            stream: true,
            temperature,
            max_tokens,
            ...(tools?.length && { tools }),
            ...(tool_choice !== undefined && { tool_choice }),
        });

        return (async function* () {
            for await (const chunk of stream) {
                yield `data: ${JSON.stringify({ ...chunk, id, model: 'NVIDIA NIM' })}\n\n`;
            }
            yield 'data: [DONE]\n\n';
        })();
    },
};
