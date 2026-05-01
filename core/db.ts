import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import type { RateLimitMode, UsageWindowSnapshot } from './usageLimits';
import { decryptSecret } from '../utils/crypto';
import { emptyUsageSnapshot, normalizeProviderId, normalizeServiceId } from './usageLimits';
import { appConfig } from './config';

mkdirSync(path.dirname(appConfig.dbPath), { recursive: true });

export const db = new Database(appConfig.dbPath, { create: true });

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function getTableColumns(tableName: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = getTableColumns(tableName);
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition};`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS model_stats (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    rate_limited_until INTEGER NOT NULL DEFAULT 0,
    requests_served INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS provider_stats (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    cooldown_until INTEGER NOT NULL DEFAULT 0,
    last_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS rate_limit_rules (
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    provider TEXT,
    mode TEXT NOT NULL DEFAULT 'none',
    rpm INTEGER,
    rpd INTEGER,
    tpm INTEGER,
    tpd INTEGER,
    ash INTEGER,
    asd INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope_type, scope_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    last_seen_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    model_access_mode TEXT NOT NULL DEFAULT 'all' CHECK(model_access_mode IN ('all', 'selected', 'none')),
    request_quota_monthly INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_allowed_models (
    project_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, model_id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, user_id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    rate_limit_per_minute INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    total_requests INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS service_api_keys (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_hint TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    value_iv TEXT NOT NULL,
    value_tag TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    cooldown_until INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    total_requests INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_metrics (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    api_key_id TEXT,
    project_id TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    request_type TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    error_message TEXT,
    source_ip TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(api_key_id) REFERENCES user_api_keys(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS invitation_tokens (
    id TEXT PRIMARY KEY,
    email TEXT,
    project_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('member', 'owner')),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    created_by_user_id TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    used_at INTEGER,
    requested_by_user_id TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS request_rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_id ON user_api_keys(user_id);
  CREATE INDEX IF NOT EXISTS idx_service_api_keys_provider ON service_api_keys(provider, is_active, cooldown_until, priority);
  CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_provider ON rate_limit_rules(provider, scope_type);
  CREATE INDEX IF NOT EXISTS idx_provider_stats_cooldown ON provider_stats(cooldown_until);
  CREATE INDEX IF NOT EXISTS idx_request_metrics_created_at ON request_metrics(created_at);
  CREATE INDEX IF NOT EXISTS idx_request_metrics_provider_model ON request_metrics(provider, model);
  CREATE INDEX IF NOT EXISTS idx_request_metrics_user_id ON request_metrics(user_id);
  CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_invitation_tokens_project_id ON invitation_tokens(project_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_request_rate_limit_buckets_reset_at ON request_rate_limit_buckets(reset_at);
`);

ensureColumn('request_metrics', 'prompt_tokens', 'prompt_tokens INTEGER NOT NULL DEFAULT 0');
ensureColumn('request_metrics', 'completion_tokens', 'completion_tokens INTEGER NOT NULL DEFAULT 0');
ensureColumn('request_metrics', 'total_tokens', 'total_tokens INTEGER NOT NULL DEFAULT 0');
ensureColumn('request_metrics', 'audio_seconds', 'audio_seconds INTEGER NOT NULL DEFAULT 0');
ensureColumn('request_metrics', 'usage_source', "usage_source TEXT NOT NULL DEFAULT 'estimated'");
ensureColumn('projects', 'model_access_mode', "model_access_mode TEXT NOT NULL DEFAULT 'all'");
ensureColumn('users', 'monthly_request_quota', 'monthly_request_quota INTEGER');
ensureColumn('users', 'onboarding_completed_at', 'onboarding_completed_at INTEGER');
ensureColumn('user_api_keys', 'project_id', 'project_id TEXT');
ensureColumn('request_metrics', 'project_id', 'project_id TEXT');
ensureColumn('request_metrics', 'error_message', 'error_message TEXT');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_project_allowed_models_project_id ON project_allowed_models(project_id);
  CREATE INDEX IF NOT EXISTS idx_user_api_keys_project_id ON user_api_keys(project_id);
  CREATE INDEX IF NOT EXISTS idx_request_metrics_project_id ON request_metrics(project_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS model_tier_overrides (
    model_id TEXT PRIMARY KEY,
    tier INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
    updated_at INTEGER NOT NULL
  );
`);

const getRequestRateLimitBucket = db.prepare(`
  SELECT count, reset_at
  FROM request_rate_limit_buckets
  WHERE bucket_key = $bucketKey
`);

const upsertRequestRateLimitBucket = db.prepare(`
  INSERT INTO request_rate_limit_buckets (bucket_key, count, reset_at, updated_at)
  VALUES ($bucketKey, $count, $resetAt, $updatedAt)
  ON CONFLICT(bucket_key) DO UPDATE SET
    count = excluded.count,
    reset_at = excluded.reset_at,
    updated_at = excluded.updated_at
`);

const deleteExpiredRequestRateLimitBuckets = db.prepare(`
  DELETE FROM request_rate_limit_buckets
  WHERE reset_at <= $now
`);

// Deterministic call counter for probabilistic cleanup.
// Date.now() % N === 0 only fires ~1/N of the time by CHANCE —
// this counter ensures exactly 1-in-25 calls triggers cleanup.
let _rateLimitCallCount = 0;

export type UserRole = 'admin' | 'user';
export type ProjectModelAccessMode = 'all' | 'selected' | 'none';

export interface AppSettings {
  appName: string;
  sessionTimeoutMinutes: number;
  defaultApiKeyRateLimit: number;
  anonymousRateLimitPerMinute: number;
  allowedOrigins: string;
  defaultChatModel: string;
  enableUserKeyCreation: boolean;
  openRouterFreeOnly: boolean;
}

interface AppSettingRow {
  key: string;
  value: string;
  updated_at: number;
}

interface ProviderStatRow {
  id: string;
  status: string;
  cooldown_until: number;
  last_reason: string | null;
}

interface RateLimitRuleRow {
  scope_type: RateLimitScopeType;
  scope_id: string;
  provider: string | null;
  mode: RateLimitMode;
  rpm: number | null;
  rpd: number | null;
  tpm: number | null;
  tpd: number | null;
  ash: number | null;
  asd: number | null;
  created_at: number;
  updated_at: number;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  monthly_request_quota: number | null;
  onboarding_completed_at: number | null;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
  last_seen_at: number | null;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  monthlyRequestQuota: number | null;
  onboardingCompletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  lastSeenAt: number | null;
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  model_access_mode: ProjectModelAccessMode;
  request_quota_monthly: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  modelAccessMode: ProjectModelAccessMode;
  allowedModelIds: string[];
  requestQuotaMonthly: number | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  role?: 'owner' | 'member';
}

interface InvitationTokenRow {
  id: string;
  email: string | null;
  project_id: string | null;
  role: 'owner' | 'member';
  token_hash: string;
  expires_at: number;
  created_at: number;
  accepted_at: number | null;
  created_by_user_id: string | null;
  project_name?: string | null;
}

export interface InvitationTokenRecord {
  id: string;
  email: string | null;
  projectId: string | null;
  projectName?: string | null;
  role: 'owner' | 'member';
  expiresAt: number;
  createdAt: number;
  acceptedAt: number | null;
  createdByUserId: string | null;
}

interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
  used_at: number | null;
  requested_by_user_id: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  ip: string | null;
  userAgent: string | null;
}

interface SessionLookupRow {
  session_id: string;
  token_hash: string;
  session_created_at: number;
  expires_at: number;
  session_last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: number;
  monthly_request_quota: number | null;
  onboarding_completed_at: number | null;
  user_created_at: number;
  user_updated_at: number;
  last_login_at: number | null;
  user_last_seen_at: number | null;
}

export interface SessionWithUser {
  session: SessionRecord;
  user: UserRecord;
}

interface UserApiKeyRow {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  key_hash: string;
  key_prefix: string;
  rate_limit_per_minute: number;
  is_active: number;
  created_at: number;
  last_used_at: number | null;
  total_requests: number;
  user_email?: string;
  user_name?: string;
  user_role?: UserRole;
}

export interface UserApiKeyRecord {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  keyPrefix: string;
  rateLimitPerMinute: number;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
  totalRequests: number;
  userEmail?: string;
  userName?: string;
  userRole?: UserRole;
}

interface UserApiKeyLookupRow extends UserApiKeyRow {
  email: string;
  name_display: string;
  role: UserRole;
  user_is_active: number;
  monthly_request_quota: number | null;
  onboarding_completed_at: number | null;
  user_created_at: number;
  user_updated_at: number;
  user_last_login_at: number | null;
  user_last_seen_at: number | null;
}

export interface ApiKeyAuthRecord {
  apiKey: UserApiKeyRecord;
  user: UserRecord;
}

interface ServiceApiKeyRow {
  id: string;
  provider: string;
  name: string;
  key_hash: string;
  key_hint: string;
  encrypted_value: string;
  value_iv: string;
  value_tag: string;
  priority: number;
  is_active: number;
  cooldown_until: number;
  fail_count: number;
  total_requests: number;
  last_used_at: number | null;
  last_error: string | null;
  created_at: number;
}

export interface ServiceApiKeyRecord {
  id: string;
  provider: string;
  name: string;
  keyHint: string;
  priority: number;
  isActive: boolean;
  cooldownUntil: number;
  failCount: number;
  totalRequests: number;
  lastUsedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface ServiceApiKeyCandidate extends ServiceApiKeyRecord {
  value: string;
}

export type RateLimitScopeType = 'provider' | 'model';

export interface ProviderStatRecord {
  id: string;
  status: string;
  cooldownUntil: number;
  lastReason: string | null;
}

export interface RateLimitRuleRecord {
  scopeType: RateLimitScopeType;
  scopeId: string;
  provider: string | null;
  mode: RateLimitMode;
  rpm: number | null;
  rpd: number | null;
  tpm: number | null;
  tpd: number | null;
  ash: number | null;
  asd: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RequestMetricInput {
  id: string;
  userId?: string | null;
  apiKeyId?: string | null;
  projectId?: string | null;
  method: string;
  path: string;
  requestType: string;
  provider?: string | null;
  model?: string | null;
  statusCode: number;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  audioSeconds?: number;
  errorMessage?: string | null;
  sourceIp?: string | null;
  createdAt?: number;
  /** Whether token counts came from the provider response or were locally estimated. */
  usageSource?: 'provider' | 'estimated';
}

export interface RequestRateLimitResult {
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RequestMetricsScope {
  userId?: string | null;
  visibleProjectIds?: string[] | null;
}

export interface ProviderMetric {
  provider: string;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  lastRequestAt: number | null;
}

export interface ModelMetric {
  provider: string;
  model: string;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  lastRequestAt: number | null;
}

export interface RecentMetric {
  method: string;
  path: string;
  requestType: string;
  provider: string | null;
  model: string | null;
  statusCode: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  errorMessage: string | null;
  createdAt: number;
}

export interface UsageSummary {
  id: string;
  name: string;
  email?: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  monthlyRequestQuota: number | null;
  status: 'ok' | 'warning' | 'exceeded';
}

export interface TokenSummary {
  currentMonthTokens: number;
  projectedMonthTokens: number;
  currentMonthPromptTokens: number;
  projectedMonthPromptTokens: number;
  currentMonthCompletionTokens: number;
  projectedMonthCompletionTokens: number;
}

export interface DailyMetric {
  bucket: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
}

export interface RequestTypeMetric {
  requestType: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
}

export interface MetricsSummary {
  requestCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface DashboardMetrics {
  totals: {
    users: number;
    userApiKeys: number;
    serviceApiKeys: number;
    projects: number;
    requests: number;
  };
  providers: ProviderMetric[];
  models: ModelMetric[];
  recent: RecentMetric[];
  daily: DailyMetric[];
  requestTypes: RequestTypeMetric[];
  summary: MetricsSummary;
}

const DEFAULT_APP_SETTINGS = {
  app_name: 'VagaRoute AI',
  session_timeout_minutes: '480',
  default_api_key_rate_limit: '120',
  anonymous_rate_limit_per_minute: '45',
  allowed_origins: '*',
  default_chat_model: 'auto',
  enable_user_key_creation: '1',
  openrouter_free_only: '0',
} as const satisfies Record<string, string>;

const seedDefaultSettings = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES ($key, $value, $updatedAt)
  ON CONFLICT(key) DO NOTHING
`);

