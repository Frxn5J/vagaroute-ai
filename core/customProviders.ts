import { decryptSecret, encryptSecret } from '../utils/crypto';
import { db } from './db';

db.exec(`
  CREATE TABLE IF NOT EXISTS custom_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
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

export interface CustomModelConfig {
  id: string;
  supportsTools: boolean;
  supportsVision: boolean;
}

interface CustomProviderRow {
  id: string;
  name: string;
  slug: string;
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
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseUrl: row.base_url,
    hasApiKey: row.api_key_encrypted !== null,
    models: JSON.parse(row.models) as CustomModelConfig[],
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    id, name, slug, base_url,
    api_key_encrypted, api_key_iv, api_key_tag,
    models, is_active, created_at, updated_at
  ) VALUES (
    $id, $name, $slug, $baseUrl,
    $apiKeyEncrypted, $apiKeyIv, $apiKeyTag,
    $models, 1, $now, $now
  )
`);

const updateProvider = db.prepare(`
  UPDATE custom_providers SET
    name = COALESCE($name, name),
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
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<CustomModelConfig[]> {
  const provider = input.providerId
    ? (selectById.get({ $id: input.providerId }) as CustomProviderRow | null)
    : null;

  const baseUrl = (input.baseUrl ?? provider?.base_url ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Base URL es obligatoria para descubrir modelos');
  }

  const apiKey = input.apiKey?.trim() || (provider ? getDecryptedCustomProviderKey(provider.id) : null);
  const headers = new Headers({ Accept: 'application/json' });
  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }

  const response = await fetch(`${baseUrl}/models`, {
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
      id,
      supportsTools: false,
      supportsVision: false,
    }));

  if (models.length === 0) {
    throw new Error('El endpoint /models no devolvio modelos utilizables');
  }

  return models;
}

export function createCustomProvider(input: {
  id: string;
  name: string;
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
    $baseUrl: input.baseUrl.trim(),
    $apiKeyEncrypted: apiKeyEncrypted,
    $apiKeyIv: apiKeyIv,
    $apiKeyTag: apiKeyTag,
    $models: JSON.stringify(input.models),
    $now: now,
  });

  return toRecord(selectById.get({ $id: input.id }) as CustomProviderRow);
}

export function updateCustomProvider(
  id: string,
  input: {
    name?: string;
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
    $baseUrl: input.baseUrl?.trim() ?? null,
    $apiKeyEncrypted: apiKeyEncrypted,
    $apiKeyIv: apiKeyIv,
    $apiKeyTag: apiKeyTag,
    $clearApiKey: clearApiKey,
    $models: input.models !== undefined ? JSON.stringify(input.models) : null,
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
