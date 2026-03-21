import OpenAI from 'openai';
import type { AIService, ChatRequest } from '../types';

let client: OpenAI | null = null;
if (process.env.ALIBABA_API_KEY) {
    client = new OpenAI({
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        apiKey: process.env.ALIBABA_API_KEY,
    });
}

function createAlibabaService({ id: model, supportsTools, supportsVision }: { id: string; supportsTools: boolean; supportsVision?: boolean }): AIService {
    return {
        name: `Alibaba/${model}`,
        supportsTools,
        supportsVision,
        async chat(request: ChatRequest, id: string) {
            if (!client) throw new Error("ALIBABA_API_KEY missing");
            const {
                messages, tools, tool_choice,
                temperature = 0.6, max_tokens = 4096, top_p = 0.95,
            } = request;

            const stream = await client.chat.completions.create({
                messages: messages as any,
                model,
                stream: true,
                temperature,
                max_tokens,
                top_p,
                ...(supportsTools && tools?.length && { tools }),
                ...(supportsTools && tool_choice !== undefined && { tool_choice }),
            });

            return (async function* () {
                for await (const chunk of stream) {
                    yield `data: ${JSON.stringify({ ...chunk, id, model: `Alibaba/${model}` })}\n\n`;
                }
                yield 'data: [DONE]\n\n';
            })();
        },
    };
}

export let alibabaServices: AIService[] = [];

if (process.env.ALIBABA_API_KEY) {
    try {
        const res = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models', {
            headers: { Authorization: `Bearer ${process.env.ALIBABA_API_KEY}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            alibabaServices = data.data.map((m: any) => createAlibabaService({ 
                id: m.id, 
                supportsTools: !m.id.includes('-vl-') && !m.id.includes('-mt-') && !m.id.startsWith('wan') && !m.id.startsWith('qvq'),
                supportsVision: m.id.includes('-vl-')
            }));
            console.log(`[Alibaba] ✅ Loaded ${alibabaServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Alibaba] ❌ Fetch models failed: ${e.message}`);
    }
}

