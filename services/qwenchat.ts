import OpenAI from 'openai';
import { withProviderKey } from '../core/providerKeys';
import type { AIService, ChatRequest } from '../types';
import { logger } from '../utils/logger';

const QWEN_BASE_URL = 'https://qwen.aikit.club/v1';

interface QwenModel {
  id: string;
}

interface QwenRequestExtras {
  enable_thinking?: boolean;
  thinking_budget?: number;
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function isChatCapableModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  const denied = ['embed', 'embedding', 'image', 'video', 'audio', 'tts', 'asr', 'rerank', 'wanx'];
  return !denied.some((item) => normalized.includes(item));
}

function supportsToolsModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  const supportedPatterns = [
    'qwen3.5-plus',
    'qwen3.5-flash',
    'qwen3.5-397b-a17b',
    'qwen3-max',
    'qwen-max-latest',
    'qwen3-coder',
    'qwen3-coder-plus',
    'qwen3-235b-a22b-2507',
  ];

  return supportedPatterns.some((pattern) => normalized.includes(pattern));
}

function supportsVisionModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);

  if (normalized.includes('qwen3-max') || normalized.includes('qwen-deep-research')) {
    return false;
  }

  return normalized.includes('vl')
    || normalized.includes('vision')
    || normalized.includes('qvq')
    || normalized.includes('omni')
    || normalized.includes('web-dev')
    || normalized.includes('full-stack')
    || normalized.includes('slides')
    || normalized.includes('qwen2.5')
    || normalized.includes('qwen3.5')
    || normalized.includes('qwen-max-latest')
    || normalized.includes('qwen3-coder');
}

function createQwenChatService({ id: modelId }: QwenModel): AIService {
  const serviceName = `Qwen Chat/${modelId}`;
  const supportsVision = supportsVisionModel(modelId);
  const supportsTools = supportsToolsModel(modelId);

  return {
    name: serviceName,
    supportsTools,
    supportsVision,
    async chat(request: ChatRequest, id: string) {
      return withProviderKey('qwenchat', async ({ key }) => {
        const client = new OpenAI({
          baseURL: QWEN_BASE_URL,
          apiKey: key,
        });
        const {
          messages,
          temperature = 0.6,
          max_tokens = 4096,
          top_p = 1,
          response_format,
          tools,
          tool_choice,
        } = request;
        const extras = request as ChatRequest & QwenRequestExtras;

        const stream = await client.chat.completions.create({
          model: modelId,
          messages: messages as never,
          stream: true,
          stream_options: { include_usage: true },
          temperature,
          max_tokens,
          top_p,
          ...(response_format && { response_format }),
          ...(supportsTools && tools?.length && { tools: tools as never }),
          ...(supportsTools && tool_choice !== undefined && { tool_choice: tool_choice as never }),
          ...(typeof extras.enable_thinking === 'boolean' && { enable_thinking: extras.enable_thinking as never }),
          ...(typeof extras.thinking_budget === 'number' && { thinking_budget: extras.thinking_budget as never }),
        });

        return (async function* () {
          for await (const chunk of stream) {
            yield `data: ${JSON.stringify({ ...chunk, id, model: serviceName })}\n\n`;
          }
          yield 'data: [DONE]\n\n';
        })();
      });
    },
  };
}

export async function loadQwenChatServices(): Promise<AIService[]> {
  try {
    const services = await withProviderKey('qwenchat', async ({ key }) => {
      const response = await fetch(`${QWEN_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Qwen Chat models HTTP ${response.status}`);
      }

      const body = await response.json() as { data?: QwenModel[] };
      return (body.data ?? [])
        .filter((model) => Boolean(model.id) && isChatCapableModel(model.id))
        .map((model) => createQwenChatService(model));
    });

    logger.info({ provider: 'qwenchat', count: services.length }, 'Qwen Chat models loaded');
    return services;
  } catch (err) {
    logger.warn({ err }, 'Qwen Chat models could not be loaded');
    return [];
  }
}
