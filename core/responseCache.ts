import { createHash } from 'node:crypto';
import { appConfig } from './config';
import { db } from './db';

interface CachedResponseRow {
  cache_key: string;
  scope_key: string;
  request_type: string;
  provider: string | null;
  model: string | null;
  response_json: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  status_code: number;
  created_at: number;
  expires_at: number;
  hit_count: number;
  last_hit_at: number | null;
}

export interface CachedResponseEntry {
  cacheKey: string;
  scopeKey: string;
  requestType: string;
  provider: string | null;
  model: string | null;
  response: unknown;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  statusCode: number;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  lastHitAt: number | null;
}

export interface ResponseCacheStats {
  enabled: boolean;
  backend: string;
  ttlSeconds: number;
  entries: number;
  hits: number;
  misses: number;
  stores: number;
  hitRate: number;
}

const memoryCache = new Map<string, CachedResponseEntry>();

db.exec(`
  CREATE TABLE IF NOT EXISTS response_cache_entries (
    cache_key TEXT PRIMARY KEY,
    scope_key TEXT NOT NULL,
    request_type TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    response_json TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    last_hit_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS response_cache_stats (
    stat_key TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_response_cache_entries_expires_at
    ON response_cache_entries(expires_at);
`);

const selectCacheEntry = db.prepare(`
  SELECT *
  FROM response_cache_entries
  WHERE cache_key = $cacheKey
`);

const upsertCacheEntry = db.prepare(`
  INSERT INTO response_cache_entries (
    cache_key,
    scope_key,
    request_type,
    provider,
    model,
    response_json,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    status_code,
    created_at,
    expires_at,
    hit_count,
    last_hit_at
  )
  VALUES (
    $cacheKey,
    $scopeKey,
    $requestType,
    $provider,
    $model,
    $responseJson,
    $promptTokens,
    $completionTokens,
    $totalTokens,
    $statusCode,
    $createdAt,
    $expiresAt,
    $hitCount,
    $lastHitAt
  )
  ON CONFLICT(cache_key) DO UPDATE SET
    scope_key = excluded.scope_key,
    request_type = excluded.request_type,
    provider = excluded.provider,
    model = excluded.model,
    response_json = excluded.response_json,
    prompt_tokens = excluded.prompt_tokens,
    completion_tokens = excluded.completion_tokens,
    total_tokens = excluded.total_tokens,
    status_code = excluded.status_code,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at,
    hit_count = excluded.hit_count,
    last_hit_at = excluded.last_hit_at
`);

const touchCacheHit = db.prepare(`
  UPDATE response_cache_entries
  SET
    hit_count = hit_count + 1,
    last_hit_at = $now
  WHERE cache_key = $cacheKey
`);

const deleteExpiredCacheEntries = db.prepare(`
  DELETE FROM response_cache_entries
  WHERE expires_at <= $now
`);

const upsertCacheStat = db.prepare(`
  INSERT INTO response_cache_stats (stat_key, value, updated_at)
  VALUES ($statKey, 1, $updatedAt)
  ON CONFLICT(stat_key) DO UPDATE SET
    value = value + 1,
    updated_at = excluded.updated_at
`);

function toCachedResponseEntry(row: CachedResponseRow): CachedResponseEntry {
  return {
    cacheKey: row.cache_key,
    scopeKey: row.scope_key,
    requestType: row.request_type,
    provider: row.provider,
    model: row.model,
    response: JSON.parse(row.response_json),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    statusCode: row.status_code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    hitCount: row.hit_count,
    lastHitAt: row.last_hit_at,
  };
}

function incrementStat(statKey: 'hits' | 'misses' | 'stores'): void {
  upsertCacheStat.run({
    $statKey: statKey,
    $updatedAt: Date.now(),
  });
}

function purgeExpiredEntries(now: number = Date.now()): void {
  deleteExpiredCacheEntries.run({ $now: now });
  for (const [cacheKey, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(cacheKey);
    }
  }
}

function cacheInMemory(entry: CachedResponseEntry): void {
  if (appConfig.responseCacheBackend === 'sqlite') {
    return;
  }
  memoryCache.set(entry.cacheKey, entry);
}

export function buildCacheScopeKey(input: {
  userId?: string | null;
  apiKeyId?: string | null;
  projectId?: string | null;
}): string {
  return [
    input.projectId?.trim() || 'global',
    input.userId?.trim() || 'anon',
    input.apiKeyId?.trim() || 'session',
  ].join(':');
}

