import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIService, ChatMessage } from '../types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const geminiService: AIService = {
    name: 'Gemini',
    async chat(messages: ChatMessage[]) {
        const systemInstruction = messages.find(m => m.role === 'system')?.content;
        const conversationMessages = messages.filter(m => m.role !== 'system');

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            ...(systemInstruction && { systemInstruction }),
            generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 8192,
            },
        });

        // Build chat history (all messages except the last one)
        const history = conversationMessages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));

        const lastMessage = conversationMessages[conversationMessages.length - 1];
        const chat = model.startChat({ history });
        const result = await chat.sendMessageStream(lastMessage?.content ?? '');

        return (async function* () {
            for await (const chunk of result.stream) {
                yield chunk.text();
            }
        })();
    }
};
