import { Mistral } from '@mistralai/mistralai';
import type { AIService, ChatMessage } from '../types';

// codestral.mistral.ai requires its own separate API key.
// If CODESTRAL_API_KEY is set, use the dedicated Codestral endpoint.
// Otherwise, fall back to the regular La Plateforme API (also supports codestral-latest).
const hasDedicatedKey = !!process.env.CODESTRAL_API_KEY &&
    process.env.CODESTRAL_API_KEY !== process.env.MISTRAL_API_KEY;

const codestral = new Mistral({
    apiKey: process.env.CODESTRAL_API_KEY ?? process.env.MISTRAL_API_KEY,
    ...(hasDedicatedKey && { serverURL: 'https://codestral.mistral.ai' }),
});

export const codestralService: AIService = {
    name: 'Codestral',
    async chat(messages: ChatMessage[]) {
        const stream = await codestral.chat.stream({
            model: 'codestral-latest',
            messages,
            temperature: 0.3,
            maxTokens: 8192,
        });

        return (async function* () {
            for await (const event of stream) {
                const content = event.data.choices[0]?.delta?.content;
                yield typeof content === 'string' ? content : '';
            }
        })();
    }
};
