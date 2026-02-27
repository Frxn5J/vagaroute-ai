import { Mistral } from '@mistralai/mistralai';
import type { AIService, ChatMessage } from '../types';

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

export const mistralService: AIService = {
    name: 'Mistral (La Plateforme)',
    async chat(messages: ChatMessage[]) {
        const stream = await mistral.chat.stream({
            model: 'mistral-large-latest',
            messages,
            temperature: 0.6,
            maxTokens: 4096,
        });

        return (async function* () {
            for await (const event of stream) {
                const content = event.data.choices[0]?.delta?.content;
                yield typeof content === 'string' ? content : '';
            }
        })();
    }
};
