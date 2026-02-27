import { Mistral } from '@mistralai/mistralai';
import type { AIService, ChatRequest } from '../types';

const hasDedicatedKey = !!process.env.CODESTRAL_API_KEY &&
    process.env.CODESTRAL_API_KEY !== process.env.MISTRAL_API_KEY;

const codestral = new Mistral({
    apiKey: process.env.CODESTRAL_API_KEY ?? process.env.MISTRAL_API_KEY,
    ...(hasDedicatedKey && { serverURL: 'https://codestral.mistral.ai' }),
});

export const codestralService: AIService = {
    name: 'Codestral',
    supportsTools: true,
    async chat(request: ChatRequest, id: string) {
        const {
            messages, tools, tool_choice,
            temperature = 0.3, max_tokens = 8192,
        } = request;
        const created = Math.floor(Date.now() / 1000);

        const stream = await codestral.chat.stream({
            model: 'codestral-latest',
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
                    model: 'Codestral',
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
