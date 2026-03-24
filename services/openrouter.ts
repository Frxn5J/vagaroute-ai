import OpenAI from 'openai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

interface ORModel {
  id: string;
  pricing: {
    prompt: string | number;
    completion: string | number;
  };
  architecture?: {
    modality?: string;
  };
  supported_parameters?: string[];
  capabilities?: {
    tools?: boolean;
    function_calling?: boolean;
  };
}

function isFree(model: ORModel): boolean {
  return Number(model.pricing.prompt) === 0 && Number(model.pricing.completion) === 0;
}

function isChatCapable(model: ORModel): boolean {
  const id = model.id.toLowerCase();
  const skip = ['embed', 'dall-e', 'tts', 'whisper', 'ocr'];
  if (skip.some((item) => id.includes(item))) {
    return false;
  }

  const modality = model.architecture?.modality?.toLowerCase() ?? '';
  return !modality || modality.includes('text');
}

function heuristicToolSupport(id: string): boolean {
  const normalized = id.toLowerCase();
  const denied = [
    '1.2b',
    ':1b',
    '-1b:',
    '2b:',
    ':2b',
    '3b:',
    ':3b',
    '-nano',
    '-mini',
    '-vl',
    'vision',
    '-ocr',
    'safeguard',
    'guard',
    'embedding',
    ':thinking',
    '-thinking',
    'orpheus',
    'tts',
    'dall-e',
    'whisper',
    'dolphin-mistral',
    'trinity-mini',
    'step-3.5',
  ];
  if (denied.some((item) => normalized.includes(item))) {
    return false;
  }

  const allowed = [
    'llama-3',
    'llama-4',
    'mistral',
    'mixtral',
    'qwen3',
    'qwen-2.5',
    'hermes',
    'gemma-3-12b',
    'gemma-3-27b',
    'solar-pro',
    'nemotron-3-nano-30b',
    'command-r',
    'gpt-4',
    'gpt-3.5',
    'claude',
    'deepseek-v',
    'deepseek-chat',
    'phi-4',
    'glm-4',
    'trinity-large',
    'kimi',
    'moonshot',
    'minimax',
  ];
  return allowed.some((item) => normalized.includes(item));
}

function detectTools(model: ORModel): boolean {
  if (Array.isArray(model.supported_parameters) && model.supported_parameters.length > 0) {
    return model.supported_parameters.some((item) => item === 'tools' || item === 'tool_choice');
  }

  if (model.capabilities !== undefined) {
    return Boolean(model.capabilities.tools ?? model.capabilities.function_calling);
  }

  return heuristicToolSupport(model.id);
}

function createOpenRouterService({
  id: model,
  supportsTools,
  supportsVision,
}: {
  id: string;
  supportsTools: boolean;
  supportsVision?: boolean;
}): AIService {
  return {
    name: `OpenRouter/${model}`,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('openrouter', async ({ key }) => {
        const client = new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: key,
        });
        const {
          messages,
          tools,
          tool_choice,
          temperature = 0.6,
          max_tokens = 4096,
        } = request;

        const stream = await client.chat.completions.create({
          model,
          messages: messages as never,
          stream: true,
          stream_options: { include_usage: true },
          temperature,
          max_tokens,
          ...(supportsTools && tools?.length && { tools }),
          ...(supportsTools && tool_choice !== undefined && { tool_choice }),
          ...(request.response_format && { response_format: request.response_format }),
        });

        return (async function* () {
          for await (const chunk of stream) {
            yield `data: ${JSON.stringify({ ...chunk, id, model: `OpenRouter/${model}` })}\n\n`;
          }
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadOpenRouterServices(): Promise<{
  freeServices: AIService[];
  paidServices: AIService[];
}> {
  try {
    const result = await withProviderKey('openrouter', async ({ key }) => {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter models HTTP ${response.status}`);
      }

      const body = await response.json() as { data?: ORModel[] };
      const chatModels = (body.data ?? []).filter(isChatCapable);

      const freeServices = chatModels
        .filter(isFree)
        .map((model) => createOpenRouterService({
          id: model.id,
          supportsTools: detectTools(model),
          supportsVision: model.architecture?.modality?.includes('image'),
        }));

      const paidServices = chatModels
        .filter((model) => !isFree(model))
        .map((model) => createOpenRouterService({
          id: model.id,
          supportsTools: detectTools(model),
          supportsVision: model.architecture?.modality?.includes('image'),
        }));

      return { freeServices, paidServices };
    });

    logger.info(
      {
        provider: 'openrouter',
        free: result.freeServices.length,
        paid: result.paidServices.length,
      },
      'OpenRouter models loaded',
    );
    return result;
  } catch (err) {
    logger.warn({ err }, 'OpenRouter models could not be loaded');
    return { freeServices: [], paidServices: [] };
  }
}
