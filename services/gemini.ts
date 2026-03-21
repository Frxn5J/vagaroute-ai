import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIService, ChatRequest, MessageContentPart } from '../types';

let genAI: GoogleGenerativeAI | null = null;
if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

function parseGeminiContent(content: string | MessageContentPart[] | null): any[] {
    if (!content) return [{ text: '' }];
    if (typeof content === 'string') return [{ text: content }];
    
    return content.map(part => {
        if (part.type === 'text') return { text: part.text };
        if (part.type === 'image_url') {
            const url = part.image_url.url;
            if (url.startsWith('data:')) {
                const match = url.match(/^data:(image\/[a-zA-Z0-9+-]+);base64,(.*)$/);
                if (match) {
                    return {
                        inlineData: {
                            mimeType: match[1],
                            data: match[2]
                        }
                    };
                }
            }
            return { text: `[Image URL: ${url}]` };
        }
        return { text: '' };
    });
}

function createGeminiService({
    id: modelId,
    supportsTools,
    supportsVision,
}: { id: string; supportsTools: boolean; supportsVision?: boolean }): AIService {
    return {
        name: `Gemini/${modelId}`,
        supportsTools,
        supportsVision,
        async chat(request: ChatRequest, id: string) {
            if (!genAI) throw new Error("GEMINI_API_KEY missing");
            const { messages, temperature = 0.6, max_tokens, response_format } = request;
            const created = Math.floor(Date.now() / 1000);

            const systemInstruction =
                messages.find(m => m.role === 'system')?.content;
            const conversationMessages = messages.filter(m => m.role !== 'system');

            const model = genAI.getGenerativeModel({
                model: modelId,
                ...(systemInstruction && { systemInstruction: typeof systemInstruction === 'string' ? systemInstruction : JSON.stringify(systemInstruction) }),
                generationConfig: {
                    temperature,
                    maxOutputTokens: max_tokens ?? 8192,
                    responseMimeType: response_format?.type === 'json_object' ? 'application/json' : 'text/plain',
                },
            });

            const history = conversationMessages.slice(0, -1).map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: parseGeminiContent(m.content),
            }));

            const lastMessage = conversationMessages[conversationMessages.length - 1];
            const chat = model.startChat({ history });
            const result = await chat.sendMessageStream(parseGeminiContent(lastMessage?.content ?? ''));

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

export let geminiServices: AIService[] = [];

if (process.env.GEMINI_API_KEY) {
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        if (res.ok) {
            const data = await res.json() as any;
            geminiServices = data.models
                .filter((m: any) => m.supportedGenerationMethods.includes("generateContent"))
                .map((m: any) => m.name.replace('models/', ''))
                .map((id: string) => createGeminiService({ id, supportsTools: false, supportsVision: !id.includes('gemma') })); // Toolkit parsing still pending for proper integration
            console.log(`[Gemini] ✅ Loaded ${geminiServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Gemini] ❌ Fetch models failed: ${e.message}`);
    }
}