db.transaction(() => {
  const updatedAt = Date.now();
  for (const [key, value] of Object.entries(DEFAULT_APP_SETTINGS)) {
    seedDefaultSettings.run({ $key: key, $value: value, $updatedAt: updatedAt });
  }
})();

db.query(`
  UPDATE app_settings
  SET value = $value, updated_at = $updatedAt
  WHERE key = 'app_name' AND value = 'AI Router Control Center'
`).run({
  $value: DEFAULT_APP_SETTINGS.app_name,
  $updatedAt: Date.now(),
});

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active === 1,
    monthlyRequestQuota: row.monthly_request_quota,
    onboardingCompletedAt: row.onboarding_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    lastSeenAt: row.last_seen_at,
  };
}

function normalizeProjectModelAccessMode(value: string | null | undefined): ProjectModelAccessMode {
  return value === 'selected' || value === 'none' ? value : 'all';
}

function normalizeProjectAllowedModelIds(modelIds: string[] | null | undefined): string[] {
  return Array.from(new Set((modelIds ?? [])
    .map((modelId) => modelId.trim())
    .filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function getProjectAllowedModelsMap(projectIds: string[]): Map<string, string[]> {
  const normalizedProjectIds = Array.from(new Set(projectIds.map((projectId) => projectId.trim()).filter(Boolean)));
  const map = new Map<string, string[]>(normalizedProjectIds.map((projectId) => [projectId, []]));
  if (normalizedProjectIds.length === 0) {
    return map;
  }

  const placeholders = normalizedProjectIds.map(() => '?').join(', ');
  const rows = db.query(`
    SELECT project_id, model_id
    FROM project_allowed_models
    WHERE project_id IN (${placeholders})
    ORDER BY model_id ASC
  `).all(...normalizedProjectIds) as Array<{ project_id: string; model_id: string }>;

  for (const row of rows) {
    map.get(row.project_id)?.push(row.model_id);
  }

  return map;
}

function toProjectRecord(
  row: ProjectRow & { role?: 'owner' | 'member' },
  allowedModelIds: string[] = [],
): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    modelAccessMode: normalizeProjectModelAccessMode(row.model_access_mode),
    allowedModelIds: normalizeProjectAllowedModelIds(allowedModelIds),
    requestQuotaMonthly: row.request_quota_monthly,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role,
  };
}

function toInvitationTokenRecord(row: InvitationTokenRow): InvitationTokenRecord {
  return {
    id: row.id,
    email: row.email,
    projectId: row.project_id,
    projectName: row.project_name ?? null,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    createdByUserId: row.created_by_user_id,
  };
}

export function setProjectModelAccess(
  projectId: string,
  mode: ProjectModelAccessMode,
  allowedModelIds?: string[] | null,
): void {
  const normalizedMode = normalizeProjectModelAccessMode(mode);
  const normalizedModelIds = normalizedMode === 'selected'
    ? normalizeProjectAllowedModelIds(allowedModelIds)
    : [];
  const effectiveMode = normalizedMode === 'selected' && normalizedModelIds.length === 0
    ? 'none'
    : normalizedMode;

  db.transaction(() => {
    db.query(`
      UPDATE projects
      SET model_access_mode = $mode, updated_at = $updatedAt
      WHERE id = $projectId
    `).run({
      $projectId: projectId,
      $mode: effectiveMode,
      $updatedAt: Date.now(),
    });

    db.query(`DELETE FROM project_allowed_models WHERE project_id = $projectId`).run({
      $projectId: projectId,
    });

    if (effectiveMode === 'selected') {
      const insertAllowedModel = db.query(`
        INSERT INTO project_allowed_models (project_id, model_id, created_at)
        VALUES ($projectId, $modelId, $createdAt)
      `);
      const createdAt = Date.now();
      for (const modelId of normalizedModelIds) {
        insertAllowedModel.run({
          $projectId: projectId,
          $modelId: modelId,
          $createdAt: createdAt,
        });
      }
    }
  })();
}

export function getProjectModelAccess(projectId: string | null | undefined): {
  mode: ProjectModelAccessMode;
  allowedModelIds: string[];
} {
  const normalizedProjectId = projectId?.trim();
  if (!normalizedProjectId) {
    return { mode: 'all', allowedModelIds: [] };
  }

  const project = getProjectById(normalizedProjectId);
  if (!project) {
    return { mode: 'all', allowedModelIds: [] };
  }

  return {
    mode: project.modelAccessMode,
    allowedModelIds: project.allowedModelIds,
  };
}

function toSessionRecord(row: {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
}): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

function toUserApiKeyRecord(row: UserApiKeyRow): UserApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    rateLimitPerMinute: row.rate_limit_per_minute,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    totalRequests: row.total_requests,
    userEmail: row.user_email,
    userName: row.user_name,
    userRole: row.user_role,
  };
}