export function buildChatCacheKey(input: {
  scopeKey: string;
  model: string;
  body: unknown;
}): string {
  const normalized = JSON.stringify({
    scopeKey: input.scopeKey,
    model: input.model,
    body: input.body,
  });
  return createHash('sha256').update(normalized).digest('hex');
}

export function getCachedResponse(cacheKey: string): CachedResponseEntry | null {
  if (!appConfig.responseCacheEnabled) {
    return null;
  }

  const now = Date.now();
  const memoryEntry = memoryCache.get(cacheKey);
  if (memoryEntry && memoryEntry.expiresAt > now) {
    touchCacheHit.run({ $cacheKey: cacheKey, $now: now });
    incrementStat('hits');
    const updated = {
      ...memoryEntry,
      hitCount: memoryEntry.hitCount + 1,
      lastHitAt: now,
    };
    memoryCache.set(cacheKey, updated);
    return updated;
  }

  if (memoryEntry) {
    memoryCache.delete(cacheKey);
  }

  const row = selectCacheEntry.get({ $cacheKey: cacheKey }) as CachedResponseRow | null;
  if (!row || row.expires_at <= now) {
    incrementStat('misses');
    if (now % 25 === 0) {
      purgeExpiredEntries(now);
    }
    return null;
  }

  touchCacheHit.run({ $cacheKey: cacheKey, $now: now });
  incrementStat('hits');
  const entry = toCachedResponseEntry({
    ...row,
    hit_count: row.hit_count + 1,
    last_hit_at: now,
  });
  cacheInMemory(entry);
  return entry;
}

export function setCachedResponse(input: {
  cacheKey: string;
  scopeKey: string;
  requestType: string;
  provider?: string | null;
  model?: string | null;
  response: unknown;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  statusCode: number;
  ttlSeconds?: number;
}): CachedResponseEntry {
  const now = Date.now();
  const ttlMs = Math.max(1, input.ttlSeconds ?? appConfig.responseCacheTtlSeconds) * 1000;
  const entry: CachedResponseEntry = {
    cacheKey: input.cacheKey,
    scopeKey: input.scopeKey,
    requestType: input.requestType,
    provider: input.provider ?? null,
    model: input.model ?? null,
    response: input.response,
    promptTokens: input.promptTokens ?? 0,
    completionTokens: input.completionTokens ?? 0,
    totalTokens: input.totalTokens ?? 0,
    statusCode: input.statusCode,
    createdAt: now,
    expiresAt: now + ttlMs,
    hitCount: 0,
    lastHitAt: null,
  };

  upsertCacheEntry.run({
    $cacheKey: entry.cacheKey,
    $scopeKey: entry.scopeKey,
    $requestType: entry.requestType,
    $provider: entry.provider,
    $model: entry.model,
    $responseJson: JSON.stringify(entry.response),
    $promptTokens: entry.promptTokens,
    $completionTokens: entry.completionTokens,
    $totalTokens: entry.totalTokens,
    $statusCode: entry.statusCode,
    $createdAt: entry.createdAt,
    $expiresAt: entry.expiresAt,
    $hitCount: entry.hitCount,
    $lastHitAt: entry.lastHitAt,
  });
  cacheInMemory(entry);
  incrementStat('stores');

  if (now % 25 === 0) {
    purgeExpiredEntries(now);
  }

  return entry;
}

export function getResponseCacheStats(): ResponseCacheStats {
  purgeExpiredEntries();

  const statRows = db.query(`
    SELECT stat_key, value
    FROM response_cache_stats
  `).all() as Array<{ stat_key: string; value: number }>;

  const stats = new Map(statRows.map((row) => [row.stat_key, row.value]));
  const row = db.query(`
    SELECT COUNT(*) AS entries
    FROM response_cache_entries
    WHERE expires_at > $now
  `).get({ $now: Date.now() }) as { entries: number } | null;

  const hits = stats.get('hits') ?? 0;
  const misses = stats.get('misses') ?? 0;
  const stores = stats.get('stores') ?? 0;
  const totalLookups = hits + misses;

  return {
    enabled: appConfig.responseCacheEnabled,
    backend: appConfig.responseCacheBackend,
    ttlSeconds: appConfig.responseCacheTtlSeconds,
    entries: row?.entries ?? 0,
    hits,
    misses,
    stores,
    hitRate: totalLookups > 0 ? Number(((hits / totalLookups) * 100).toFixed(2)) : 0,
  };
}
