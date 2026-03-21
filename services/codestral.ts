import { Mistral } from '@mistralai/mistralai';
import type { AIService, ChatRequest } from '../types';

const hasDedicatedKey = !!process.env.CODESTRAL_API_KEY &&
    process.env.CODESTRAL_API_KEY !== process.env.MISTRAL_API_KEY;

const apiKey = process.env.CODESTRAL_API_KEY ?? process.env.MISTRAL_API_KEY;

let codestral: Mistral | null = null;
if (apiKey) {
    codestral = new Mistral({
        apiKey,
        ...(hasDedicatedKey && { serverURL: 'https://codestral.mistral.ai' }),
    });
}

function createCodestralService({ id: model }: { id: string }): AIService {
    return {
        name: `Codestral/${model}`,
        supportsTools: true,
        async chat(request: ChatRequest, id: string) {
            if (!codestral) throw new Error("CODESTRAL_API_KEY missing");
            const {
                messages, tools, tool_choice,
                temperature = 0.3, max_tokens = 8192,
            } = request;
            const created = Math.floor(Date.now() / 1000);

            const stream = await codestral.chat.stream({
                model,
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
                        model: `Codestral/${model}`,
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

export let codestralServices: AIService[] = [];

if (apiKey) {
    try {
        const url = hasDedicatedKey ? 'https://codestral.mistral.ai/v1/models' : 'https://api.mistral.ai/v1/models';
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        if (res.ok) {
            const data = await res.json() as any;
            codestralServices = data.data
                .filter((m: any) => m.id.includes('codestral'))
                .map((m: any) => createCodestralService({ id: m.id }));
            
            // Fallback if none found
            if (codestralServices.length === 0) {
                 codestralServices = [createCodestralService({ id: 'codestral-latest' })];
            }
            console.log(`[Codestral] ✅ Loaded ${codestralServices.length} dynamic models`);
        }
    } catch (e: any) {
        console.error(`[Codestral] ❌ Fetch models failed: ${e.message}`);
    }
}

