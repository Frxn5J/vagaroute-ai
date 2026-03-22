import type { AIService, ChatRequest } from '../types';

let puterServices: AIService[] = [];

// Lista estática generosa inicial en caso de que el endpoint /models de Puter cambie
const fallbackModels = [
    'claude-3-5-sonnet',
    'claude-3-haiku',
    'gpt-4o',
    'gpt-4o-mini',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'mistral-large',
    'llama-3.1-70b'
];

function createPuterService({ id: modelId, supportsTools, supportsVision }: { id: string; supportsTools: boolean; supportsVision?: boolean }): AIService {
    return {
        name: `Puter/${modelId}`,
        supportsTools,
        supportsVision,
        async chat(request: ChatRequest, id: string) {
            const apiKey = process.env.puterAuthToken || process.env.PUTER_API_KEY;
            if (!apiKey) throw new Error("puterAuthToken está faltando en el .env");

            const { messages, temperature, max_tokens, response_format, tools, tool_choice } = request;

            // Limpiamos nulos
            const cleanMessages = messages.filter(m => m.content !== null).map(m => ({
                ...m,
                content: m.content || ""
            }));

            // Construir un Body estrictamente limpio, omitiendo llaves conflictivas
            const body: any = {
                model: modelId,
                messages: cleanMessages,
                stream: false, // [CRÍTICO] Forzamos FALSE porque el servidor backend de Puter explota intentando armar el SSE a través de REST.
            };

            if (typeof temperature === 'number') body.temperature = temperature;
            if (typeof max_tokens === 'number') body.max_tokens = max_tokens;
            if (response_format) body.response_format = response_format;
            if (tools && tools.length > 0) {
                body.tools = tools;
                if (tool_choice) body.tool_choice = tool_choice;
            }

            const res = await fetch('https://api.puter.com/puterai/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                let errorText = await res.text();
                throw new Error(`Puter REST API Error ${res.status}: ${errorText}`);
            }

            const textData = await res.text();
            let content = "";
            let tool_calls = null;
            try {
                const json = JSON.parse(textData);
                content = json.choices?.[0]?.message?.content || "";
                tool_calls = json.choices?.[0]?.message?.tool_calls;
            } catch (e) {
                content = textData;
            }

            return (async function* () {
                if (content || tool_calls) {
                    yield `data: ${JSON.stringify({ 
                        id, 
                        model: `Puter/${modelId}`, 
                        choices: [{ 
                            index: 0, 
                            delta: { content: content || null, ...(tool_calls && { tool_calls }) }, 
                            finish_reason: null 
                        }] 
                    })}\n\n`;
                }
                yield `data: ${JSON.stringify({ 
                    id, 
                    model: `Puter/${modelId}`, 
                    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] 
                })}\n\n`;
                yield 'data: [DONE]\n\n';
            })();
        }
    };
}




const apiKey = process.env.puterAuthToken || process.env.PUTER_API_KEY;

if (apiKey) {
    try {
        const res = await fetch('https://api.puter.com/puterai/chat/models/details', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        let loadedModels = fallbackModels;
        
        if (res.ok) {
            const data = await res.json() as any;
            if (data?.models && Array.isArray(data.models)) {
                // Sacamos todos los IDs reales que expone Puter
                loadedModels = data.models.map((m: any) => m.id);
            }
        }

        puterServices = loadedModels.map(id => createPuterService({ 
            id, 
            supportsTools: true,
            supportsVision: id.includes('gpt-4o') || id.includes('gemini') || id.includes('claude-3') || id.includes('vision')
        }));
        
        console.log(`[Puter] ✅ Loaded ${puterServices.length} dynamic models`);
    } catch (e: any) {
        console.warn(`[Puter] Failed to fetch explicitly, loading fallbacks: ${e.message}`);
        puterServices = fallbackModels.map(id => createPuterService({ 
            id, 
            supportsTools: true,
            supportsVision: id.includes('gpt-4o') || id.includes('gemini') || id.includes('claude-3')
        }));
    }
} else {
    console.warn("[Puter] No API key found. Skipping initialization.");
}

export { puterServices };
