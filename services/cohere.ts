import { CohereClient } from 'cohere-ai';
import type { AIService, ChatMessage } from '../types';

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

export const cohereService: AIService = {
    name: 'Cohere',
    async chat(messages: ChatMessage[]) {
        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const conversationMessages = messages.filter(m => m.role !== 'system');

        // Cohere separates the last message from the history
        const lastMessage = conversationMessages[conversationMessages.length - 1];
        const chatHistory = conversationMessages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'CHATBOT' as const : 'USER' as const,
            message: m.content,
        }));

        const stream = await cohere.chatStream({
            model: 'command-r-plus',
            message: lastMessage?.content ?? '',
            chatHistory,
            ...(systemMessage && { preamble: systemMessage }),
            temperature: 0.6,
            maxTokens: 4096,
        });

        return (async function* () {
            for await (const event of stream) {
                if (event.eventType === 'text-generation') {
                    yield event.text;
                }
            }
        })();
    }
};
