import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIService, ChatRequest } from '../types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Free models available in Google AI Studio
// Note: Gemini's function calling uses a different schema than OpenAI's,
// requiring non-trivial conversion. Marked supportsTools: false until implemented.
const MODELS: { id: string; supportsTools: boolean; maxOutputTokens: number }[] = [
    // Gemini Flash (250K TPM, 5 req/min, 20 req/day)
    { id: 'gemini-3.0-flash', supportsTools: false, maxOutputTokens: 8192 },
    { id: 'gemini-2.5-flash', supportsTools: false, maxOutputTokens: 8192 },
    { id: 'gemini-2.5-flash-lite', supportsTools: false, maxOutputTokens: 8192 },
    // Gemma 3 (15K TPM, 30 req/min, 14400 req/day)
    { id: 'gemma-3-27b-it', supportsTools: false, maxOutputTokens: 8192 },
    { id: 'gemma-3-12b-it', supportsTools: false, maxOutputTokens: 8192 },
    { id: 'gemma-3-4b-it', supportsTools: false, maxOutputTokens: 4096 },
    { id: 'gemma-3-1b-it', supportsTools: false, maxOutputTokens: 2048 },
];

function createGeminiService({
    id: modelId,
    supportsTools,
    maxOutputTokens,
}: (typeof MODELS)[number]): AIService {
    return {
        name: `Gemini/${modelId}`,
        supportsTools,
        async chat(request: ChatRequest, id: string) {
            const { messages, temperature = 0.6, max_tokens } = request;
            const created = Math.floor(Date.now() / 1000);

            const systemInstruction =
                messages.find(m => m.role === 'system')?.content ?? undefined;
            const conversationMessages = messages.filter(m => m.role !== 'system');

            const model = genAI.getGenerativeModel({
                model: modelId,
                ...(systemInstruction && { systemInstruction }),
                generationConfig: {
                    temperature,
                    maxOutputTokens: max_tokens ?? maxOutputTokens,
                },
            });

            // Map assistant → model, tool → user (best-effort for non-tool requests)
            const history = conversationMessages.slice(0, -1).map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content ?? '' }],
            }));

            const lastMessage = conversationMessages[conversationMessages.length - 1];
            const chat = model.startChat({ history });
            const result = await chat.sendMessageStream(lastMessage?.content ?? '');

            return (async function* () {
                for await (const chunk of result.stream) {
                    const text = chunk.text();
                    if (text) {
                        yield `data: ${JSON.stringify({
                            id,
                            object: 'chat.completion.chunk',
                            created,
                            model: `Gemini/${modelId}`,
                            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                        })}\n\n`;
                    }
                }
                yield `data: ${JSON.stringify({
                    id,
                    object: 'chat.completion.chunk',
                    created,
                    model: `Gemini/${modelId}`,
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                })}\n\n`;
                yield 'data: [DONE]\n\n';
            })();
        },
    };
}

export const geminiServices: AIService[] = MODELS.map(createGeminiService);

// Keep singular export for backward compat
export const geminiService = geminiServices[0]!;
