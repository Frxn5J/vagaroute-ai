import { groqServices } from './services/groq';
import { cerebrasServices } from './services/cerebras';
import { openrouterServices } from './services/openrouter';
import { mistralService } from './services/mistral';
import { codestralService } from './services/codestral';
import { geminiService } from './services/gemini';
import { cohereService } from './services/cohere';
import { nvidiaService } from './services/nvidia';
import type { AIService, ChatMessage } from './types';

const services: AIService[] = [
  ...groqServices,        // 10 models
  ...openrouterServices,  // 10 free models
  ...cerebrasServices,    //  3 models
  mistralService,
  codestralService,
  geminiService,
  cohereService,
  nvidiaService,
];

let currentServiceIndex = 0;

function getNextService() {
  const service = services[currentServiceIndex];
  currentServiceIndex = (currentServiceIndex + 1) % services.length;
  return service;
}

const server = Bun.serve({
  port: process.env.PORT ?? 3000,
  hostname: "0.0.0.0",
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === 'POST' && pathname === '/chat') {
      let messages: ChatMessage[];

      try {
        ({ messages } = await req.json() as { messages: ChatMessage[] });
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const MAX_RETRIES = 3;
      const errors: string[] = [];

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const service = getNextService();
        console.log(`[Attempt ${attempt}/${MAX_RETRIES}] Using ${service?.name}`);

        try {
          const stream = await service?.chat(messages);
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          });
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          console.error(`[${service?.name}] Error (attempt ${attempt}):`, msg);
          errors.push(`${service?.name}: ${msg}`);
        }
      }

      // All attempts failed
      return new Response(JSON.stringify({ error: 'All services failed', details: errors }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response("Not found", { status: 404 });
  }
});

console.log(`Server is running on ${server.url}`);
