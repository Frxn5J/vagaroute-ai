import { withProviderKey } from '../core/providerKeys';
import type { ProviderName } from '../core/providerKeys';
import type { AIService } from '../types';
import { logger } from '../utils/logger';

/**
 * Re-emite un stream estilo OpenAI como líneas SSE, reescribiendo `id` y `model`.
 * Sirve para cualquier proveedor cuyos chunks ya tengan la forma OpenAI.
 */
export function reEmitSSE(
  stream: AsyncIterable<unknown>,
  id: string,
  name: string,
): AsyncIterable<string> {
  return (async function* () {
    for await (const chunk of stream) {
      yield `data: ${JSON.stringify({ ...(chunk as object), id, model: name })}\n\n`;
    }
    yield 'data: [DONE]\n\n';
  })();
}

/**
 * Carga modelos de un proveedor OpenAI-compatible: GET {modelsUrl} con Bearer,
 * respuesta `{ data: [{ id }] }`, y construye los AIService con `build`.
 * Devuelve [] ante cualquier error (logueado como warn). `init` permite extender
 * el fetch (p.ej. signal de timeout).
 */
export async function loadOpenAICompatibleServices(
  provider: ProviderName,
  modelsUrl: string,
  build: (models: Array<{ id: string }>) => AIService[],
  init?: RequestInit,
): Promise<AIService[]> {
  try {
    const services = await withProviderKey(provider, async ({ key }) => {
      const res = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${key}` },
        ...init,
      });
      if (!res.ok) throw new Error(`${provider} models HTTP ${res.status}`);
      const data = await res.json() as { data?: Array<{ id: string }> };
      return build(data.data ?? []);
    });
    logger.info({ provider, count: services.length }, 'Provider models loaded');
    return services;
  } catch (err) {
    logger.warn({ err, provider }, 'Provider models could not be loaded');
    return [];
  }
}
