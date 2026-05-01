import { decryptSecret, encryptSecret } from '../utils/crypto';
import { db } from './db';

db.exec(`
  CREATE TABLE IF NOT EXISTS custom_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    protocol TEXT NOT NULL DEFAULT 'openai',
    base_url TEXT NOT NULL,
    api_key_encrypted TEXT,
    api_key_iv TEXT,
    api_key_tag TEXT,
    models TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_custom_providers_is_active
    ON custom_providers(is_active);
`);

const customProvidersColumns = new Set(
  (db.query('PRAGMA table_info(custom_providers)').all() as Array<{ name: string }>).map((row) => row.name),
);
if (!customProvidersColumns.has('protocol')) {
  db.exec("ALTER TABLE custom_providers ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai';");
}

export type CustomProviderProtocol = 'openai' | 'gemini' | 'anthropic';

function normalizeCustomProviderProtocol(value: unknown): CustomProviderProtocol {
  const normalized = String(value ?? 'openai').trim().toLowerCase();
  if (normalized === 'gemini' || normalized === 'anthropic') {
    return normalized;
  }
  return 'openai';
}

function applyDiscoveryAuthHeaders(headers: Headers, protocol: CustomProviderProtocol, apiKey: string | null): void {
  if (!apiKey) {
    if (protocol === 'anthropic') {
      headers.set('anthropic-version', '2023-06-01');
    }
    return;
  }

  if (protocol === 'openai') {
    headers.set('Authorization', `Bearer ${apiKey}`);
    return;
  }

  if (protocol === 'gemini') {
    headers.set('Authorization', `Bearer ${apiKey}`);
    headers.set('x-goog-api-key', apiKey);
    return;
  }

  headers.set('anthropic-version', '2023-06-01');
  headers.set('x-api-key', apiKey);
}

function normalizeModelIdForProtocol(protocol: CustomProviderProtocol, modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (protocol === 'gemini') {
    return trimmed.replace(/^models\//i, '');
  }

  return trimmed;
}

export interface CustomModelConfig {
  id: string;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsImageGeneration: boolean;
  supportsVideoGeneration: boolean;
  emulateTools: boolean;
}

export type CustomMediaCategory = 'images' | 'videos';

export interface CustomProviderMediaTarget {
  providerId: string;
  providerSlug: string;
  providerName: string;
  protocol: CustomProviderProtocol;
  baseUrl: string;
  apiKey: string | null;
  modelId: string;
  serviceName: string;
  category: CustomMediaCategory;
}

interface CustomProviderRow {
  id: string;
  name: string;
  slug: string;
  protocol: string;
  base_url: string;
  api_key_encrypted: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  models: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface CustomProviderRecord {
  id: string;
  name: string;
  slug: string;
  protocol: CustomProviderProtocol;
  baseUrl: string;
  hasApiKey: boolean;
  models: CustomModelConfig[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

function getModelId(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { id?: unknown; name?: unknown; model?: unknown };
  for (const item of [candidate.id, candidate.name, candidate.model]) {
    if (typeof item === 'string' && item.trim()) {
      return item.trim();
    }
  }

  return null;
}

function getModelItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as { data?: unknown; models?: unknown };
  if (Array.isArray(record.data)) {
    return record.data;
  }
  if (Array.isArray(record.models)) {
    return record.models;
  }

  return [];
}

function getDiscoveryErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as {
      error?: { message?: unknown } | unknown;
      message?: unknown;
    };

    if (record.error && typeof record.error === 'object' && typeof (record.error as { message?: unknown }).message === 'string') {
      return (record.error as { message: string }).message;
    }

    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim().slice(0, 240);
  }

  return `El proveedor respondio HTTP ${status} al consultar /models`;
}

function toRecord(row: CustomProviderRow): CustomProviderRecord {
  const protocol = normalizeCustomProviderProtocol(row.protocol);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    protocol,
    baseUrl: row.base_url,
    hasApiKey: row.api_key_encrypted !== null,
    models: normalizeCustomModelConfigs(JSON.parse(row.models) as unknown).map((model) => ({
      ...model,
      id: normalizeModelIdForProtocol(protocol, model.id),
    })),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCustomModelConfig(input: unknown): CustomModelConfig | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) {
    return null;
  }

  return {
    id,
    supportsTools: record.supportsTools === true,
    supportsVision: record.supportsVision === true,
    supportsImageGeneration: record.supportsImageGeneration === true,
    supportsVideoGeneration: record.supportsVideoGeneration === true,
    emulateTools: record.emulateTools === true,
  };
}

