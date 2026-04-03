import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AIService } from '../types';

const tempDir = path.join(process.cwd(), '.tmp');
const dbPath = path.join(tempDir, 'router.test.sqlite');

mkdirSync(tempDir, { recursive: true });

function cleanupDbArtifacts(ignoreBusy: boolean): void {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (!ignoreBusy || (code !== 'EBUSY' && code !== 'EPERM')) {
        throw err;
      }
    }
  }
}

cleanupDbArtifacts(false);

process.env.NODE_ENV = 'test';
process.env.ROUTER_DB_PATH = dbPath;
process.env.ROUTER_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { appFetch } = await import('../index.ts');
const { db, updateAppSettings } = await import('../core/db.ts');
const { replacePoolStates } = await import('../core/pool.ts');
const { estimateTextTokens, estimateMessageTokens } = await import('../core/tokenizer.ts');
const { encryptSecret, __resetMasterKeyCacheForTests } = await import('../utils/crypto.ts');

const requestServer = {
  requestIP() {
    return { address: '127.0.0.1' };
  },
};

const defaultSettings = {
  appName: 'VagaRoute AI',
  sessionTimeoutMinutes: 480,
  defaultApiKeyRateLimit: 120,
  anonymousRateLimitPerMinute: 45,
  allowedOrigins: 'https://allowed.example',
  defaultChatModel: 'auto',
  enableUserKeyCreation: true,
  openRouterFreeOnly: false,
};

function resetDatabase(): void {
  db.exec(`
    DELETE FROM request_rate_limit_buckets;
    DELETE FROM request_metrics;
    DELETE FROM response_cache_entries;
    DELETE FROM response_cache_stats;
    DELETE FROM invitation_tokens;
    DELETE FROM password_reset_tokens;
    DELETE FROM sessions;
    DELETE FROM user_api_keys;
    DELETE FROM service_api_keys;
    DELETE FROM project_members;
    DELETE FROM projects;
    DELETE FROM users;
    DELETE FROM custom_providers;
    DELETE FROM rate_limit_rules;
    DELETE FROM provider_stats;
    DELETE FROM model_stats;
    DELETE FROM app_settings;
  `);
  updateAppSettings(defaultSettings);
  replacePoolStates([]);
}

function buildMockState(service: AIService) {
  return {
    service,
    cooldownUntil: 0,
    disabled: false,
    paidOnly: false,
    tier: 1,
  };
}

function createSuccessService(
  name = 'Mock/echo',
  options: {
    onCall?: () => void;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  } = {},
): AIService {
  return {
    name,
    supportsTools: true,
    supportsVision: true,
    async chat(_request, id) {
      options.onCall?.();
      const usage = options.usage ?? {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      };
      return (async function* () {
        yield `data: ${JSON.stringify({
          id,
          model: name,
          choices: [{ index: 0, delta: { content: 'pong' }, finish_reason: 'stop' }],
        })}\n\n`;
        yield `data: ${JSON.stringify({
          id,
          model: name,
          choices: [],
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens,
          },
        })}\n\n`;
        yield 'data: [DONE]\n\n';
      })();
    },
  };
}

function createRateLimitedService(name = 'Mock/ratelimited'): AIService {
  return {
    name,
    supportsTools: true,
    async chat() {
      throw Object.assign(new Error('Too many requests'), {
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
      });
    },
  };
}

async function request(
  pathname: string,
  init: RequestInit & { origin?: string; json?: unknown } = {},
): Promise<Response> {
  const { origin, json, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);

  if (origin) {
    headers.set('Origin', origin);
  }

  let body = requestInit.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  return appFetch(new Request(`http://localhost${pathname}`, {
    ...requestInit,
    headers,
    body,
  }), requestServer);
}

function getSessionCookie(response: Response): string {
  const rawCookie = response.headers.get('set-cookie');
  if (!rawCookie) {
    throw new Error('Missing session cookie');
  }

  return rawCookie.split(';')[0] ?? rawCookie;
}

async function bootstrapAdmin() {
  const response = await request('/api/bootstrap', {
    method: 'POST',
    origin: 'https://allowed.example',
    json: {
      name: 'Admin',
      email: 'admin@example.com',
      password: 'password123',
    },
  });

  expect(response.status).toBe(201);

  return {
    response,
    cookie: getSessionCookie(response),
    body: await response.json() as {
      rawApiKey: string;
      user: { id: string; email: string; role: string };
    },
  };
}

