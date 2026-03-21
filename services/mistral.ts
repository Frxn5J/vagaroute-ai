import { Mistral } from '@mistralai/mistralai';
import type { AIService, ChatRequest } from '../types';

let mistral: Mistral | null = null;
if (process.env.MISTRAL_API_KEY) {
    mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
}

function createMistralService(modelId: string): AIService {
    return {
        name: `Mistral/${modelId}`,
        supportsTools: true,
        supportsVision: modelId.includes('pixtral'),
        async chat(request: ChatRequest, id: string) {
            if (!mistral) throw new Error("MISTRAL_API_KEY missing");
            const {
                messages, tools, tool_choice,
                temperature = 0.6, max_tokens = 4096,
            } = request;
            const created = Math.floor(Date.now() / 1000);

            const stream = await mistral.chat.stream({
                model: modelId,
                messages: messages as any,
                temperature,
                maxTokens: max_tokens,
                ...(tools?.length && { tools }),
                ...(tool_choice !== undefined && { toolChoice: tool_choice as any }),
                ...(request.response_format && { responseFormat: request.response_format as any }),
            });

            return (async function* () {
                for await (const event of stream) {
                    const chunk = event.data;
                    const choice = chunk.choices[0];
                    const rawContent = choice?.delta?.content;
                    const content = typeof rawContent === 'string' ? rawContent : undefined;

                    const out = {
                        id,
                        object: 'chat.completion.chunk',
                        created,
                        model: `Mistral/${modelId}`,
                        choices: [{
                            index: 0,
                            delta: {
                                ...(content !== undefined && { content }),
                                ...((choice?.delta as any)?.toolCalls?.length && {
                                    tool_calls: (choice?.delta as any).toolCalls,
                                }),
                            },
                            finish_reason: choice?.finishReason ?? null,
                        }],
                    };
                    yield `data: ${JSON.stringify(out)}\n\n`;
                }
                yield 'data: [DONE]\n\n';
            })();
        },
    };
}

export let mistralServices: AIService[] = [];

if (process.env.MISTRAL_API_KEY) {
    try {
        const res = await fetch('https://api.mistral.ai/v1/models', {
            headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            mistralServices = data.data.map((m: any) => createMistralService(m.id));
            console.log(`[Mistral] ✅ Loaded ${mistralServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Mistral] ❌ Fetch models failed: ${e.message}`);
    }
}