function toServiceApiKeyRecord(row: ServiceApiKeyRow): ServiceApiKeyRecord {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    keyHint: row.key_hint,
    priority: row.priority,
    isActive: row.is_active === 1,
    cooldownUntil: row.cooldown_until,
    failCount: row.fail_count,
    totalRequests: row.total_requests,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function toProviderStatRecord(row: ProviderStatRow): ProviderStatRecord {
  return {
    id: row.id,
    status: row.status,
    cooldownUntil: row.cooldown_until,
    lastReason: row.last_reason,
  };
}

function toRateLimitRuleRecord(row: RateLimitRuleRow): RateLimitRuleRecord {
  return {
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    provider: row.provider,
    mode: row.mode,
    rpm: row.rpm,
    rpd: row.rpd,
    tpm: row.tpm,
    tpd: row.tpd,
    ash: row.ash,
    asd: row.asd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getNumericSetting(settings: Record<string, string>, key: string, fallback: number): number {
  const value = Number(settings[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getBooleanSetting(settings: Record<string, string>, key: string, fallback: boolean): boolean {
  const value = settings[key];
  if (value === undefined) {
    return fallback;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'project';
}

function getMonthRange(now: number = Date.now()): { start: number; end: number; daysInMonth: number; dayOfMonth: number } {
  const current = new Date(now);
  const start = new Date(current.getFullYear(), current.getMonth(), 1).getTime();
  const end = new Date(current.getFullYear(), current.getMonth() + 1, 1).getTime();
  const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
  return {
    start,
    end,
    daysInMonth,
    dayOfMonth: current.getDate(),
  };
}

function computeUsageStatus(
  requestCount: number,
  monthlyRequestQuota: number | null,
): 'ok' | 'warning' | 'exceeded' {
  const requestRatio = monthlyRequestQuota && monthlyRequestQuota > 0 ? requestCount / monthlyRequestQuota : 0;
  const ratio = requestRatio;

  if (ratio >= 1) {
    return 'exceeded';
  }
  if (ratio >= 0.8) {
    return 'warning';
  }
  return 'ok';
}

export function syncModelsToDb(models: { id: string; provider: string }[]) {
  const insertOrIgnore = db.prepare(`
    INSERT INTO model_stats (id, provider, status, rate_limited_until, requests_served)
    VALUES ($id, $provider, 'active', 0, 0)
    ON CONFLICT(id) DO NOTHING
  `);

  db.transaction(() => {
    for (const model of models) {
      insertOrIgnore.run({ $id: model.id, $provider: model.provider });
    }
  })();
}

export function syncProvidersToDb(providers: string[]) {
  const insertOrIgnore = db.prepare(`
    INSERT INTO provider_stats (id, status, cooldown_until, last_reason)
    VALUES ($id, 'active', 0, NULL)
    ON CONFLICT(id) DO NOTHING
  `);

  const normalizedProviders = Array.from(new Set(
    providers
      .map((provider) => normalizeProviderId(provider))
      .filter(Boolean),
  ));

  db.transaction(() => {
    for (const provider of normalizedProviders) {
      insertOrIgnore.run({ $id: provider });
    }
  })();
}

export function clearExpiredProviderRateLimits(): void {
  db.query(`
    UPDATE provider_stats
    SET status = 'active', cooldown_until = 0, last_reason = NULL
    WHERE cooldown_until > 0 AND cooldown_until <= $now
  `).run({ $now: Date.now() });
}

export function getAllProviderStats(): ProviderStatRecord[] {
  clearExpiredProviderRateLimits();
  const rows = db.query(`SELECT * FROM provider_stats ORDER BY id ASC`).all() as ProviderStatRow[];
  return rows.map(toProviderStatRecord);
}

export function getProviderCooldownMap(): Map<string, ProviderStatRecord> {
  return new Map(getAllProviderStats().map((item) => [item.id, item]));
}

export function setProviderRateLimited(providerId: string, untilMs: number, reason?: string): void {
  const normalized = normalizeProviderId(providerId);
  db.query(`
    INSERT INTO provider_stats (id, status, cooldown_until, last_reason)
    VALUES ($id, 'cooldown', $cooldownUntil, $reason)
    ON CONFLICT(id) DO UPDATE
    SET status = 'cooldown', cooldown_until = excluded.cooldown_until, last_reason = excluded.last_reason
  `).run({
    $id: normalized,
    $cooldownUntil: untilMs,
    $reason: reason ?? null,
  });
}

export function clearProviderRateLimit(providerId: string): void {
  db.query(`
    UPDATE provider_stats
    SET status = 'active', cooldown_until = 0, last_reason = NULL
    WHERE id = $id
  `).run({ $id: normalizeProviderId(providerId) });
}

export function clearAllProviderRateLimits(): void {
  db.query(`
    UPDATE provider_stats
    SET status = 'active', cooldown_until = 0, last_reason = NULL
  `).run();
}

export function getAllModelStats() {
  return db.query(`SELECT * FROM model_stats`).all() as {
    id: string;
    provider: string;
    status: string;
    rate_limited_until: number;
    requests_served: number;
  }[];
}

export function setModelRateLimited(id: string, untilMs: number) {
  db.query(`
    UPDATE model_stats
    SET status = 'cooldown', rate_limited_until = $until
    WHERE id = $id
  `).run({ $until: untilMs, $id: id });
}

export function clearModelRateLimit(id: string) {
  db.query(`
    UPDATE model_stats
    SET status = 'active', rate_limited_until = 0
    WHERE id = $id
  `).run({ $id: id });
}

export function getAvailableModels() {
  const now = Date.now();
  db.query(`
    UPDATE model_stats
    SET status = 'active', rate_limited_until = 0
    WHERE status = 'cooldown' AND rate_limited_until <= $now
  `).run({ $now: now });

  return db.query(`SELECT * FROM model_stats WHERE status = 'active'`).all() as {
    id: string;
    provider: string;
    status: string;
    rate_limited_until: number;
    requests_served: number;
  }[];
}

export function incrementModelUsage(id: string) {
  db.query(`
    UPDATE model_stats
    SET requests_served = requests_served + 1
    WHERE id = $id
  `).run({ $id: id });
}

export function getAppSettings(): AppSettings {
  const rows = db.query(`SELECT key, value, updated_at FROM app_settings`).all() as AppSettingRow[];
  const settings: Record<string, string> = { ...DEFAULT_APP_SETTINGS };
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  return {
    appName: settings.app_name ?? DEFAULT_APP_SETTINGS.app_name,
    sessionTimeoutMinutes: getNumericSetting(settings, 'session_timeout_minutes', 480),
    defaultApiKeyRateLimit: getNumericSetting(settings, 'default_api_key_rate_limit', 120),
    anonymousRateLimitPerMinute: getNumericSetting(settings, 'anonymous_rate_limit_per_minute', 45),
    allowedOrigins: settings.allowed_origins ?? DEFAULT_APP_SETTINGS.allowed_origins,
    defaultChatModel: settings.default_chat_model ?? DEFAULT_APP_SETTINGS.default_chat_model,
    enableUserKeyCreation: getBooleanSetting(settings, 'enable_user_key_creation', true),
    openRouterFreeOnly: getBooleanSetting(settings, 'openrouter_free_only', false),
  };
}

export function updateAppSettings(input: Partial<AppSettings>): AppSettings {
  const now = Date.now();
  const updates: Record<string, string> = {};

  if (input.appName !== undefined) updates.app_name = input.appName.trim();
  if (input.sessionTimeoutMinutes !== undefined) updates.session_timeout_minutes = String(input.sessionTimeoutMinutes);
  if (input.defaultApiKeyRateLimit !== undefined) updates.default_api_key_rate_limit = String(input.defaultApiKeyRateLimit);
  if (input.anonymousRateLimitPerMinute !== undefined) updates.anonymous_rate_limit_per_minute = String(input.anonymousRateLimitPerMinute);
  if (input.allowedOrigins !== undefined) updates.allowed_origins = input.allowedOrigins.trim() || '*';
  if (input.defaultChatModel !== undefined) updates.default_chat_model = input.defaultChatModel.trim() || 'auto';
  if (input.enableUserKeyCreation !== undefined) updates.enable_user_key_creation = input.enableUserKeyCreation ? '1' : '0';
  if (input.openRouterFreeOnly !== undefined) updates.openrouter_free_only = input.openRouterFreeOnly ? '1' : '0';

  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($key, $value, $updatedAt)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      upsert.run({ $key: key, $value: value, $updatedAt: now });
    }
  })();

  return getAppSettings();
}

export function countUsers(): number {
  const row = db.query(`SELECT COUNT(*) AS count FROM users`).get() as { count: number } | null;
  return row?.count ?? 0;
}

export function createUser(input: {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
}): UserRecord {
  const now = Date.now();
  db.query(`
    INSERT INTO users (id, email, name, password_hash, role, is_active, created_at, updated_at)
    VALUES ($id, $email, $name, $passwordHash, $role, 1, $now, $now)
  `).run({
    $id: input.id,
    $email: input.email.trim().toLowerCase(),
    $name: input.name.trim(),
    $passwordHash: input.passwordHash,
    $role: input.role,
    $now: now,
  });

  const row = db.query(`SELECT * FROM users WHERE id = $id`).get({ $id: input.id }) as UserRow | null;
  if (!row) {
    throw new Error('Failed to create user');
  }
  return toUserRecord(row);
}

export function getUserByEmail(email: string): (UserRecord & { passwordHash: string }) | null {
  const row = db.query(`SELECT * FROM users WHERE email = $email LIMIT 1`).get({
    $email: email.trim().toLowerCase(),
  }) as UserRow | null;

  if (!row) {
    return null;
  }

  return { ...toUserRecord(row), passwordHash: row.password_hash };
}

export function getUserById(userId: string): UserRecord | null {
  const row = db.query(`SELECT * FROM users WHERE id = $id LIMIT 1`).get({ $id: userId }) as UserRow | null;
  return row ? toUserRecord(row) : null;
}

export function listUsers(): UserRecord[] {
  const rows = db.query(`SELECT * FROM users ORDER BY created_at ASC`).all() as UserRow[];
  return rows.map(toUserRecord);
}

export function updateUserProductSettings(userId: string, input: {
  monthlyRequestQuota?: number | null;
  onboardingCompletedAt?: number | null;
}): UserRecord | null {
  const existing = db.query(`SELECT * FROM users WHERE id = $id LIMIT 1`).get({ $id: userId }) as UserRow | null;
  if (!existing) {
    return null;
  }

  db.query(`
    UPDATE users
    SET
      monthly_request_quota = $monthlyRequestQuota,
      onboarding_completed_at = $onboardingCompletedAt,
      updated_at = $updatedAt
    WHERE id = $id
  `).run({
    $id: userId,
    $monthlyRequestQuota: input.monthlyRequestQuota ?? existing.monthly_request_quota ?? null,
    $onboardingCompletedAt: input.onboardingCompletedAt ?? existing.onboarding_completed_at ?? null,
    $updatedAt: Date.now(),
  });

  return getUserById(userId);
}

export function markUserOnboardingCompleted(userId: string): UserRecord | null {
  return updateUserProductSettings(userId, {
    onboardingCompletedAt: Date.now(),
  });
}

export function setUserActive(userId: string, isActive: boolean): void {
  db.query(`
    UPDATE users
    SET is_active = $isActive, updated_at = $updatedAt
    WHERE id = $id
  `).run({
    $id: userId,
    $isActive: isActive ? 1 : 0,
    $updatedAt: Date.now(),
  });
}

export function updateUserLastSeen(userId: string): void {
  const now = Date.now();
  db.query(`
    UPDATE users
    SET last_seen_at = $now, updated_at = $now
    WHERE id = $id
  `).run({ $id: userId, $now: now });
}

export function updateUserLastLogin(userId: string): void {
  const now = Date.now();
  db.query(`
    UPDATE users
    SET last_login_at = $now, last_seen_at = $now, updated_at = $now
    WHERE id = $id
  `).run({ $id: userId, $now: now });
}

export function createProject(input: {
  id: string;
  name: string;
  description?: string | null;
  modelAccessMode?: ProjectModelAccessMode;
  allowedModelIds?: string[];
  requestQuotaMonthly?: number | null;
  ownerUserId?: string | null;
}): ProjectRecord {
  const now = Date.now();
  const baseSlug = slugify(input.name);
  let slug = baseSlug;
  let suffix = 1;

  while (db.query(`SELECT 1 FROM projects WHERE slug = $slug LIMIT 1`).get({ $slug: slug })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  db.query(`
    INSERT INTO projects (
      id, name, slug, description, model_access_mode, request_quota_monthly, is_active, created_at, updated_at
    )
    VALUES (
      $id, $name, $slug, $description, $modelAccessMode, $requestQuotaMonthly, 1, $now, $now
    )
  `).run({
    $id: input.id,
    $name: input.name.trim(),
    $slug: slug,
    $description: input.description?.trim() || null,
    $modelAccessMode: normalizeProjectModelAccessMode(input.modelAccessMode),
    $requestQuotaMonthly: input.requestQuotaMonthly ?? null,
    $now: now,
  });

  setProjectModelAccess(input.id, input.modelAccessMode ?? 'all', input.allowedModelIds ?? []);

  if (input.ownerUserId) {
    db.query(`
      INSERT OR REPLACE INTO project_members (project_id, user_id, role, created_at)
      VALUES ($projectId, $userId, 'owner', $createdAt)
    `).run({
      $projectId: input.id,
      $userId: input.ownerUserId,
      $createdAt: now,
    });
  }

  const row = db.query(`SELECT * FROM projects WHERE id = $id LIMIT 1`).get({ $id: input.id }) as ProjectRow | null;
  if (!row) {
    throw new Error('Failed to create project');
  }

  const allowedModels = getProjectAllowedModelsMap([row.id]);
  return toProjectRecord(row, allowedModels.get(row.id) ?? []);
}

export function getProjectById(projectId: string): ProjectRecord | null {
  const row = db.query(`SELECT * FROM projects WHERE id = $id LIMIT 1`).get({ $id: projectId }) as ProjectRow | null;
  if (!row) {
    return null;
  }
  const allowedModels = getProjectAllowedModelsMap([row.id]);
  return toProjectRecord(row, allowedModels.get(row.id) ?? []);
}

export function listProjectsForUser(userId: string): ProjectRecord[] {
  const rows = db.query(`
    SELECT p.*, pm.role
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = $userId
    ORDER BY p.created_at ASC
  `).all({ $userId: userId }) as Array<ProjectRow & { role: 'owner' | 'member' }>;
  const allowedModels = getProjectAllowedModelsMap(rows.map((row) => row.id));
  return rows.map((row) => toProjectRecord(row, allowedModels.get(row.id) ?? []));
}

export function listAllProjects(): ProjectRecord[] {
  const rows = db.query(`
    SELECT * FROM projects
    ORDER BY created_at ASC
  `).all() as ProjectRow[];
  const allowedModels = getProjectAllowedModelsMap(rows.map((row) => row.id));
  return rows.map((row) => toProjectRecord(row, allowedModels.get(row.id) ?? []));
}

export function updateProject(projectId: string, input: {
  name?: string;
  description?: string | null;
  modelAccessMode?: ProjectModelAccessMode;
  allowedModelIds?: string[];
  requestQuotaMonthly?: number | null;
  isActive?: boolean;
}): ProjectRecord | null {
  const current = db.query(`SELECT * FROM projects WHERE id = $id LIMIT 1`).get({ $id: projectId }) as ProjectRow | null;
  if (!current) {
    return null;
  }

  db.query(`
    UPDATE projects
    SET
      name = $name,
      description = $description,
      model_access_mode = $modelAccessMode,
      request_quota_monthly = $requestQuotaMonthly,
      is_active = $isActive,
      updated_at = $updatedAt
    WHERE id = $id
  `).run({
    $id: projectId,
    $name: input.name?.trim() || current.name,
    $description: input.description === undefined ? current.description : (input.description?.trim() || null),
    $modelAccessMode: input.modelAccessMode === undefined ? current.model_access_mode : normalizeProjectModelAccessMode(input.modelAccessMode),
    $requestQuotaMonthly: input.requestQuotaMonthly === undefined ? current.request_quota_monthly : input.requestQuotaMonthly,
    $isActive: input.isActive === undefined ? current.is_active : (input.isActive ? 1 : 0),
    $updatedAt: Date.now(),
  });

  if (input.modelAccessMode !== undefined || input.allowedModelIds !== undefined) {
    setProjectModelAccess(
      projectId,
      input.modelAccessMode === undefined ? current.model_access_mode : input.modelAccessMode,
      input.allowedModelIds,
    );
  }

  return getProjectById(projectId);
}

export function addUserToProject(projectId: string, userId: string, role: 'owner' | 'member' = 'member'): void {
  db.query(`
    INSERT OR REPLACE INTO project_members (project_id, user_id, role, created_at)
    VALUES ($projectId, $userId, $role, $createdAt)
  `).run({
    $projectId: projectId,
    $userId: userId,
    $role: role,
    $createdAt: Date.now(),
  });
}

export function listProjectMembers(projectId: string): UserRecord[] {
  const rows = db.query(`
    SELECT u.*
    FROM users u
    JOIN project_members pm ON pm.user_id = u.id
    WHERE pm.project_id = $projectId
    ORDER BY u.created_at ASC
  `).all({ $projectId: projectId }) as UserRow[];
  return rows.map(toUserRecord);
}

export function createInvitationToken(input: {
  id: string;
  email?: string | null;
  projectId?: string | null;
  role: 'owner' | 'member';
  tokenHash: string;
  expiresAt: number;
  createdByUserId?: string | null;
}): InvitationTokenRecord {
  const now = Date.now();
  db.query(`
    INSERT INTO invitation_tokens (
      id, email, project_id, role, token_hash, expires_at, created_at, accepted_at, created_by_user_id
    )
    VALUES (
      $id, $email, $projectId, $role, $tokenHash, $expiresAt, $createdAt, NULL, $createdByUserId
    )
  `).run({
    $id: input.id,
    $email: input.email?.trim().toLowerCase() || null,
    $projectId: input.projectId ?? null,
    $role: input.role,
    $tokenHash: input.tokenHash,
    $expiresAt: input.expiresAt,
    $createdAt: now,
    $createdByUserId: input.createdByUserId ?? null,
  });

  const row = db.query(`
    SELECT i.*, p.name AS project_name
    FROM invitation_tokens i
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.id = $id
    LIMIT 1
  `).get({ $id: input.id }) as InvitationTokenRow | null;

  if (!row) {
    throw new Error('Failed to create invitation');
  }

  return toInvitationTokenRecord(row);
}

export function getInvitationTokenByHash(tokenHash: string): InvitationTokenRecord | null {
  const row = db.query(`
    SELECT i.*, p.name AS project_name
    FROM invitation_tokens i
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.token_hash = $tokenHash
      AND i.accepted_at IS NULL
      AND i.expires_at > $now
    LIMIT 1
  `).get({
    $tokenHash: tokenHash,
    $now: Date.now(),
  }) as InvitationTokenRow | null;

  return row ? toInvitationTokenRecord(row) : null;
}

export function listInvitationTokens(): InvitationTokenRecord[] {
  const rows = db.query(`
    SELECT i.*, p.name AS project_name
    FROM invitation_tokens i
    LEFT JOIN projects p ON p.id = i.project_id
    ORDER BY i.created_at DESC
  `).all() as InvitationTokenRow[];
  return rows.map(toInvitationTokenRecord);
}

export function markInvitationTokenAccepted(invitationId: string): void {
  db.query(`
    UPDATE invitation_tokens
    SET accepted_at = $acceptedAt
    WHERE id = $id
  `).run({
    $id: invitationId,
    $acceptedAt: Date.now(),
  });
}

export function createPasswordResetToken(input: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  requestedByUserId?: string | null;
}): void {
  db.query(`
    INSERT INTO password_reset_tokens (
      id, user_id, token_hash, expires_at, created_at, used_at, requested_by_user_id
    )
    VALUES (
      $id, $userId, $tokenHash, $expiresAt, $createdAt, NULL, $requestedByUserId
    )
  `).run({
    $id: input.id,
    $userId: input.userId,
    $tokenHash: input.tokenHash,
    $expiresAt: input.expiresAt,
    $createdAt: Date.now(),
    $requestedByUserId: input.requestedByUserId ?? null,
  });
}

export function getPasswordResetTokenByHash(tokenHash: string): PasswordResetTokenRow | null {
  return db.query(`
    SELECT *
    FROM password_reset_tokens
    WHERE token_hash = $tokenHash
      AND used_at IS NULL
      AND expires_at > $now
    LIMIT 1
  `).get({
    $tokenHash: tokenHash,
    $now: Date.now(),
  }) as PasswordResetTokenRow | null;
}

export function markPasswordResetTokenUsed(resetTokenId: string): void {
  db.query(`
    UPDATE password_reset_tokens
    SET used_at = $usedAt
    WHERE id = $id
  `).run({
    $id: resetTokenId,
    $usedAt: Date.now(),
  });
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  db.query(`
    UPDATE users
    SET password_hash = $passwordHash, updated_at = $updatedAt
    WHERE id = $id
  `).run({
    $id: userId,
    $passwordHash: passwordHash,
    $updatedAt: Date.now(),
  });
}

export function createSession(input: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  ip?: string | null;
  userAgent?: string | null;
}): SessionRecord {
  const now = Date.now();
  db.query(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
    VALUES ($id, $userId, $tokenHash, $now, $expiresAt, $now, $ip, $userAgent)
  `).run({
    $id: input.id,
    $userId: input.userId,
    $tokenHash: input.tokenHash,
    $now: now,
    $expiresAt: input.expiresAt,
    $ip: input.ip ?? null,
    $userAgent: input.userAgent ?? null,
  });

  const row = db.query(`SELECT * FROM sessions WHERE id = $id`).get({ $id: input.id }) as {
    id: string;
    user_id: string;
    token_hash: string;
    created_at: number;
    expires_at: number;
    last_seen_at: number;
    ip: string | null;
    user_agent: string | null;
  } | null;

  if (!row) {
    throw new Error('Failed to create session');
  }
  return toSessionRecord(row);
}

export function getSessionByTokenHash(tokenHash: string): SessionWithUser | null {
  deleteExpiredSessions();

  const row = db.query(`
    SELECT
      s.id AS session_id,
      s.token_hash,
      s.created_at AS session_created_at,
      s.expires_at,
      s.last_seen_at AS session_last_seen_at,
      s.ip,
      s.user_agent,
      u.id AS user_id,
      u.email,
      u.name,
      u.role,
      u.is_active,
      u.monthly_request_quota,
      u.onboarding_completed_at,
      u.created_at AS user_created_at,
      u.updated_at AS user_updated_at,
      u.last_login_at,
      u.last_seen_at AS user_last_seen_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $tokenHash
    LIMIT 1
  `).get({ $tokenHash: tokenHash }) as SessionLookupRow | null;

  if (!row) {
    return null;
  }

  return {
    session: {
      id: row.session_id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      createdAt: row.session_created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.session_last_seen_at,
      ip: row.ip,
      userAgent: row.user_agent,
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: row.is_active === 1,
      monthlyRequestQuota: row.monthly_request_quota,
      onboardingCompletedAt: row.onboarding_completed_at,
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at,
      lastLoginAt: row.last_login_at,
      lastSeenAt: row.user_last_seen_at,
    },
  };
}

export function touchSession(sessionId: string): void {
  db.query(`
    UPDATE sessions
    SET last_seen_at = $now
    WHERE id = $id
  `).run({ $id: sessionId, $now: Date.now() });
}

export function deleteSessionById(sessionId: string): void {
  db.query(`DELETE FROM sessions WHERE id = $id`).run({ $id: sessionId });
}

export function deleteSessionByTokenHash(tokenHash: string): void {
  db.query(`DELETE FROM sessions WHERE token_hash = $tokenHash`).run({ $tokenHash: tokenHash });
}

export function deleteSessionsByUserId(userId: string): void {
  db.query(`DELETE FROM sessions WHERE user_id = $userId`).run({ $userId: userId });
}

export function deleteExpiredSessions(): void {
  db.query(`DELETE FROM sessions WHERE expires_at <= $now`).run({ $now: Date.now() });
}

export function createUserApiKey(input: {
  id: string;
  userId: string;
  projectId?: string | null;
  name: string;
  keyHash: string;
  keyPrefix: string;
  rateLimitPerMinute: number;
}): UserApiKeyRecord {
  const now = Date.now();
  db.query(`
    INSERT INTO user_api_keys (
      id, user_id, project_id, name, key_hash, key_prefix, rate_limit_per_minute, is_active, created_at
    )
    VALUES ($id, $userId, $projectId, $name, $keyHash, $keyPrefix, $rateLimitPerMinute, 1, $now)
  `).run({
    $id: input.id,
    $userId: input.userId,
    $projectId: input.projectId ?? null,
    $name: input.name.trim(),
    $keyHash: input.keyHash,
    $keyPrefix: input.keyPrefix,
    $rateLimitPerMinute: input.rateLimitPerMinute,
    $now: now,
  });

  const row = db.query(`SELECT * FROM user_api_keys WHERE id = $id`).get({ $id: input.id }) as UserApiKeyRow | null;
  if (!row) {
    throw new Error('Failed to create API key');
  }
  return toUserApiKeyRecord(row);
}

export function listApiKeysForUser(userId: string): UserApiKeyRecord[] {
  const rows = db.query(`
    SELECT * FROM user_api_keys
    WHERE user_id = $userId
    ORDER BY created_at ASC
  `).all({ $userId: userId }) as UserApiKeyRow[];

  return rows.map(toUserApiKeyRecord);
}

export function listAllApiKeys(): UserApiKeyRecord[] {
  const rows = db.query(`
    SELECT
      k.*,
      u.email AS user_email,
      u.name AS user_name,
      u.role AS user_role
    FROM user_api_keys k
    JOIN users u ON u.id = k.user_id
    ORDER BY u.created_at ASC, k.created_at ASC
  `).all() as UserApiKeyRow[];

  return rows.map(toUserApiKeyRecord);
}

export function getApiKeyById(apiKeyId: string): UserApiKeyRecord | null {
  const row = db.query(`SELECT * FROM user_api_keys WHERE id = $id LIMIT 1`).get({
    $id: apiKeyId,
  }) as UserApiKeyRow | null;

  return row ? toUserApiKeyRecord(row) : null;
}

export function getApiKeyAuthByHash(keyHash: string): ApiKeyAuthRecord | null {
  const row = db.query(`
    SELECT
      k.*,
      u.email,
      u.name AS name_display,
      u.role,
      u.is_active AS user_is_active,
      u.monthly_request_quota,
      u.onboarding_completed_at,
      u.created_at AS user_created_at,
      u.updated_at AS user_updated_at,
      u.last_login_at AS user_last_login_at,
      u.last_seen_at AS user_last_seen_at
    FROM user_api_keys k
    JOIN users u ON u.id = k.user_id
    WHERE k.key_hash = $keyHash
    LIMIT 1
  `).get({ $keyHash: keyHash }) as UserApiKeyLookupRow | null;

  if (!row) {
    return null;
  }

  return {
    apiKey: {
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      name: row.name,
      keyPrefix: row.key_prefix,
      rateLimitPerMinute: row.rate_limit_per_minute,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      totalRequests: row.total_requests,
    },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name_display,
      role: row.role,
      isActive: row.user_is_active === 1,
      monthlyRequestQuota: row.monthly_request_quota,
      onboardingCompletedAt: row.onboarding_completed_at,
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at,
      lastLoginAt: row.user_last_login_at,
      lastSeenAt: row.user_last_seen_at,
    },
  };
}

export function touchApiKey(apiKeyId: string): void {
  db.query(`
    UPDATE user_api_keys
    SET last_used_at = $now, total_requests = total_requests + 1
    WHERE id = $id
  `).run({ $id: apiKeyId, $now: Date.now() });
}

export function updateApiKeyRateLimit(apiKeyId: string, rateLimitPerMinute: number): void {
  db.query(`
    UPDATE user_api_keys
    SET rate_limit_per_minute = $rateLimitPerMinute
    WHERE id = $id
  `).run({ $id: apiKeyId, $rateLimitPerMinute: rateLimitPerMinute });
}

export function updateApiKeyProject(apiKeyId: string, projectId: string | null): void {
  db.query(`
    UPDATE user_api_keys
    SET project_id = $projectId
    WHERE id = $id
  `).run({
    $id: apiKeyId,
    $projectId: projectId ?? null,
  });
}

export function setApiKeyActive(apiKeyId: string, isActive: boolean): void {
  db.query(`
    UPDATE user_api_keys
    SET is_active = $isActive
    WHERE id = $id
  `).run({ $id: apiKeyId, $isActive: isActive ? 1 : 0 });
}

/**
 * Rotates the raw secret of an existing API key entry.
 * The old key becomes invalid immediately; the caller is responsible for
 * returning the new rawKey to the user exactly once.
 */
export function rotateUserApiKey(apiKeyId: string, newKeyHash: string, newKeyPrefix: string): UserApiKeyRecord | null {
  db.query(`
    UPDATE user_api_keys
    SET key_hash = $keyHash, key_prefix = $keyPrefix
    WHERE id = $id
  `).run({ $id: apiKeyId, $keyHash: newKeyHash, $keyPrefix: newKeyPrefix });

  return getApiKeyById(apiKeyId);
}


export function createServiceApiKey(input: {
  id: string;
  provider: string;
  name: string;
  keyHash: string;
  keyHint: string;
  encryptedValue: string;
  valueIv: string;
  valueTag: string;
  priority: number;
}): ServiceApiKeyRecord {
  const now = Date.now();
  db.query(`
    INSERT INTO service_api_keys (
      id, provider, name, key_hash, key_hint, encrypted_value, value_iv, value_tag,
      priority, is_active, cooldown_until, fail_count, total_requests, created_at
    )
    VALUES (
      $id, $provider, $name, $keyHash, $keyHint, $encryptedValue, $valueIv, $valueTag,
      $priority, 1, 0, 0, 0, $createdAt
    )
  `).run({
    $id: input.id,
    $provider: input.provider.toLowerCase(),
    $name: input.name.trim(),
    $keyHash: input.keyHash,
    $keyHint: input.keyHint,
    $encryptedValue: input.encryptedValue,
    $valueIv: input.valueIv,
    $valueTag: input.valueTag,
    $priority: input.priority,
    $createdAt: now,
  });

  const row = db.query(`SELECT * FROM service_api_keys WHERE id = $id`).get({
    $id: input.id,
  }) as ServiceApiKeyRow | null;

  if (!row) {
    throw new Error('Failed to create service API key');
  }

  return toServiceApiKeyRecord(row);
}

export function listServiceApiKeys(): ServiceApiKeyRecord[] {
  clearExpiredServiceKeyCooldowns();
  const rows = db.query(`
    SELECT * FROM service_api_keys
    ORDER BY provider ASC, priority ASC, created_at ASC
  `).all() as ServiceApiKeyRow[];

  return rows.map(toServiceApiKeyRecord);
}

export function getServiceApiKeyById(serviceKeyId: string): ServiceApiKeyRecord | null {
  const row = db.query(`SELECT * FROM service_api_keys WHERE id = $id LIMIT 1`).get({
    $id: serviceKeyId,
  }) as ServiceApiKeyRow | null;

  return row ? toServiceApiKeyRecord(row) : null;
}

export function getDecryptedServiceKeysByProvider(provider: string): ServiceApiKeyCandidate[] {
  clearExpiredServiceKeyCooldowns();
  const rows = db.query(`
    SELECT * FROM service_api_keys
    WHERE provider = $provider
      AND is_active = 1
      AND cooldown_until <= $now
    ORDER BY priority ASC, COALESCE(last_used_at, 0) ASC, created_at ASC
  `).all({
    $provider: provider.toLowerCase(),
    $now: Date.now(),
  }) as ServiceApiKeyRow[];

  return rows.map((row) => ({
    ...toServiceApiKeyRecord(row),
    value: decryptSecret({
      ciphertext: row.encrypted_value,
      iv: row.value_iv,
      tag: row.value_tag,
    }),
  }));
}

export function touchServiceApiKey(serviceKeyId: string): void {
  db.query(`
    UPDATE service_api_keys
    SET last_used_at = $now, total_requests = total_requests + 1, last_error = NULL
    WHERE id = $id
  `).run({ $id: serviceKeyId, $now: Date.now() });
}

export function setServiceApiKeyCooldown(serviceKeyId: string, cooldownUntil: number, reason?: string): void {
  db.query(`
    UPDATE service_api_keys
    SET cooldown_until = $cooldownUntil, fail_count = fail_count + 1, last_error = $reason
    WHERE id = $id
  `).run({
    $id: serviceKeyId,
    $cooldownUntil: cooldownUntil,
    $reason: reason ?? null,
  });
}

export function clearServiceApiKeyCooldown(serviceKeyId: string): void {
  db.query(`
    UPDATE service_api_keys
    SET cooldown_until = 0, last_error = NULL
    WHERE id = $id
  `).run({ $id: serviceKeyId });
}

export function setServiceApiKeyActive(serviceKeyId: string, isActive: boolean, reason?: string): void {
  db.query(`
    UPDATE service_api_keys
    SET is_active = $isActive, last_error = $reason
    WHERE id = $id
  `).run({
    $id: serviceKeyId,
    $isActive: isActive ? 1 : 0,
    $reason: reason ?? null,
  });
}

export function updateServiceApiKey(serviceKeyId: string, input: {
  name?: string;
  priority?: number;
  isActive?: boolean;
}): void {
  const row = db.query(`SELECT * FROM service_api_keys WHERE id = $id LIMIT 1`).get({
    $id: serviceKeyId,
  }) as ServiceApiKeyRow | null;

  if (!row) {
    throw new Error('Service key not found');
  }

  db.query(`
    UPDATE service_api_keys
    SET
      name = $name,
      priority = $priority,
      is_active = $isActive
    WHERE id = $id
  `).run({
    $id: serviceKeyId,
    $name: input.name?.trim() || row.name,
    $priority: input.priority ?? row.priority,
    $isActive: input.isActive === undefined ? row.is_active : (input.isActive ? 1 : 0),
  });
}

export function replaceServiceApiKeySecret(serviceKeyId: string, input: {
  keyHash: string;
  keyHint: string;
  encryptedValue: string;
  valueIv: string;
  valueTag: string;
}): void {
  const result = db.query(`
    UPDATE service_api_keys
    SET
      key_hash = $keyHash,
      key_hint = $keyHint,
      encrypted_value = $encryptedValue,
      value_iv = $valueIv,
      value_tag = $valueTag,
      is_active = 1,
      cooldown_until = 0,
      last_error = NULL
    WHERE id = $id
  `).run({
    $id: serviceKeyId,
    $keyHash: input.keyHash,
    $keyHint: input.keyHint,
    $encryptedValue: input.encryptedValue,
    $valueIv: input.valueIv,
    $valueTag: input.valueTag,
  }) as { changes?: number };

  if (Number(result?.changes ?? 0) === 0) {
    throw new Error('Service key not found');
  }
}

export function deleteServiceApiKey(serviceKeyId: string): boolean {
  const result = db.query(`DELETE FROM service_api_keys WHERE id = $id`).run({
    $id: serviceKeyId,
  }) as { changes?: number };

  return Number(result?.changes ?? 0) > 0;
}

export function clearExpiredServiceKeyCooldowns(): void {
  db.query(`
    UPDATE service_api_keys
    SET cooldown_until = 0, last_error = CASE WHEN cooldown_until > 0 AND cooldown_until <= $now THEN NULL ELSE last_error END
    WHERE cooldown_until > 0 AND cooldown_until <= $now
  `).run({ $now: Date.now() });
}

function buildNamedPlaceholders(values: string[], prefix: string): {
  clause: string;
  params: Record<string, string>;
} {
  const params: Record<string, string> = {};
  const placeholders = values.map((value, index) => {
    const key = `$${prefix}${index}`;
    params[key] = value;
    return key;
  });
  return {
    clause: placeholders.join(', '),
    params,
  };
}

function normalizeVisibleProjectIds(projectIds?: string[] | null): string[] {
  return Array.from(new Set(
    (projectIds ?? [])
      .map((projectId) => projectId?.trim())
      .filter((projectId): projectId is string => Boolean(projectId)),
  ));
}

function buildRequestMetricsUserScope(
  scope?: RequestMetricsScope,
  columnName: string = 'user_id',
): {
  clause: string;
  params: Record<string, string>;
} {
  if (!scope?.userId?.trim()) {
    return {
      clause: '',
      params: {},
    };
  }

  return {
    clause: ` AND ${columnName} = $scopeUserId`,
    params: {
      $scopeUserId: scope.userId.trim(),
    },
  };
}

function buildVisibleProjectFilter(
  scope?: RequestMetricsScope,
  columnName: string = 'p.id',
): {
  clause: string;
  params: Record<string, string>;
} {
  if (!scope?.visibleProjectIds) {
    return {
      clause: '',
      params: {},
    };
  }

  const projectIds = normalizeVisibleProjectIds(scope.visibleProjectIds);
  if (projectIds.length === 0) {
    return {
      clause: ' AND 1 = 0',
      params: {},
    };
  }

  const placeholders = buildNamedPlaceholders(projectIds, 'visibleProject');
  return {
    clause: ` AND ${columnName} IN (${placeholders.clause})`,
    params: placeholders.params,
  };
}

export function listRateLimitRules(scopeType?: RateLimitScopeType): RateLimitRuleRecord[] {
  const rows = scopeType
    ? db.query(`
      SELECT * FROM rate_limit_rules
      WHERE scope_type = $scopeType
      ORDER BY provider ASC, scope_id ASC
    `).all({ $scopeType: scopeType }) as RateLimitRuleRow[]
    : db.query(`
      SELECT * FROM rate_limit_rules
      ORDER BY scope_type ASC, provider ASC, scope_id ASC
    `).all() as RateLimitRuleRow[];

  return rows.map(toRateLimitRuleRecord);
}

export function getRateLimitRulesMap(scopeType: RateLimitScopeType): Map<string, RateLimitRuleRecord> {
  return new Map(listRateLimitRules(scopeType).map((rule) => [rule.scopeId, rule]));
}

export function upsertRateLimitRule(input: {
  scopeType: RateLimitScopeType;
  scopeId: string;
  provider?: string | null;
  mode: RateLimitMode;
  rpm?: number | null;
  rpd?: number | null;
  tpm?: number | null;
  tpd?: number | null;
  ash?: number | null;
  asd?: number | null;
}): RateLimitRuleRecord {
  const now = Date.now();
  const normalizedScopeId = input.scopeType === 'provider'
    ? normalizeProviderId(input.scopeId)
    : normalizeServiceId(input.scopeId);
  const normalizedProvider = input.scopeType === 'provider'
    ? normalizedScopeId
    : normalizeProviderId(input.provider ?? normalizedScopeId.split('/')[0] ?? '');

  db.query(`
    INSERT INTO rate_limit_rules (
      scope_type, scope_id, provider, mode, rpm, rpd, tpm, tpd, ash, asd, created_at, updated_at
    )
    VALUES (
      $scopeType, $scopeId, $provider, $mode, $rpm, $rpd, $tpm, $tpd, $ash, $asd, $createdAt, $updatedAt
    )
    ON CONFLICT(scope_type, scope_id) DO UPDATE SET
      provider = excluded.provider,
      mode = excluded.mode,
      rpm = excluded.rpm,
      rpd = excluded.rpd,
      tpm = excluded.tpm,
      tpd = excluded.tpd,
      ash = excluded.ash,
      asd = excluded.asd,
      updated_at = excluded.updated_at
  `).run({
    $scopeType: input.scopeType,
    $scopeId: normalizedScopeId,
    $provider: normalizedProvider || null,
    $mode: input.mode,
    $rpm: input.rpm ?? null,
    $rpd: input.rpd ?? null,
    $tpm: input.tpm ?? null,
    $tpd: input.tpd ?? null,
    $ash: input.ash ?? null,
    $asd: input.asd ?? null,
    $createdAt: now,
    $updatedAt: now,
  });

  const row = db.query(`
    SELECT * FROM rate_limit_rules
    WHERE scope_type = $scopeType AND scope_id = $scopeId
    LIMIT 1
  `).get({
    $scopeType: input.scopeType,
    $scopeId: normalizedScopeId,
  }) as RateLimitRuleRow | null;

  if (!row) {
    throw new Error('Rate limit rule not found after save');
  }

  return toRateLimitRuleRecord(row);
}

export function removeRateLimitRule(scopeType: RateLimitScopeType, scopeId: string): void {
  const normalizedScopeId = scopeType === 'provider'
    ? normalizeProviderId(scopeId)
    : normalizeServiceId(scopeId);

  db.query(`
    DELETE FROM rate_limit_rules
    WHERE scope_type = $scopeType AND scope_id = $scopeId
  `).run({
    $scopeType: scopeType,
    $scopeId: normalizedScopeId,
  });
}

function usageRowToSnapshot(row: {
  scope_id: string;
  requests_last_minute: number | null;
  requests_last_day: number | null;
  tokens_last_minute: number | null;
  tokens_last_day: number | null;
  audio_seconds_last_hour: number | null;
  audio_seconds_last_day: number | null;
  first_request_at_minute: number | null;
  first_request_at_day: number | null;
  first_token_at_minute: number | null;
  first_token_at_day: number | null;
  first_audio_at_hour: number | null;
  first_audio_at_day: number | null;
}): UsageWindowSnapshot {
  return {
    requestsLastMinute: row.requests_last_minute ?? 0,
    requestsLastDay: row.requests_last_day ?? 0,
    tokensLastMinute: row.tokens_last_minute ?? 0,
    tokensLastDay: row.tokens_last_day ?? 0,
    audioSecondsLastHour: row.audio_seconds_last_hour ?? 0,
    audioSecondsLastDay: row.audio_seconds_last_day ?? 0,
    firstRequestAtMinute: row.first_request_at_minute,
    firstRequestAtDay: row.first_request_at_day,
    firstTokenAtMinute: row.first_token_at_minute,
    firstTokenAtDay: row.first_token_at_day,
    firstAudioAtHour: row.first_audio_at_hour,
    firstAudioAtDay: row.first_audio_at_day,
  };
}

export function getProviderUsageSnapshots(providerIds: string[]): Map<string, UsageWindowSnapshot> {
  const normalizedIds = Array.from(new Set(providerIds.map((item) => normalizeProviderId(item)).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return new Map();
  }

  const now = Date.now();
  const minuteStart = now - 60_000;
  const hourStart = now - 60 * 60_000;
  const dayStart = now - 24 * 60 * 60_000;
  const placeholders = buildNamedPlaceholders(normalizedIds, 'provider');

  const rows = db.query(`
    SELECT
      LOWER(provider) AS scope_id,
      SUM(CASE WHEN created_at >= $minuteStart THEN 1 ELSE 0 END) AS requests_last_minute,
      COUNT(*) AS requests_last_day,
      SUM(CASE WHEN created_at >= $minuteStart THEN total_tokens ELSE 0 END) AS tokens_last_minute,
      SUM(total_tokens) AS tokens_last_day,
      SUM(CASE WHEN created_at >= $hourStart THEN audio_seconds ELSE 0 END) AS audio_seconds_last_hour,
      SUM(audio_seconds) AS audio_seconds_last_day,
      MIN(CASE WHEN created_at >= $minuteStart THEN created_at END) AS first_request_at_minute,
      MIN(created_at) AS first_request_at_day,
      MIN(CASE WHEN created_at >= $minuteStart AND total_tokens > 0 THEN created_at END) AS first_token_at_minute,
      MIN(CASE WHEN total_tokens > 0 THEN created_at END) AS first_token_at_day,
      MIN(CASE WHEN created_at >= $hourStart AND audio_seconds > 0 THEN created_at END) AS first_audio_at_hour,
      MIN(CASE WHEN audio_seconds > 0 THEN created_at END) AS first_audio_at_day
    FROM request_metrics
    WHERE created_at >= $dayStart
      AND provider IS NOT NULL
      AND provider <> ''
      AND LOWER(provider) IN (${placeholders.clause})
    GROUP BY LOWER(provider)
  `).all({
    ...placeholders.params,
    $minuteStart: minuteStart,
    $hourStart: hourStart,
    $dayStart: dayStart,
  }) as Array<{
    scope_id: string;
    requests_last_minute: number | null;
    requests_last_day: number | null;
    tokens_last_minute: number | null;
    tokens_last_day: number | null;
    audio_seconds_last_hour: number | null;
    audio_seconds_last_day: number | null;
    first_request_at_minute: number | null;
    first_request_at_day: number | null;
    first_token_at_minute: number | null;
    first_token_at_day: number | null;
    first_audio_at_hour: number | null;
    first_audio_at_day: number | null;
  }>;

  const result = new Map<string, UsageWindowSnapshot>();
  for (const id of normalizedIds) {
    result.set(id, emptyUsageSnapshot());
  }
  for (const row of rows) {
    result.set(row.scope_id, usageRowToSnapshot(row));
  }
  return result;
}

export function getModelUsageSnapshots(serviceIds: string[]): Map<string, UsageWindowSnapshot> {
  const normalizedIds = Array.from(new Set(serviceIds.map((item) => normalizeServiceId(item)).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return new Map();
  }

  const now = Date.now();
  const minuteStart = now - 60_000;
  const hourStart = now - 60 * 60_000;
  const dayStart = now - 24 * 60 * 60_000;
  const placeholders = buildNamedPlaceholders(normalizedIds, 'model');

  const rows = db.query(`
    SELECT
      LOWER(provider) || '/' || model AS scope_id,
      SUM(CASE WHEN created_at >= $minuteStart THEN 1 ELSE 0 END) AS requests_last_minute,
      COUNT(*) AS requests_last_day,
      SUM(CASE WHEN created_at >= $minuteStart THEN total_tokens ELSE 0 END) AS tokens_last_minute,
      SUM(total_tokens) AS tokens_last_day,
      SUM(CASE WHEN created_at >= $hourStart THEN audio_seconds ELSE 0 END) AS audio_seconds_last_hour,
      SUM(audio_seconds) AS audio_seconds_last_day,
      MIN(CASE WHEN created_at >= $minuteStart THEN created_at END) AS first_request_at_minute,
      MIN(created_at) AS first_request_at_day,
      MIN(CASE WHEN created_at >= $minuteStart AND total_tokens > 0 THEN created_at END) AS first_token_at_minute,
      MIN(CASE WHEN total_tokens > 0 THEN created_at END) AS first_token_at_day,
      MIN(CASE WHEN created_at >= $hourStart AND audio_seconds > 0 THEN created_at END) AS first_audio_at_hour,
      MIN(CASE WHEN audio_seconds > 0 THEN created_at END) AS first_audio_at_day
    FROM request_metrics
    WHERE created_at >= $dayStart
      AND provider IS NOT NULL
      AND provider <> ''
      AND model IS NOT NULL
      AND model <> ''
      AND LOWER(provider) || '/' || model IN (${placeholders.clause})
    GROUP BY LOWER(provider) || '/' || model
  `).all({
    ...placeholders.params,
    $minuteStart: minuteStart,
    $hourStart: hourStart,
    $dayStart: dayStart,
  }) as Array<{
    scope_id: string;
    requests_last_minute: number | null;
    requests_last_day: number | null;
    tokens_last_minute: number | null;
    tokens_last_day: number | null;
    audio_seconds_last_hour: number | null;
    audio_seconds_last_day: number | null;
    first_request_at_minute: number | null;
    first_request_at_day: number | null;
    first_token_at_minute: number | null;
    first_token_at_day: number | null;
    first_audio_at_hour: number | null;
    first_audio_at_day: number | null;
  }>;

  const result = new Map<string, UsageWindowSnapshot>();
  for (const id of normalizedIds) {
    result.set(id, emptyUsageSnapshot());
  }
  for (const row of rows) {
    result.set(row.scope_id, usageRowToSnapshot(row));
  }
  return result;
}

export function recordRequestMetric(input: RequestMetricInput): void {
  db.query(`
    INSERT INTO request_metrics (
      id, user_id, api_key_id, project_id, method, path, request_type, provider, model, status_code,
      duration_ms, prompt_tokens, completion_tokens, total_tokens, audio_seconds, error_message,
      source_ip, usage_source, created_at
    )
    VALUES (
      $id, $userId, $apiKeyId, $projectId, $method, $path, $requestType, $provider, $model, $statusCode,
      $durationMs, $promptTokens, $completionTokens, $totalTokens, $audioSeconds, $errorMessage,
      $sourceIp, $usageSource, $createdAt
    )
  `).run({
    $id: input.id,
    $userId: input.userId ?? null,
    $apiKeyId: input.apiKeyId ?? null,
    $projectId: input.projectId ?? null,
    $method: input.method,
    $path: input.path,
    $requestType: input.requestType,
    $provider: input.provider ?? null,
    $model: input.model ?? null,
    $statusCode: input.statusCode,
    $durationMs: input.durationMs,
    $promptTokens: input.promptTokens ?? 0,
    $completionTokens: input.completionTokens ?? 0,
    $totalTokens: input.totalTokens ?? 0,
    $audioSeconds: input.audioSeconds ?? 0,
    $errorMessage: input.errorMessage ?? null,
    $sourceIp: input.sourceIp ?? null,
    $usageSource: input.usageSource ?? 'estimated',
    $createdAt: input.createdAt ?? Date.now(),
  });
}

export function checkAndIncrementRequestRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
): RequestRateLimitResult {
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindowMs = Math.max(1_000, Math.floor(windowMs));
  const now = Date.now();

  // Bug fix #1: use a deterministic call counter instead of `now % 25 === 0`.
  // The timestamp modulo trick only fires ~4% of the time by luck; the counter
  // fires exactly once every 25 calls.
  _rateLimitCallCount = (_rateLimitCallCount + 1) % 25;
  const shouldCleanup = _rateLimitCallCount === 0;

  try {
    return db.transaction(() => {
      const row = getRequestRateLimitBucket.get({ $bucketKey: bucketKey }) as {
        count: number;
        reset_at: number;
      } | null;

      // Bug fix #2: run cleanup INSIDE the transaction so it can never delete a
      // bucket that was written in this same call (the previous code ran the
      // delete after the transaction closed, creating a tiny race window).
      if (shouldCleanup) {
        deleteExpiredRequestRateLimitBuckets.run({ $now: now });
      }

      if (!row || row.reset_at <= now) {
        const resetAt = now + safeWindowMs;
        upsertRequestRateLimitBucket.run({
          $bucketKey: bucketKey,
          $count: 1,
          $resetAt: resetAt,
          $updatedAt: now,
        });

        return {
          limited: false,
          limit: safeLimit,
          remaining: Math.max(0, safeLimit - 1),
          resetAt,
        } satisfies RequestRateLimitResult;
      }

      if (row.count >= safeLimit) {
        return {
          limited: true,
          limit: safeLimit,
          remaining: 0,
          resetAt: row.reset_at,
        } satisfies RequestRateLimitResult;
      }

      const nextCount = row.count + 1;
      upsertRequestRateLimitBucket.run({
        $bucketKey: bucketKey,
        $count: nextCount,
        $resetAt: row.reset_at,
        $updatedAt: now,
      });

      return {
        limited: false,
        limit: safeLimit,
        remaining: Math.max(0, safeLimit - nextCount),
        resetAt: row.reset_at,
      } satisfies RequestRateLimitResult;
    })();
  } catch (err) {
    // Bug fix #3: fail-open on DB errors instead of crashing the request.
    // A rate-limit DB failure should not take down the API; log and let through.
    import('../utils/logger').then(({ logger }) => {
      logger.error({ err, bucketKey }, 'rate-limit: DB error, failing open');
    });
    return {
      limited: false,
      limit: safeLimit,
      remaining: safeLimit,
      resetAt: now + safeWindowMs,
    };
  }
}
export function getTokenSummary(scope?: RequestMetricsScope): TokenSummary {
  const range = getMonthRange();
  const userScope = buildRequestMetricsUserScope(scope);
  const row = db.query(`
    SELECT
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM request_metrics
    WHERE created_at >= $start AND created_at < $end${userScope.clause}
  `).get({
    $start: range.start,
    $end: range.end,
    ...userScope.params,
  }) as {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  } | null;

  const currentMonthPromptTokens = Math.max(0, Math.floor(row?.prompt_tokens ?? 0));
  const currentMonthCompletionTokens = Math.max(0, Math.floor(row?.completion_tokens ?? 0));
  const currentMonthTokens = Math.max(0, Math.floor(row?.total_tokens ?? 0));
  const projectedMonthPromptTokens = Math.max(
    0,
    Math.floor(
      range.dayOfMonth > 0
        ? (currentMonthPromptTokens / range.dayOfMonth) * range.daysInMonth
        : currentMonthPromptTokens,
    ),
  );
  const projectedMonthCompletionTokens = Math.max(
    0,
    Math.floor(
      range.dayOfMonth > 0
        ? (currentMonthCompletionTokens / range.dayOfMonth) * range.daysInMonth
        : currentMonthCompletionTokens,
    ),
  );
  const projectedMonthTokens = Math.max(
    0,
    Math.floor(
      range.dayOfMonth > 0
        ? (currentMonthTokens / range.dayOfMonth) * range.daysInMonth
        : currentMonthTokens,
    ),
  );

  return {
    currentMonthTokens,
    projectedMonthTokens,
    currentMonthPromptTokens,
    projectedMonthPromptTokens,
    currentMonthCompletionTokens,
    projectedMonthCompletionTokens,
  };
}

export function getRecentErrors(limit: number = 15, scope?: RequestMetricsScope): RecentMetric[] {
  const userScope = buildRequestMetricsUserScope(scope);
  const rows = db.query(`
    SELECT
      method,
      path,
      request_type,
      LOWER(provider) AS provider,
      model,
      status_code,
      duration_ms,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      error_message,
      created_at
    FROM request_metrics
    WHERE status_code >= 400
      ${userScope.clause}
    ORDER BY created_at DESC
    LIMIT $limit
  `).all({
    $limit: limit,
    ...userScope.params,
  }) as Array<{
    method: string;
    path: string;
    request_type: string;
    provider: string | null;
    model: string | null;
    status_code: number;
    duration_ms: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    error_message: string | null;
    created_at: number;
  }>;

  return rows.map((row) => ({
    method: row.method,
    path: row.path,
    requestType: row.request_type,
    provider: row.provider,
    model: row.model,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    promptTokens: row.prompt_tokens ?? 0,
    completionTokens: row.completion_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }));
}

export function getUserUsageSummaries(scope?: RequestMetricsScope): UsageSummary[] {
  const range = getMonthRange();
  const userWhere = scope?.userId?.trim()
    ? 'WHERE u.id = $scopeUserId'
    : '';
  const rows = db.query(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.monthly_request_quota,
      COUNT(r.id) AS request_count,
      COALESCE(SUM(r.prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(r.completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(r.total_tokens), 0) AS total_tokens
    FROM users u
    LEFT JOIN request_metrics r
      ON r.user_id = u.id
      AND r.created_at >= $start
      AND r.created_at < $end
    ${userWhere}
    GROUP BY u.id
    ORDER BY total_tokens DESC, request_count DESC, u.created_at ASC
  `).all({
    $start: range.start,
    $end: range.end,
    ...(scope?.userId?.trim() ? { $scopeUserId: scope.userId.trim() } : {}),
  }) as Array<{
    id: string;
    name: string;
    email: string;
    monthly_request_quota: number | null;
    request_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    requestCount: row.request_count,
    promptTokens: row.prompt_tokens ?? 0,
    completionTokens: row.completion_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
    monthlyRequestQuota: row.monthly_request_quota,
    status: computeUsageStatus(row.request_count, row.monthly_request_quota),
  }));
}

export function getProjectUsageSummaries(scope?: RequestMetricsScope): UsageSummary[] {
  const range = getMonthRange();
  const userScope = buildRequestMetricsUserScope(scope, 'r.user_id');
  const projectFilter = buildVisibleProjectFilter(scope);
  const rows = db.query(`
    SELECT
      p.id,
      p.name,
      p.request_quota_monthly,
      COUNT(r.id) AS request_count,
      COALESCE(SUM(r.prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(r.completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(r.total_tokens), 0) AS total_tokens
    FROM projects p
    LEFT JOIN request_metrics r
      ON r.project_id = p.id
      AND r.created_at >= $start
      AND r.created_at < $end
      ${userScope.clause}
    WHERE 1 = 1${projectFilter.clause}
    GROUP BY p.id
    ORDER BY total_tokens DESC, request_count DESC, p.created_at ASC
  `).all({
    $start: range.start,
    $end: range.end,
    ...userScope.params,
    ...projectFilter.params,
  }) as Array<{
    id: string;
    name: string;
    request_quota_monthly: number | null;
    request_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    requestCount: row.request_count,
    promptTokens: row.prompt_tokens ?? 0,
    completionTokens: row.completion_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
    monthlyRequestQuota: row.request_quota_monthly,
    status: computeUsageStatus(row.request_count, row.request_quota_monthly),
  }));
}

