import { CohereClient } from 'cohere-ai';
import type { AIService, ChatRequest } from '../types';

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

export const cohereService: AIService = {
    name: 'Cohere',
    // Cohere uses its own tool schema format — not transparently compatible.
    supportsTools: false,
    async chat(request: ChatRequest, id: string) {
        const { messages, temperature = 0.6, max_tokens = 4096 } = request;
        const created = Math.floor(Date.now() / 1000);

        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const conversationMessages = messages.filter(m => m.role !== 'system');
        const lastMessage = conversationMessages[conversationMessages.length - 1];
        const chatHistory = conversationMessages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'CHATBOT' as const : 'USER' as const,
            message: m.content ?? '',
        }));

        const stream = await cohere.chatStream({
            model: 'command-r-plus',
            message: lastMessage?.content ?? '',
            chatHistory,
            ...(systemMessage && { preamble: systemMessage }),
            temperature,
            maxTokens: max_tokens,
        });

        return (async function* () {
            for await (const event of stream) {
                if (event.eventType === 'text-generation') {
                    yield `data: ${JSON.stringify({
                        id, object: 'chat.completion.chunk', created, model: 'Cohere',
                        choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
                    })}\n\n`;
                }
            }
            yield `data: ${JSON.stringify({
                id, object: 'chat.completion.chunk', created, model: 'Cohere',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            })}\n\n`;
            yield 'data: [DONE]\n\n';
        })();
    },
};