async function loginWithPassword(email: string, password: string) {
  const response = await request('/api/login', {
    method: 'POST',
    origin: 'https://allowed.example',
    json: {
      email,
      password,
    },
  });

  return {
    response,
    cookie: response.status === 200 ? getSessionCookie(response) : null,
  };
}

async function getDashboard(cookie: string) {
  const response = await request('/api/dashboard', {
    headers: {
      Cookie: cookie,
    },
  });

  expect(response.status).toBe(200);
  return await response.json() as {
    auth: { isAdmin: boolean };
    spend: { currentMonthUsd: number; projectedMonthUsd: number };
    tokens: {
      currentMonthTokens: number;
      projectedMonthTokens: number;
      currentMonthPromptTokens: number;
      projectedMonthPromptTokens: number;
      currentMonthCompletionTokens: number;
      projectedMonthCompletionTokens: number;
    };
    alerts: Array<{ title: string; severity: string }>;
    recentErrors: Array<{ path: string; statusCode: number; errorMessage: string | null }>;
    modelTelemetry: Array<{ id: string; requests_served: number }>;
    cache: { enabled: boolean; backend: string; hits: number; misses: number; entries: number; hitRate: number };
    tokenization: { mode: string; exactForCompletedResponses: boolean };
    metrics: {
      totals: { requests: number; users: number; projects: number; serviceApiKeys: number; userApiKeys: number };
      providers: Array<{ provider: string; totalCostUsd: number; totalTokens: number; promptTokens: number; completionTokens: number }>;
      models: Array<{ model: string; totalCostUsd: number; totalTokens: number; promptTokens: number; completionTokens: number }>;
      recent: Array<{ estimatedCostUsd: number; totalTokens: number; promptTokens: number; completionTokens: number }>;
      daily: Array<{ bucket: string; totalTokens: number; promptTokens: number; completionTokens: number; requestCount: number }>;
      requestTypes: Array<{ requestType: string; totalTokens: number; promptTokens: number; completionTokens: number }>;
      summary: { requestCount: number; totalTokens: number; promptTokens: number; completionTokens: number; successRate: number };
    };
    projects: Array<{ id: string; name: string; role?: string }>;
    userUsage: Array<{ id: string; status: string; requestCount: number; totalTokens: number; promptTokens: number; completionTokens: number }>;
    projectUsage: Array<{ id: string; status: string; requestCount: number; totalTokens: number; promptTokens: number; completionTokens: number }>;
  };
}

beforeEach(() => {
  resetDatabase();
});

afterAll(() => {
  db.close();
  cleanupDbArtifacts(true);
});