export function getDashboardMetrics(scope?: RequestMetricsScope): DashboardMetrics {
  const now = Date.now();
  const fourteenDaysAgo = now - (13 * 24 * 60 * 60 * 1000);
  const userScope = buildRequestMetricsUserScope(scope);
  const totalsRow = scope?.userId?.trim()
    ? null
    : db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_active = 1) AS users,
        (SELECT COUNT(*) FROM user_api_keys WHERE is_active = 1) AS user_api_keys,
        (SELECT COUNT(*) FROM service_api_keys WHERE is_active = 1) AS service_api_keys,
        (SELECT COUNT(*) FROM projects WHERE is_active = 1) AS projects,
        (SELECT COUNT(*) FROM request_metrics) AS requests
    `).get() as {
      users: number;
      user_api_keys: number;
      service_api_keys: number;
      projects: number;
      requests: number;
    } | null;

  const providerRows = db.query(`
    SELECT
      LOWER(provider) AS provider,
      COUNT(*) AS total_requests,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      SUM(CASE WHEN status_code BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
      ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
      MAX(created_at) AS last_request_at
    FROM request_metrics
    WHERE provider IS NOT NULL AND provider <> ''${userScope.clause}
    GROUP BY LOWER(provider)
    ORDER BY total_requests DESC, LOWER(provider) ASC
  `).all({
    ...userScope.params,
  }) as {
    provider: string;
    total_requests: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    success_count: number;
    error_count: number;
    avg_duration_ms: number | null;
    last_request_at: number | null;
  }[];

  const modelRows = db.query(`
    SELECT
      LOWER(provider) AS provider,
      model,
      COUNT(*) AS total_requests,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      SUM(CASE WHEN status_code BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
      ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
      MAX(created_at) AS last_request_at
    FROM request_metrics
    WHERE provider IS NOT NULL AND provider <> '' AND model IS NOT NULL AND model <> ''${userScope.clause}
    GROUP BY LOWER(provider), model
    ORDER BY total_requests DESC, LOWER(provider) ASC, model ASC
    LIMIT 100
  `).all({
    ...userScope.params,
  }) as {
    provider: string;
    model: string;
    total_requests: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    success_count: number;
    error_count: number;
    avg_duration_ms: number | null;
    last_request_at: number | null;
  }[];

  const recentRows = db.query(`
    SELECT
      method,
      path,
      request_type,
      LOWER(provider) AS provider,
      model,
      status_code,
      duration_ms,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      error_message,
      created_at
    FROM request_metrics
    WHERE 1 = 1${userScope.clause}
    ORDER BY created_at DESC
    LIMIT 25
  `).all({
    ...userScope.params,
  }) as {
    method: string;
    path: string;
    request_type: string;
    provider: string | null;
    model: string | null;
    status_code: number;
    duration_ms: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    error_message: string | null;
    created_at: number;
  }[];

  const dailyRows = db.query(`
    SELECT
      strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS bucket,
      COUNT(*) AS request_count,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      SUM(CASE WHEN status_code BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
      ROUND(AVG(duration_ms), 1) AS avg_duration_ms
    FROM request_metrics
    WHERE created_at >= $start${userScope.clause}
    GROUP BY strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime')
    ORDER BY bucket ASC
  `).all({
    $start: fourteenDaysAgo,
    ...userScope.params,
  }) as Array<{
    bucket: string;
    request_count: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    success_count: number | null;
    error_count: number | null;
    avg_duration_ms: number | null;
  }>;

  const requestTypeRows = db.query(`
    SELECT
      request_type,
      COUNT(*) AS request_count,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      ROUND(AVG(duration_ms), 1) AS avg_duration_ms
    FROM request_metrics
    WHERE 1 = 1${userScope.clause}
    GROUP BY request_type
    ORDER BY total_tokens DESC, request_count DESC, request_type ASC
  `).all({
    ...userScope.params,
  }) as Array<{
    request_type: string;
    request_count: number;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    avg_duration_ms: number | null;
  }>;

  const summaryRow = db.query(`
    SELECT
      COUNT(*) AS request_count,
      SUM(CASE WHEN status_code BETWEEN 200 AND 399 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
      ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(total_tokens), 0) AS total_tokens
    FROM request_metrics
    WHERE 1 = 1${userScope.clause}
  `).get({
    ...userScope.params,
  }) as {
    request_count: number | null;
    success_count: number | null;
    error_count: number | null;
    avg_duration_ms: number | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  } | null;

  const requestCount = summaryRow?.request_count ?? 0;
  const successCount = summaryRow?.success_count ?? 0;
  const errorCount = summaryRow?.error_count ?? 0;
  const scopedUserId = scope?.userId?.trim() || null;
  const visibleProjectIds = normalizeVisibleProjectIds(scope?.visibleProjectIds);
  const scopedApiKeyCount = scopedUserId
    ? listApiKeysForUser(scopedUserId).filter((apiKey) => apiKey.isActive).length
    : 0;

  return {
    totals: {
      users: scopedUserId ? 1 : (totalsRow?.users ?? 0),
      userApiKeys: scopedUserId ? scopedApiKeyCount : (totalsRow?.user_api_keys ?? 0),
      serviceApiKeys: scopedUserId ? 0 : (totalsRow?.service_api_keys ?? 0),
      projects: scopedUserId ? visibleProjectIds.length : (totalsRow?.projects ?? 0),
      requests: scopedUserId ? requestCount : (totalsRow?.requests ?? 0),
    },
    providers: providerRows.map((row) => ({
      provider: row.provider,
      totalRequests: row.total_requests,
      promptTokens: row.prompt_tokens ?? 0,
      completionTokens: row.completion_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      successCount: row.success_count ?? 0,
      errorCount: row.error_count ?? 0,
      avgDurationMs: row.avg_duration_ms ?? 0,
      lastRequestAt: row.last_request_at,
    })),
    models: modelRows.map((row) => ({
      provider: row.provider,
      model: row.model,
      totalRequests: row.total_requests,
      promptTokens: row.prompt_tokens ?? 0,
      completionTokens: row.completion_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      successCount: row.success_count ?? 0,
      errorCount: row.error_count ?? 0,
      avgDurationMs: row.avg_duration_ms ?? 0,
      lastRequestAt: row.last_request_at,
    })),
    recent: recentRows.map((row) => ({
      method: row.method,
      path: row.path,
      requestType: row.request_type,
      provider: row.provider,
      model: row.model,
      statusCode: row.status_code,
      durationMs: row.duration_ms,
      promptTokens: row.prompt_tokens ?? 0,
      completionTokens: row.completion_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })),
    daily: dailyRows.map((row) => ({
      bucket: row.bucket,
      requestCount: row.request_count,
      promptTokens: row.prompt_tokens ?? 0,
      completionTokens: row.completion_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      successCount: row.success_count ?? 0,
      errorCount: row.error_count ?? 0,
      avgDurationMs: row.avg_duration_ms ?? 0,
    })),
    requestTypes: requestTypeRows.map((row) => ({
      requestType: row.request_type,
      requestCount: row.request_count,
      promptTokens: row.prompt_tokens ?? 0,
      completionTokens: row.completion_tokens ?? 0,
      totalTokens: row.total_tokens ?? 0,
      avgDurationMs: row.avg_duration_ms ?? 0,
    })),
    summary: {
      requestCount,
      successCount,
      errorCount,
      successRate: requestCount > 0 ? Number(((successCount / requestCount) * 100).toFixed(1)) : 0,
      avgDurationMs: summaryRow?.avg_duration_ms ?? 0,
      promptTokens: summaryRow?.prompt_tokens ?? 0,
      completionTokens: summaryRow?.completion_tokens ?? 0,
      totalTokens: summaryRow?.total_tokens ?? 0,
    },
  };
}

// ─── Model Tier Overrides ─────────────────────────────────────────────────────

export interface ModelTierOverride {
  modelId: string;
  tier: 1 | 2 | 3;
  updatedAt: number;
}

export function listModelTierOverrides(): ModelTierOverride[] {
  return (db.query(
    'SELECT model_id, tier, updated_at FROM model_tier_overrides ORDER BY model_id ASC',
  ).all() as Array<{ model_id: string; tier: number; updated_at: number }>).map((row) => ({
    modelId: row.model_id,
    tier: row.tier as 1 | 2 | 3,
    updatedAt: row.updated_at,
  }));
}

export function getModelTierOverridesMap(): Map<string, 1 | 2 | 3> {
  const rows = db.query(
    'SELECT model_id, tier FROM model_tier_overrides',
  ).all() as Array<{ model_id: string; tier: number }>;
  return new Map(rows.map((row) => [row.model_id, row.tier as 1 | 2 | 3]));
}

export function upsertModelTierOverride(modelId: string, tier: 1 | 2 | 3): void {
  db.query(`
    INSERT INTO model_tier_overrides (model_id, tier, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      tier = excluded.tier,
      updated_at = excluded.updated_at
  `).run(modelId, tier, Date.now());
}

export function deleteModelTierOverride(modelId: string): boolean {
  const result = db.query(
    'DELETE FROM model_tier_overrides WHERE model_id = ?',
  ).run(modelId);
  return result.changes > 0;
}

// ─── Model Aliases (simple compatibility aliases) ───────────────────────────

export type ModelAliasCategory = 'chat' | 'images' | 'imageEdit' | 'videos';

export interface ModelAlias {
  alias: string;
  targetModel: string;
  category: ModelAliasCategory;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS model_aliases (
    alias TEXT PRIMARY KEY,
    target_model TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

// Migrate table to support categories and per-category uniqueness
db.exec(`
  CREATE TABLE IF NOT EXISTS model_aliases_v2 (
    alias TEXT NOT NULL,
    target_model TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'chat',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (alias, category)
  );
`);

const modelAliasesTableInfo = db.query('PRAGMA table_info(model_aliases)').all() as Array<{ name: string; pk: number }>;
const modelAliasesNeedsCategoryMigration = !modelAliasesTableInfo.some((column) => column.name === 'category');
const modelAliasesNeedsCompositePrimaryKey = modelAliasesTableInfo.filter((column) => column.pk > 0).length < 2;

if (modelAliasesNeedsCategoryMigration || modelAliasesNeedsCompositePrimaryKey) {
  db.exec(modelAliasesNeedsCategoryMigration
    ? `
      INSERT OR IGNORE INTO model_aliases_v2 (alias, target_model, category, is_active, created_at, updated_at)
      SELECT alias, target_model, 'chat', is_active, created_at, updated_at
      FROM model_aliases;
    `
    : `
      INSERT OR IGNORE INTO model_aliases_v2 (alias, target_model, category, is_active, created_at, updated_at)
      SELECT alias, target_model, category, is_active, created_at, updated_at
      FROM model_aliases;
    `);

  db.exec('DROP TABLE IF EXISTS model_aliases;');
  db.exec('ALTER TABLE model_aliases_v2 RENAME TO model_aliases;');
} else {
  db.exec('DROP TABLE IF EXISTS model_aliases_v2;');
}

export function listModelAliases(): ModelAlias[] {
  return (db.query(
    'SELECT alias, target_model, category, is_active, created_at, updated_at FROM model_aliases ORDER BY alias ASC',
  ).all() as Array<{ alias: string; target_model: string; category: string; is_active: number; created_at: number; updated_at: number }>).map((row) => ({
    alias: row.alias,
    targetModel: row.target_model,
    category: row.category as ModelAliasCategory,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// Get alias map for a specific category (chat, images, imageEdit, videos)
export function getModelAliasMapByCategory(category: ModelAliasCategory): Map<string, string> {
  const rows = db.query(
    'SELECT alias, target_model, is_active, category FROM model_aliases WHERE is_active = 1 AND category = $category',
  ).all({ $category: category }) as Array<{ alias: string; target_model: string; category: string; is_active: number }>;
  return new Map(rows.map((row) => [row.alias, row.target_model]));
}

// Legacy: Get all chat aliases (backward compatibility)
export function getModelAliasMap(): Map<string, string> {
  return getModelAliasMapByCategory('chat');
}

// Legacy: Resolve chat alias (backward compatibility)
export function resolveModelAlias(modelName: string): string | null {
  return resolveModelAliasByCategory(modelName, 'chat');
}

// Resolve alias by category
export function resolveModelAliasByCategory(modelName: string, category: ModelAliasCategory): string | null {
  const normalizedAlias = modelName.trim().toLowerCase();
  const row = db.query(
    'SELECT target_model FROM model_aliases WHERE alias = $alias AND is_active = 1 AND category = $category LIMIT 1',
  ).get({ $alias: normalizedAlias, $category: category }) as { target_model: string } | null;
  return row?.target_model ?? null;
}

export function upsertModelAlias(alias: string, targetModel: string, category: ModelAliasCategory = 'chat'): ModelAlias {
  const now = Date.now();
  // Ensure category is valid
  const validCategory = ['chat', 'images', 'imageEdit', 'videos'].includes(category) ? category : 'chat';
  
  db.query(`
    INSERT INTO model_aliases (alias, target_model, category, is_active, created_at, updated_at)
    VALUES ($alias, $targetModel, $category, 1, $now, $now)
    ON CONFLICT(alias, category) DO UPDATE SET
      target_model = excluded.target_model,
      category = excluded.category,
      is_active = 1,
      updated_at = excluded.updated_at
  `).run({
    $alias: alias.trim().toLowerCase(),
    $targetModel: targetModel.trim(),
    $category: validCategory,
    $now: now,
  });

  const row = db.query(
    'SELECT alias, target_model, category, is_active, created_at, updated_at FROM model_aliases WHERE alias = $alias AND category = $category',
  ).get({ $alias: alias.trim().toLowerCase(), $category: validCategory }) as { alias: string; target_model: string; category: string; is_active: number; created_at: number; updated_at: number } | null;

  if (!row) {
    throw new Error('Failed to create/update model alias');
  }

  return {
    alias: row.alias,
    targetModel: row.target_model,
    category: row.category as ModelAliasCategory,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteModelAlias(alias: string, category: ModelAliasCategory): boolean {
  const result = db.query(
    'DELETE FROM model_aliases WHERE alias = $alias AND category = $category',
  ).run({ $alias: alias.trim().toLowerCase(), $category: category });
  return result.changes > 0;
}
