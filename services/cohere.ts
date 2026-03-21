import { CohereClient } from 'cohere-ai';
import type { AIService, ChatRequest } from '../types';

let cohere: CohereClient | null = null;
if (process.env.COHERE_API_KEY) {
    cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
}

function createCohereService({ id: modelId }: { id: string }): AIService {
    return {
        name: `Cohere/${modelId}`,
        // Cohere uses its own tool schema format — not transparently compatible.
        supportsTools: false,
        async chat(request: ChatRequest, id: string) {
            if (!cohere) throw new Error("COHERE_API_KEY missing");
            const { messages, temperature = 0.6, max_tokens = 4096 } = request;
            const created = Math.floor(Date.now() / 1000);

            const systemMessage = messages.find(m => m.role === 'system')?.content;
            const conversationMessages = messages.filter(m => m.role !== 'system');
            const lastMessage = conversationMessages[conversationMessages.length - 1];
            
            // Simplistic history mapping
            const chatHistory = conversationMessages.slice(0, -1).map(m => {
                let txt = '';
                if (typeof m.content === 'string') txt = m.content;
                else if (Array.isArray(m.content)) {
                    const textPart = m.content.find(p => p.type === 'text') as any;
                    txt = textPart?.text ?? '';
                }
                return {
                    role: m.role === 'assistant' ? 'CHATBOT' as const : 'USER' as const,
                    message: txt,
                };
            });

            const stream = await cohere.chatStream({
                model: modelId,
                message: typeof lastMessage?.content === 'string' ? lastMessage.content : ((lastMessage?.content as any[])?.find((p: any) => p.type === 'text')?.text ?? ''),
                chatHistory,
                ...(systemMessage && { preamble: typeof systemMessage === 'string' ? systemMessage : JSON.stringify(systemMessage) }),
                temperature,
                maxTokens: max_tokens,
            });

            return (async function* () {
                for await (const event of stream) {
                    if (event.eventType === 'text-generation') {
                        yield `data: ${JSON.stringify({
                            id, object: 'chat.completion.chunk', created, model: `Cohere/${modelId}`,
                            choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
                        })}\n\n`;
                    }
                }
                yield `data: ${JSON.stringify({
                    id, object: 'chat.completion.chunk', created, model: `Cohere/${modelId}`,
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                })}\n\n`;
                yield 'data: [DONE]\n\n';
            })();
        },
    };
}

export let cohereServices: AIService[] = [];

if (process.env.COHERE_API_KEY) {
    try {
        const res = await fetch('https://api.cohere.ai/v1/models', {
            headers: { Authorization: `Bearer ${process.env.COHERE_API_KEY}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            cohereServices = data.models
                .filter((m: any) => m.endpoints?.includes('chat'))
                .map((m: any) => createCohereService({ id: m.name }));
            console.log(`[Cohere] ✅ Loaded ${cohereServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Cohere] ❌ Fetch models failed: ${e.message}`);
    }
}

