import OpenAI from 'openai';
import type { AIService, ChatRequest } from '../types';

let client: OpenAI | null = null;
if (process.env.NVIDIA_API_KEY) {
    client = new OpenAI({
        baseURL: 'https://integrate.api.nvidia.com/v1',
        apiKey: process.env.NVIDIA_API_KEY,
    });
}

function createNvidiaService({ id: model, supportsTools }: { id: string; supportsTools: boolean }): AIService {
    return {
        name: `NVIDIA/${model}`,
        supportsTools,
        async chat(request: ChatRequest, id: string) {
            if (!client) throw new Error("NVIDIA_API_KEY missing");
            const {
                messages, tools, tool_choice,
                temperature = 0.6, max_tokens = 4096,
            } = request;

            const stream = await client.chat.completions.create({
                model,
                messages: messages as any,
                stream: true,
                temperature,
                max_tokens,
                ...(supportsTools && tools?.length && { tools }),
                ...(supportsTools && tool_choice !== undefined && { tool_choice }),
            });

            return (async function* () {
                for await (const chunk of stream) {
                    yield `data: ${JSON.stringify({ ...chunk, id, model: `NVIDIA/${model}` })}\n\n`;
                }
                yield 'data: [DONE]\n\n';
            })();
        },
    };
}

export let nvidiaServices: AIService[] = [];

if (process.env.NVIDIA_API_KEY) {
    try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
            headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            nvidiaServices = data.data.map((m: any) => createNvidiaService({ id: m.id, supportsTools: true }));
            console.log(`[Nvidia] ✅ Loaded ${nvidiaServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Nvidia] ❌ Fetch models failed: ${e.message}`);
    }
}

