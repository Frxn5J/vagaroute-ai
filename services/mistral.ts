import { Mistral } from '@mistralai/mistralai';
import type { AIService, ChatRequest } from '../types';

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

export const mistralService: AIService = {
    name: 'Mistral (La Plateforme)',
    supportsTools: true,
    async chat(request: ChatRequest, id: string) {
        const {
            messages, tools, tool_choice,
            temperature = 0.6, max_tokens = 4096,
        } = request;
        const created = Math.floor(Date.now() / 1000);

        const stream = await mistral.chat.stream({
            model: 'mistral-large-latest',
            messages: messages as any,
            temperature,
            maxTokens: max_tokens,
            ...(tools?.length && { tools }),
            ...(tool_choice !== undefined && { toolChoice: tool_choice as any }),
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
                    model: 'Mistral (La Plateforme)',
                    choices: [{
                        index: 0,
                        delta: {
                            ...(content !== undefined && { content }),
                            // Map Mistral tool_calls format to OpenAI format
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
