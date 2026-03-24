export interface UsageCostInput {
  requestType: string;
  provider?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  audioSeconds?: number;
}

function perThousand(tokens: number, rateUsdPerThousand: number): number {
  return (tokens / 1_000) * rateUsdPerThousand;
}

function resolveTokenRates(provider: string, model: string): { prompt: number; completion: number } {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = model.toLowerCase();

  if (normalizedProvider === 'groq') {
    return normalizedModel.includes('70b')
      ? { prompt: 0.0008, completion: 0.0012 }
      : { prompt: 0.0003, completion: 0.0005 };
  }

  if (normalizedProvider === 'openrouter') {
    return normalizedModel.includes('gpt-4')
      ? { prompt: 0.01, completion: 0.03 }
      : normalizedModel.includes('claude')
        ? { prompt: 0.008, completion: 0.024 }
        : { prompt: 0.0015, completion: 0.0035 };
  }

  if (normalizedProvider === 'gemini') {
    return normalizedModel.includes('pro')
      ? { prompt: 0.0035, completion: 0.0105 }
      : { prompt: 0.00035, completion: 0.00105 };
  }

  if (normalizedProvider === 'mistral' || normalizedProvider === 'codestral') {
    return normalizedModel.includes('large')
      ? { prompt: 0.003, completion: 0.009 }
      : { prompt: 0.0004, completion: 0.0012 };
  }

  if (normalizedProvider === 'cohere') {
    return { prompt: 0.0015, completion: 0.003 };
  }

  if (normalizedProvider === 'nvidia' || normalizedProvider === 'cerebras' || normalizedProvider === 'alibaba') {
    return { prompt: 0.0009, completion: 0.0022 };
  }

  if (normalizedProvider === 'puter') {
    return { prompt: 0.0006, completion: 0.0018 };
  }

  return { prompt: 0.001, completion: 0.0025 };
}

export function estimateUsageCostUsd(input: UsageCostInput): number {
  const requestType = input.requestType.toLowerCase();
  const provider = input.provider?.trim() || 'unknown';
  const model = input.model?.trim() || '';
  const promptTokens = Math.max(0, input.promptTokens ?? 0);
  const completionTokens = Math.max(0, input.completionTokens ?? 0);
  const totalTokens = Math.max(0, input.totalTokens ?? promptTokens + completionTokens);
  const audioSeconds = Math.max(0, input.audioSeconds ?? 0);

  if (requestType === 'audio') {
    return Number((audioSeconds * 0.00012).toFixed(6));
  }

  if (requestType === 'images') {
    return Number((0.03).toFixed(6));
  }

  if (requestType === 'embeddings') {
    return Number(perThousand(totalTokens, 0.00015).toFixed(6));
  }

  const rates = resolveTokenRates(provider, model);
  return Number((
    perThousand(promptTokens, rates.prompt)
    + perThousand(completionTokens, rates.completion)
  ).toFixed(6));
}
