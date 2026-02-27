import OpenAI from 'openai';
import type { AIService, ChatMessage } from '../types';

const client = new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
});

export const nvidiaService: AIService = {
    name: 'NVIDIA NIM',
    async chat(messages: ChatMessage[]) {
        const stream = await client.chat.completions.create({
            model: 'meta/llama-3.3-70b-instruct',
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
    }
};
