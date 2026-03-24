import type { ChatMessage, MessageContentPart } from '../types';

const URL_REGEX = /https?:\/\/[^\s]+/gu;
const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORD_REGEX = /[\p{L}\p{M}_]+(?:['-][\p{L}\p{M}_]+)*/gu;
const NUMBER_REGEX = /\p{N}+(?:[.,:/-]\p{N}+)*/gu;
const SYMBOL_REGEX = /[^\p{L}\p{M}\p{N}\s]/gu;

function countMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function estimateWordTokens(word: string): number {
  const compact = word.replaceAll(/[_-]+/g, '');
  return Math.max(1, Math.ceil(compact.length / 4));
}

function estimateNumberTokens(value: string): number {
  const digitsOnly = value.replaceAll(/[^\p{N}]/gu, '');
  return Math.max(1, Math.ceil(digitsOnly.length / 3));
}

function looksLikeCode(text: string): boolean {
  if (!text) {
    return false;
  }

  const symbolCount = countMatches(text, SYMBOL_REGEX);
  const newlineCount = countMatches(text, /\n/g);
  const density = symbolCount / Math.max(text.length, 1);

  return density > 0.16
    || newlineCount > 4
    || /[{}[\];<>`]/.test(text)
    || /\b(function|const|let|class|return|import|export|SELECT|INSERT|UPDATE)\b/.test(text);
}

export function estimateTextTokens(text: string): number {
  const normalized = String(text ?? '')
    .normalize('NFKC')
    .replaceAll(/\r\n?/g, '\n')
    .trim();

  if (!normalized) {
    return 0;
  }

  let total = 0;

  for (const url of normalized.match(URL_REGEX) ?? []) {
    total += Math.max(1, Math.ceil(url.length / 3));
  }

  for (const word of normalized.match(WORD_REGEX) ?? []) {
    total += estimateWordTokens(word);
  }

  for (const numberValue of normalized.match(NUMBER_REGEX) ?? []) {
    total += estimateNumberTokens(numberValue);
  }

  const cjkCount = countMatches(normalized, CJK_REGEX);
  total += cjkCount;

  const symbolCount = countMatches(normalized, SYMBOL_REGEX);
  total += Math.ceil(symbolCount / (looksLikeCode(normalized) ? 2 : 4));

  const newlineCount = countMatches(normalized, /\n/g);
  total += Math.min(12, newlineCount);

  if (looksLikeCode(normalized)) {
    total += Math.max(2, Math.ceil(normalized.length / 80));
  }

  return Math.max(1, total);
}

export function estimateMessagePartTokens(part: MessageContentPart): number {
  if (part.type === 'text') {
    return estimateTextTokens(part.text);
  }

  return 85;
}

export function estimateMessageTokens(message: ChatMessage): number {
  const baseTokens = 6;
  if (typeof message.content === 'string') {
    return baseTokens + estimateTextTokens(message.content);
  }

  if (Array.isArray(message.content)) {
    return baseTokens + message.content.reduce((total, part) => total + estimateMessagePartTokens(part), 0);
  }

  return baseTokens;
}