export function normalizeCustomModelConfigs(input: unknown): CustomModelConfig[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map(normalizeCustomModelConfig)
    .filter((model): model is CustomModelConfig => Boolean(model));
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const selectAll = db.prepare(`SELECT * FROM custom_providers ORDER BY created_at ASC`);
const selectActive = db.prepare(`SELECT * FROM custom_providers WHERE is_active = 1 ORDER BY created_at ASC`);
const selectById = db.prepare(`SELECT * FROM custom_providers WHERE id = $id`);
const selectBySlug = db.prepare(`SELECT * FROM custom_providers WHERE slug = $slug`);

const insertProvider = db.prepare(`
  INSERT INTO custom_providers (
    id, name, slug, protocol, base_url,
    api_key_encrypted, api_key_iv, api_key_tag,
    models, is_active, created_at, updated_at
  ) VALUES (
    $id, $name, $slug, $protocol, $baseUrl,
    $apiKeyEncrypted, $apiKeyIv, $apiKeyTag,
    $models, 1, $now, $now
  )
`);

const updateProvider = db.prepare(`
  UPDATE custom_providers SET
    name = COALESCE($name, name),
    protocol = COALESCE($protocol, protocol),
    base_url = COALESCE($baseUrl, base_url),
    models = COALESCE($models, models),
    is_active = COALESCE($isActive, is_active),
    api_key_encrypted = CASE WHEN $clearApiKey = 1 THEN NULL ELSE COALESCE($apiKeyEncrypted, api_key_encrypted) END,
    api_key_iv = CASE WHEN $clearApiKey = 1 THEN NULL ELSE COALESCE($apiKeyIv, api_key_iv) END,
    api_key_tag = CASE WHEN $clearApiKey = 1 THEN NULL ELSE COALESCE($apiKeyTag, api_key_tag) END,
    updated_at = $now
  WHERE id = $id
`);

const deleteProvider = db.prepare(`DELETE FROM custom_providers WHERE id = $id`);

export function listCustomProviders(): CustomProviderRecord[] {
  return (selectAll.all() as CustomProviderRow[]).map(toRecord);
}

export function listActiveCustomProviders(): CustomProviderRecord[] {
  return (selectActive.all() as CustomProviderRow[]).map(toRecord);
}

export function getCustomProviderById(id: string): CustomProviderRecord | null {
  const row = selectById.get({ $id: id }) as CustomProviderRow | null;
  return row ? toRecord(row) : null;
}

export function getDecryptedCustomProviderKey(id: string): string | null {
  const row = selectById.get({ $id: id }) as CustomProviderRow | null;
  if (!row?.api_key_encrypted || !row.api_key_iv || !row.api_key_tag) {
    return null;
  }
  return decryptSecret({
    ciphertext: row.api_key_encrypted,
    iv: row.api_key_iv,
    tag: row.api_key_tag,
  });
}

export async function discoverCustomProviderModels(input: {
  providerId?: string | null;
  protocol?: CustomProviderProtocol | null;
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<CustomModelConfig[]> {
  const provider = input.providerId
    ? (selectById.get({ $id: input.providerId }) as CustomProviderRow | null)
    : null;

  const baseUrl = (input.baseUrl ?? provider?.base_url ?? '').trim().replace(/\/+$/, '');
  const protocol = normalizeCustomProviderProtocol(input.protocol ?? provider?.protocol ?? 'openai');
  if (!baseUrl) {
    throw new Error('Base URL es obligatoria para descubrir modelos');
  }

  const apiKey = input.apiKey?.trim() || (provider ? getDecryptedCustomProviderKey(provider.id) : null);
  const headers = new Headers({ Accept: 'application/json' });
  let modelsUrl = `${baseUrl}/models`;
  applyDiscoveryAuthHeaders(headers, protocol, apiKey);

  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(getDiscoveryErrorMessage(response.status, payload));
  }

  const unique = new Set<string>();
  const models = getModelItems(payload)
    .map(getModelId)
    .filter((id): id is string => Boolean(id))
    .filter((id) => {
      if (unique.has(id)) {
        return false;
      }
      unique.add(id);
      return true;
    })
    .map((id) => ({
      id: normalizeModelIdForProtocol(protocol, id),
      supportsTools: false,
      supportsVision: false,
      supportsImageGeneration: false,
      supportsVideoGeneration: false,
      emulateTools: false,
    }));

  if (models.length === 0) {
    throw new Error('El endpoint /models no devolvio modelos utilizables');
  }

  return models;
}

export function createCustomProvider(input: {
  id: string;
  name: string;
  protocol?: CustomProviderProtocol;
  baseUrl: string;
  apiKey?: string | null;
  models: CustomModelConfig[];
}): CustomProviderRecord {
  const slug = slugify(input.name);
  if (!slug) {
    throw new Error('El nombre del proveedor no es válido');
  }

  const existing = selectBySlug.get({ $slug: slug }) as CustomProviderRow | null;
  if (existing) {
    throw new Error(`Ya existe un proveedor con el nombre "${input.name}"`);
  }

  let apiKeyEncrypted: string | null = null;
  let apiKeyIv: string | null = null;
  let apiKeyTag: string | null = null;

  if (input.apiKey?.trim()) {
    const encrypted = encryptSecret(input.apiKey.trim());
    apiKeyEncrypted = encrypted.ciphertext;
    apiKeyIv = encrypted.iv;
    apiKeyTag = encrypted.tag;
  }

  const now = Date.now();
  insertProvider.run({
    $id: input.id,
    $name: input.name.trim(),
    $slug: slug,
    $protocol: normalizeCustomProviderProtocol(input.protocol),
    $baseUrl: input.baseUrl.trim(),
    $apiKeyEncrypted: apiKeyEncrypted,
    $apiKeyIv: apiKeyIv,
    $apiKeyTag: apiKeyTag,
    $models: JSON.stringify(input.models.map((model) => ({
      ...model,
      id: normalizeModelIdForProtocol(normalizeCustomProviderProtocol(input.protocol), model.id),
    }))),
    $now: now,
  });

  return toRecord(selectById.get({ $id: input.id }) as CustomProviderRow);
}

export function updateCustomProvider(
  id: string,
  input: {
    name?: string;
    protocol?: CustomProviderProtocol;
    baseUrl?: string;
    apiKey?: string | null;
    models?: CustomModelConfig[];
    isActive?: boolean;
  },
): CustomProviderRecord {
  let apiKeyEncrypted: string | null = null;
  let apiKeyIv: string | null = null;
  let apiKeyTag: string | null = null;
  const clearApiKey = input.apiKey === null ? 1 : 0;

  if (input.apiKey?.trim()) {
    const encrypted = encryptSecret(input.apiKey.trim());
    apiKeyEncrypted = encrypted.ciphertext;
    apiKeyIv = encrypted.iv;
    apiKeyTag = encrypted.tag;
  }

  updateProvider.run({
    $id: id,
    $name: input.name?.trim() ?? null,
    $protocol: input.protocol ? normalizeCustomProviderProtocol(input.protocol) : null,
    $baseUrl: input.baseUrl?.trim() ?? null,
    $apiKeyEncrypted: apiKeyEncrypted,
    $apiKeyIv: apiKeyIv,
    $apiKeyTag: apiKeyTag,
    $clearApiKey: clearApiKey,
    $models: input.models !== undefined
      ? JSON.stringify(input.models.map((model) => ({
          ...model,
          id: normalizeModelIdForProtocol(
            normalizeCustomProviderProtocol(input.protocol ?? getCustomProviderById(id)?.protocol ?? 'openai'),
            model.id,
          ),
        })))
      : null,
    $isActive: input.isActive !== undefined ? (input.isActive ? 1 : 0) : null,
    $now: Date.now(),
  });

  const updated = selectById.get({ $id: id }) as CustomProviderRow | null;
  if (!updated) {
    throw new Error(`Proveedor '${id}' no encontrado`);
  }
  return toRecord(updated);
}

export function deleteCustomProvider(id: string): boolean {
  const result = deleteProvider.run({ $id: id });
  return result.changes > 0;
}

export function getCustomProviderMediaTargets(category: CustomMediaCategory): string[] {
  const targets = new Set<string>();

  for (const provider of listActiveCustomProviders()) {
    for (const model of provider.models) {
      const enabled = category === 'images' ? model.supportsImageGeneration : model.supportsVideoGeneration;
      if (!enabled) {
        continue;
      }
      targets.add(`${provider.slug}/${model.id}`);
    }
  }

  return Array.from(targets).sort((left, right) => left.localeCompare(right));
}

export function resolveCustomProviderMediaTarget(
  target: string,
  category: CustomMediaCategory,
): CustomProviderMediaTarget | null {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    return null;
  }

  for (const provider of listActiveCustomProviders()) {
    for (const model of provider.models) {
      const enabled = category === 'images' ? model.supportsImageGeneration : model.supportsVideoGeneration;
      if (!enabled) {
        continue;
      }

      const serviceName = `${provider.slug}/${model.id}`;
      if (serviceName !== normalizedTarget) {
        continue;
      }

      return {
        providerId: provider.id,
        providerSlug: provider.slug,
        providerName: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        apiKey: getDecryptedCustomProviderKey(provider.id),
        modelId: model.id,
        serviceName,
        category,
      };
    }
  }

  return null;
}