describe('auth', () => {
  test('bootstraps, logs in through /api/login, and resolves the session identity', async () => {
    const bootstrap = await bootstrapAdmin();
    expect(bootstrap.response.headers.get('x-request-id')).toBeTruthy();

    const loginResponse = await request('/api/login', {
      method: 'POST',
      origin: 'https://allowed.example',
      json: {
        email: 'admin@example.com',
        password: 'password123',
      },
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get('access-control-allow-origin')).toBe('https://allowed.example');

    const meResponse = await request('/api/auth/me', {
      method: 'GET',
      headers: {
        Cookie: getSessionCookie(loginResponse),
      },
    });

    expect(meResponse.status).toBe(200);
    expect(meResponse.headers.get('x-request-id')).toBeTruthy();

    const payload = await meResponse.json() as {
      via: string;
      isAdmin: boolean;
      user: { email: string };
    };

    expect(payload.via).toBe('session');
    expect(payload.isAdmin).toBe(true);
    expect(payload.user.email).toBe('admin@example.com');
  });

  test('marks session cookies as Secure when TLS is forwarded by a proxy', async () => {
    const response = await request('/api/bootstrap', {
      method: 'POST',
      origin: 'https://allowed.example',
      headers: {
        'X-Forwarded-Proto': 'https',
      },
      json: {
        name: 'Admin',
        email: 'admin@example.com',
        password: 'password123',
      },
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  test('rejects protected routes without authentication', async () => {
    const response = await request('/v1/models');
    expect(response.status).toBe(401);
  });
});

describe('api keys', () => {
  test('creates additional API keys and authenticates model listing with Bearer auth', async () => {
    const bootstrap = await bootstrapAdmin();

    const createKeyResponse = await request('/api/api-keys', {
      method: 'POST',
      headers: {
        Cookie: bootstrap.cookie,
      },
      json: {
        name: 'CI Key',
      },
    });

    expect(createKeyResponse.status).toBe(201);

    const keyPayload = await createKeyResponse.json() as {
      rawApiKey: string;
    };

    const modelsResponse = await request('/v1/models', {
      headers: {
        Authorization: `Bearer ${keyPayload.rawApiKey}`,
      },
    });

    expect(modelsResponse.status).toBe(200);

    const modelsPayload = await modelsResponse.json() as {
      object: string;
      data: Array<{ id: string }>;
    };

    expect(modelsPayload.object).toBe('list');
    expect(modelsPayload.data.some((model) => model.id === 'auto')).toBe(true);
  });
});

describe('rate limits', () => {
  test('persists anonymous and API key rate limits through SQLite buckets', async () => {
    await bootstrapAdmin();
    db.exec('DELETE FROM request_rate_limit_buckets;');
    updateAppSettings({
      ...defaultSettings,
      anonymousRateLimitPerMinute: 1,
    });

    const firstLogin = await request('/api/login', {
      method: 'POST',
      json: {
        email: 'admin@example.com',
        password: 'wrong-password',
      },
    });
    expect(firstLogin.status).toBe(401);

    const secondLogin = await request('/api/login', {
      method: 'POST',
      json: {
        email: 'admin@example.com',
        password: 'wrong-password',
      },
    });
    expect(secondLogin.status).toBe(429);
    expect(secondLogin.headers.get('retry-after')).toBeTruthy();

    const bucketsRow = db.query(`
      SELECT COUNT(*) AS count
      FROM request_rate_limit_buckets
    `).get() as { count: number } | null;
    expect((bucketsRow?.count ?? 0) > 0).toBe(true);
  });

  test('limits authenticated model requests after the configured threshold', async () => {
    updateAppSettings({
      ...defaultSettings,
      defaultApiKeyRateLimit: 1,
    });

    const bootstrap = await bootstrapAdmin();

    const firstModels = await request('/v1/models', {
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
    });
    expect(firstModels.status).toBe(200);

    const secondModels = await request('/v1/models', {
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
    });
    expect(secondModels.status).toBe(429);
    expect(secondModels.headers.get('retry-after')).toBeTruthy();
  });
});

describe('cors and routing', () => {
  test('rejects origins outside the allow-list', async () => {
    const allowed = await request('/health', {
      origin: 'https://allowed.example',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://allowed.example');

    const rejected = await request('/health', {
      origin: 'https://evil.example',
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('routes /chat to the same chat completion flow', async () => {
    const bootstrap = await bootstrapAdmin();
    replacePoolStates([buildMockState(createSuccessService('Mock/router'))]);

    const response = await request('/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
      json: {
        model: 'Mock/router',
        stream: false,
        messages: [{ role: 'user', content: 'hola' }],
      },
    });

    expect(response.status).toBe(200);

    const payload = await response.json() as {
      model: string;
      choices: Array<{ message: { content: string } }>;
    };

    expect(payload.model).toBe('Mock/router');
    expect(payload.choices[0]?.message.content).toBe('pong');
  });

  test('does not serve files outside public even if the path shares the public prefix', async () => {
    const canaryPath = path.join(process.cwd(), 'public-canary.txt');
    writeFileSync(canaryPath, 'leak-through-public-prefix', 'utf8');

    try {
      const response = await request('/../public-canary.txt', {
        method: 'GET',
        origin: 'https://allowed.example',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).not.toContain('leak-through-public-prefix');
    } finally {
      rmSync(canaryPath, { force: true });
    }
  });
});

describe('cooldown', () => {
  test('moves a failing model into cooldown and surfaces 429 on the next request', async () => {
    const bootstrap = await bootstrapAdmin();
    replacePoolStates([buildMockState(createRateLimitedService())]);

    const firstAttempt = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
      json: {
        model: 'Mock/ratelimited',
        stream: false,
        messages: [{ role: 'user', content: 'hola' }],
      },
    });
    expect(firstAttempt.status).toBe(429);

    const secondAttempt = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
      json: {
        model: 'Mock/ratelimited',
        stream: false,
        messages: [{ role: 'user', content: 'hola otra vez' }],
      },
    });

    expect(secondAttempt.status).toBe(429);

    const secondPayload = await secondAttempt.json() as {
      error: { type: string };
    };

    expect(secondPayload.error.type).toBe('rate_limit_exceeded');

    const modelsResponse = await request('/v1/models', {
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
    });
    const modelsPayload = await modelsResponse.json() as {
      data: Array<{ id: string; status: string }>;
    };
    const rateLimitedModel = modelsPayload.data.find((model) => model.id === 'Mock/ratelimited');

    expect(rateLimitedModel?.status).toBe('cooldown');
  });
});

describe('projects and product flows', () => {
  test('creates project invitations, accepts them, and preserves the invited role', async () => {
    const admin = await bootstrapAdmin();

    const createProjectResponse = await request('/api/projects', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        name: 'Proyecto Growth',
        description: 'Equipo de growth',
        requestQuotaMonthly: 25,
        budgetMonthlyUsd: 10,
      },
    });
    expect(createProjectResponse.status).toBe(201);

    const projectPayload = await createProjectResponse.json() as {
      project: { id: string; name: string };
    };

    const inviteResponse = await request('/api/invitations', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        email: 'growth@example.com',
        projectId: projectPayload.project.id,
        role: 'owner',
        expiresHours: 12,
      },
    });
    expect(inviteResponse.status).toBe(201);

    const invitePayload = await inviteResponse.json() as {
      invitation: { projectId: string; role: string };
      inviteUrl: string;
    };
    expect(invitePayload.invitation.role).toBe('owner');

    const inviteToken = new URL(invitePayload.inviteUrl).searchParams.get('invite');
    expect(inviteToken).toBeTruthy();

    const previewResponse = await request(`/api/invitations/${encodeURIComponent(inviteToken || '')}`, {
      method: 'GET',
      origin: 'https://allowed.example',
    });
    expect(previewResponse.status).toBe(200);

    const previewPayload = await previewResponse.json() as {
      invitation: { projectId: string | null; projectName?: string | null };
    };
    expect(previewPayload.invitation.projectId).toBe(projectPayload.project.id);
    expect(previewPayload.invitation.projectName).toBe('Proyecto Growth');

    const acceptResponse = await request('/api/invitations/accept', {
      method: 'POST',
      origin: 'https://allowed.example',
      json: {
        token: inviteToken,
        name: 'Growth User',
        password: 'password123',
      },
    });
    expect(acceptResponse.status).toBe(201);

    const acceptedCookie = getSessionCookie(acceptResponse);
    const acceptedDashboard = await getDashboard(acceptedCookie);
    const invitedProject = acceptedDashboard.projects.find((project) => project.id === projectPayload.project.id);

    expect(invitedProject?.role).toBe('owner');
  });

  test('tracks user and project quotas, spend, tokens, alerts, cache and tokenization in dashboard', async () => {
    const admin = await bootstrapAdmin();

    const createProjectResponse = await request('/api/projects', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        name: 'Proyecto Consumo',
        requestQuotaMonthly: 1,
        budgetMonthlyUsd: 0.00001,
      },
    });
    expect(createProjectResponse.status).toBe(201);
    const projectPayload = await createProjectResponse.json() as {
      project: { id: string };
    };

    const createUserResponse = await request('/api/users', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        name: 'Analyst',
        email: 'analyst@example.com',
        password: 'password123',
        projectId: projectPayload.project.id,
        monthlyRequestQuota: 1,
        monthlyBudgetUsd: 0.00001,
      },
    });
    expect(createUserResponse.status).toBe(201);

    const userPayload = await createUserResponse.json() as {
      user: { id: string };
      rawApiKey: string;
    };

    replacePoolStates([buildMockState(createSuccessService('Mock/router'))]);

    const chatResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userPayload.rawApiKey}`,
      },
      json: {
        model: 'Mock/router',
        stream: false,
        messages: [{ role: 'user', content: 'hola' }],
      },
    });
    expect(chatResponse.status).toBe(200);

    const dashboard = await getDashboard(admin.cookie);
    expect(dashboard.spend.currentMonthUsd >= 0).toBe(true);
    expect(dashboard.spend.projectedMonthUsd >= dashboard.spend.currentMonthUsd).toBe(true);
    expect(dashboard.tokens.currentMonthTokens).toBeGreaterThan(0);
    expect(dashboard.tokens.projectedMonthTokens).toBeGreaterThanOrEqual(dashboard.tokens.currentMonthTokens);
    expect(dashboard.tokens.currentMonthPromptTokens).toBeGreaterThan(0);
    expect(dashboard.tokens.currentMonthCompletionTokens).toBeGreaterThan(0);
    expect(dashboard.cache.enabled).toBe(true);
    expect(dashboard.cache.backend).toBeTruthy();
    expect(dashboard.tokenization.exactForCompletedResponses).toBe(true);
    expect(dashboard.metrics.providers.some((item) => item.provider === 'mock')).toBe(true);
    expect(dashboard.metrics.providers.some((item) => item.totalTokens > 0)).toBe(true);
    expect(dashboard.metrics.providers.some((item) => item.promptTokens > 0)).toBe(true);
    expect(dashboard.metrics.providers.some((item) => item.completionTokens > 0)).toBe(true);
    expect(dashboard.metrics.providers.some((item) => item.totalCostUsd >= 0)).toBe(true);
    expect(dashboard.metrics.models.some((item) => item.model.toLowerCase().includes('router'))).toBe(true);
    expect(dashboard.metrics.models.some((item) => item.totalTokens > 0)).toBe(true);
    expect(dashboard.metrics.models.some((item) => item.promptTokens > 0)).toBe(true);
    expect(dashboard.metrics.models.some((item) => item.completionTokens > 0)).toBe(true);
    expect(dashboard.metrics.recent.some((item) => item.totalTokens > 0)).toBe(true);
    expect(dashboard.metrics.recent.some((item) => item.promptTokens > 0)).toBe(true);
    expect(dashboard.metrics.recent.some((item) => item.completionTokens > 0)).toBe(true);
    expect(dashboard.metrics.recent.some((item) => item.estimatedCostUsd >= 0)).toBe(true);
    expect(dashboard.metrics.daily.length).toBeGreaterThan(0);
    expect(dashboard.metrics.requestTypes.some((item) => item.requestType === 'chat')).toBe(true);
    expect(dashboard.metrics.summary.totalTokens).toBeGreaterThan(0);
    expect(dashboard.metrics.summary.promptTokens).toBeGreaterThan(0);
    expect(dashboard.metrics.summary.completionTokens).toBeGreaterThan(0);
    expect(dashboard.metrics.summary.successRate).toBeGreaterThan(0);

    const userSummary = dashboard.userUsage.find((item) => item.id === userPayload.user.id);
    expect(userSummary?.requestCount).toBe(1);
    expect(userSummary?.totalTokens).toBeGreaterThan(0);
    expect(userSummary?.promptTokens).toBeGreaterThan(0);
    expect(userSummary?.completionTokens).toBeGreaterThan(0);
    expect(userSummary?.status).toBe('exceeded');

    const projectSummary = dashboard.projectUsage.find((item) => item.id === projectPayload.project.id);
    expect(projectSummary?.requestCount).toBe(1);
    expect(projectSummary?.totalTokens).toBeGreaterThan(0);
    expect(projectSummary?.promptTokens).toBeGreaterThan(0);
    expect(projectSummary?.completionTokens).toBeGreaterThan(0);
    expect(projectSummary?.status).toBe('exceeded');

    expect(dashboard.alerts.some((alert) => alert.title.includes('Uso alto de usuario'))).toBe(true);
    expect(dashboard.alerts.some((alert) => alert.title.includes('Proyecto con consumo alto'))).toBe(true);
  });
});

describe('cache and token usage', () => {
  test('estimates tokens with text-aware heuristics', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('hola mundo')).toBeGreaterThanOrEqual(2);
    expect(estimateTextTokens('const saludo = "hola";\nreturn saludo;')).toBeGreaterThan(estimateTextTokens('hola'));
    expect(estimateMessageTokens({
      role: 'user',
      content: [{ type: 'text', text: 'hola' }],
    })).toBeGreaterThan(estimateTextTokens('hola'));
  });

  test('caches repeated non-stream chat responses and persists exact usage from stream metadata', async () => {
    const bootstrap = await bootstrapAdmin();
    let callCount = 0;

    replacePoolStates([buildMockState(createSuccessService('Mock/cached', {
      onCall: () => {
        callCount += 1;
      },
      usage: {
        promptTokens: 21,
        completionTokens: 5,
        totalTokens: 26,
      },
    }))]);

    const firstResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
      json: {
        model: 'Mock/cached',
        stream: false,
        messages: [{ role: 'user', content: 'repite esto' }],
      },
    });
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('x-cache')).toBe('MISS');

    const secondResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
      json: {
        model: 'Mock/cached',
        stream: false,
        messages: [{ role: 'user', content: 'repite esto' }],
      },
    });
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get('x-cache')).toBe('HIT');
    expect(callCount).toBe(1);

    const chatMetrics = db.query(`
      SELECT prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd
      FROM request_metrics
      WHERE path = '/v1/chat/completions'
      ORDER BY created_at ASC
    `).all() as Array<{
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
    }>;

    expect(chatMetrics).toHaveLength(2);
    expect(chatMetrics[0]?.prompt_tokens).toBe(21);
    expect(chatMetrics[0]?.completion_tokens).toBe(5);
    expect(chatMetrics[0]?.total_tokens).toBe(26);
    expect((chatMetrics[0]?.estimated_cost_usd ?? 0) > 0).toBe(true);
    expect(chatMetrics[1]?.prompt_tokens).toBe(21);
    expect(chatMetrics[1]?.completion_tokens).toBe(5);
    expect(chatMetrics[1]?.total_tokens).toBe(26);
    expect(chatMetrics[1]?.estimated_cost_usd).toBe(0);

    const dashboard = await getDashboard(bootstrap.cookie);
    expect(dashboard.cache.hits).toBeGreaterThanOrEqual(1);
    expect(dashboard.cache.entries).toBeGreaterThanOrEqual(1);
    expect(dashboard.tokens.currentMonthTokens).toBeGreaterThanOrEqual(52);
    expect(dashboard.tokens.currentMonthPromptTokens).toBeGreaterThanOrEqual(42);
    expect(dashboard.tokens.currentMonthCompletionTokens).toBeGreaterThanOrEqual(10);
    expect(dashboard.tokenization.mode).toBe('provider-usage-with-fallback');
  });
});

describe('password reset', () => {
  test('requests and confirms a password reset with a temporary token', async () => {
    const bootstrap = await bootstrapAdmin();

    const requestResetResponse = await request('/api/auth/password-reset/request', {
      method: 'POST',
      origin: 'https://allowed.example',
      json: {
        email: 'admin@example.com',
      },
    });
    expect(requestResetResponse.status).toBe(200);

    const requestResetPayload = await requestResetResponse.json() as {
      resetUrl: string | null;
    };
    expect(requestResetPayload.resetUrl).toBeTruthy();

    const resetToken = new URL(requestResetPayload.resetUrl || 'http://localhost').searchParams.get('reset');
    expect(resetToken).toBeTruthy();

    const confirmResponse = await request('/api/auth/password-reset/confirm', {
      method: 'POST',
      origin: 'https://allowed.example',
      json: {
        token: resetToken,
        password: 'new-password123',
      },
    });
    expect(confirmResponse.status).toBe(200);

    const staleSessionResponse = await request('/api/auth/me', {
      headers: {
        Cookie: bootstrap.cookie,
      },
    });
    expect(staleSessionResponse.status).toBe(401);

    const oldLoginResponse = await request('/api/login', {
      method: 'POST',
      json: {
        email: 'admin@example.com',
        password: 'password123',
      },
    });
    expect(oldLoginResponse.status).toBe(401);

    const newLoginResponse = await request('/api/login', {
      method: 'POST',
      origin: 'https://allowed.example',
      json: {
        email: 'admin@example.com',
        password: 'new-password123',
      },
    });
    expect(newLoginResponse.status).toBe(200);
  });
});

describe('metrics visibility', () => {
  test('scopes dashboard and metrics endpoints to the authenticated non-admin user', async () => {
    const admin = await bootstrapAdmin();

    const alphaUserResponse = await request('/api/users', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        name: 'Alpha',
        email: 'alpha@example.com',
        password: 'password123',
      },
    });
    expect(alphaUserResponse.status).toBe(201);

    const alphaUser = await alphaUserResponse.json() as {
      rawApiKey: string;
      user: { id: string };
    };

    const bravoUserResponse = await request('/api/users', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        name: 'Bravo',
        email: 'bravo@example.com',
        password: 'password123',
      },
    });
    expect(bravoUserResponse.status).toBe(201);

    const bravoUser = await bravoUserResponse.json() as {
      rawApiKey: string;
      user: { id: string };
    };

    replacePoolStates([
      buildMockState(createSuccessService('Mock/alpha')),
      buildMockState(createRateLimitedService('Mock/bravo')),
    ]);

    const alphaChatResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${alphaUser.rawApiKey}`,
      },
      json: {
        model: 'Mock/alpha',
        stream: false,
        messages: [{ role: 'user', content: 'hola alpha' }],
      },
    });
    expect(alphaChatResponse.status).toBe(200);

    const bravoChatResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bravoUser.rawApiKey}`,
      },
      json: {
        model: 'Mock/bravo',
        stream: false,
        messages: [{ role: 'user', content: 'hola bravo' }],
      },
    });
    expect(bravoChatResponse.status).toBe(429);

    const alphaLogin = await loginWithPassword('alpha@example.com', 'password123');
    expect(alphaLogin.response.status).toBe(200);

    const dashboard = await getDashboard(alphaLogin.cookie || '');
    expect(dashboard.auth.isAdmin).toBe(false);
    expect(dashboard.metrics.totals.requests).toBe(1);
    expect(dashboard.metrics.summary.requestCount).toBe(1);
    expect(dashboard.metrics.models.some((item) => item.model === 'alpha')).toBe(true);
    expect(dashboard.metrics.models.some((item) => item.model === 'bravo')).toBe(false);
    expect(dashboard.metrics.recent).toHaveLength(1);
    expect(dashboard.recentErrors).toHaveLength(0);
    expect(dashboard.modelTelemetry.some((item) => item.id === 'mock/alpha')).toBe(true);
    expect(dashboard.modelTelemetry.some((item) => item.id === 'mock/bravo')).toBe(false);
    expect(dashboard.userUsage).toHaveLength(1);
    expect(dashboard.userUsage[0]?.id).toBe(alphaUser.user.id);
    expect(dashboard.userUsage[0]?.requestCount).toBe(1);

    const overviewResponse = await request('/api/metrics/overview', {
      headers: {
        Cookie: alphaLogin.cookie || '',
      },
    });
    expect(overviewResponse.status).toBe(200);
    const overviewPayload = await overviewResponse.json() as {
      metrics: { summary: { requestCount: number } };
      modelTelemetry: Array<{ id: string }>;
    };
    expect(overviewPayload.metrics.summary.requestCount).toBe(1);
    expect(overviewPayload.modelTelemetry.some((item) => item.id === 'mock/alpha')).toBe(true);
    expect(overviewPayload.modelTelemetry.some((item) => item.id === 'mock/bravo')).toBe(false);

    const userMetricsResponse = await request('/v1/metrics', {
      headers: {
        Authorization: `Bearer ${alphaUser.rawApiKey}`,
      },
    });
    expect(userMetricsResponse.status).toBe(200);
    const userMetricsPayload = await userMetricsResponse.json() as {
      rate_limited: number;
      models_in_cooldown: Array<{ id: string }>;
      usage_telemetry: Array<{ id: string; provider: string; requests_served: number }>;
      provider_metrics: Array<{ provider: string; totalRequests: number }>;
      model_metrics: Array<{ model: string; totalRequests: number }>;
      summary: { requestCount: number };
    };
    expect(userMetricsPayload.summary.requestCount).toBe(1);
    expect(userMetricsPayload.rate_limited).toBe(0);
    expect(userMetricsPayload.models_in_cooldown).toHaveLength(0);
    expect(userMetricsPayload.usage_telemetry).toEqual([
      {
        id: 'mock/alpha',
        provider: 'mock',
        requests_served: 1,
      },
    ]);
    expect(userMetricsPayload.provider_metrics).toHaveLength(1);
    expect(userMetricsPayload.provider_metrics[0]?.totalRequests).toBe(1);
    expect(userMetricsPayload.model_metrics).toHaveLength(1);
    expect(userMetricsPayload.model_metrics[0]?.model).toBe('alpha');
  });
});

describe('custom providers', () => {
  test('persists protocol metadata for gemini and anthropic custom providers', async () => {
    const admin = await bootstrapAdmin();

    const createResponse = await request('/api/custom-providers', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        name: 'Gemini Sidecar',
        protocol: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIza-test',
        models: [{ id: 'gemini-2.5-pro', supportsTools: true, supportsVision: true, inImagePool: true, inVideoPool: false }],
      },
    });

    expect(createResponse.status).toBe(201);
    const createdPayload = await createResponse.json() as {
      customProvider: { id: string; protocol: string; models: Array<{ id: string; inImagePool: boolean; inVideoPool: boolean }> };
    };
    expect(createdPayload.customProvider.protocol).toBe('gemini');
    expect(createdPayload.customProvider.models[0]?.id).toBe('gemini-2.5-pro');
    expect(createdPayload.customProvider.models[0]?.inImagePool).toBe(true);
    expect(createdPayload.customProvider.models[0]?.inVideoPool).toBe(false);

    const updateResponse = await request(`/api/custom-providers/${createdPayload.customProvider.id}`, {
      method: 'PATCH',
      headers: {
        Cookie: admin.cookie,
      },
      json: {
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        models: [{ id: 'claude-3-7-sonnet-latest', supportsTools: true, supportsVision: true, inImagePool: false, inVideoPool: true }],
      },
    });

    expect(updateResponse.status).toBe(200);

    const dashboard = await getDashboard(admin.cookie) as {
      customProviders?: Array<{ protocol: string; models: Array<{ id: string; inImagePool: boolean; inVideoPool: boolean }> }>;
    };
    expect(dashboard.customProviders?.[0]?.protocol).toBe('anthropic');
    expect(dashboard.customProviders?.[0]?.models[0]?.id).toBe('claude-3-7-sonnet-latest');
    expect(dashboard.customProviders?.[0]?.models[0]?.inImagePool).toBe(false);
    expect(dashboard.customProviders?.[0]?.models[0]?.inVideoPool).toBe(true);
  });
});

describe('crypto hardening', () => {
  test('requires ROUTER_MASTER_KEY in production instead of auto-generating a local fallback', () => {
    const previousEnv = process.env.ROUTER_MASTER_KEY;
    const previousNodeEnv = process.env.NODE_ENV;

    try {
      delete process.env.ROUTER_MASTER_KEY;
      process.env.NODE_ENV = 'production';
      __resetMasterKeyCacheForTests();

      expect(() => encryptSecret('top-secret')).toThrow(/ROUTER_MASTER_KEY is required in production/i);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.ROUTER_MASTER_KEY;
      } else {
        process.env.ROUTER_MASTER_KEY = previousEnv;
      }
      process.env.NODE_ENV = previousNodeEnv;
      __resetMasterKeyCacheForTests();
    }
  });
});

describe('smoke', () => {
  test('covers /health, /api/login, /v1/models and /v1/chat/completions', async () => {
    const healthResponse = await request('/health', {
      origin: 'https://allowed.example',
    });
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get('x-request-id')).toBeTruthy();

    const bootstrap = await bootstrapAdmin();
    replacePoolStates([buildMockState(createSuccessService())]);

    const loginResponse = await request('/api/login', {
      method: 'POST',
      origin: 'https://allowed.example',
      json: {
        email: 'admin@example.com',
        password: 'password123',
      },
    });
    expect(loginResponse.status).toBe(200);

    const modelsResponse = await request('/v1/models', {
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
    });
    expect(modelsResponse.status).toBe(200);

    const chatResponse = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrap.body.rawApiKey}`,
      },
      json: {
        model: 'Mock/echo',
        stream: false,
        messages: [{ role: 'user', content: 'hola' }],
      },
    });
    expect(chatResponse.status).toBe(200);

    const chatPayload = await chatResponse.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    expect(chatPayload.choices[0]?.message.content).toBe('pong');
  });
});
