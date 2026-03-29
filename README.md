<div align="center">
  <img src="./logo.png" alt="VagaRoute AI Logo" width="512" style="border-radius: 16px; margin-bottom: 16px;" />
  <h1>VagaRoute AI</h1>
</div>

> **Self-hosted AI Gateway** — Unified API for 10+ LLM providers with zero external dependencies.

[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/database-SQLite-003b57?logo=sqlite)](https://sqlite.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-412991?logo=openai)](https://platform.openai.com/docs/api-reference)

> Based on [midudev/bun-ai-api](https://github.com/midudev/bun-ai-api) — improved in my free time.

---

## What is VagaRoute AI?

VagaRoute AI is a **self-hosted AI gateway** that gives you a single OpenAI-compatible API endpoint (`/v1/chat/completions`) backed by 10+ LLM providers — prioritizing **free-tier models** first, with automatic failover, rate limiting, caching, cost tracking, and a full web dashboard.

No Redis. No PostgreSQL. No external services. **One process, one SQLite database, one command to run.**

```
Your App  →  VagaRoute AI Gateway  →  Groq / Gemini / OpenRouter / Mistral / ...
              (auth, routing, cache,     (free-tier first, auto-failover)
               rate limits, metrics)
```

---

<img width="1918" height="907" alt="imagen" src="https://github.com/user-attachments/assets/65a52fd4-8670-495a-94dc-78d35bb38527" />


## ✨ Key Features

### 🔀 Intelligent Routing
- **Auto mode** (`model: "auto"`) — picks the best available free-tier model automatically
- **Tier-based routing** — prefers high-capability models (70B+, GPT-4o, Claude 3.5) then falls back to smaller ones
- **Tool-use routing** — filters providers that support function calling
- **Vision routing** — filters providers that support image inputs
- **Automatic failover** — up to 10 retries across providers when one fails

<img width="1559" height="808" alt="imagen" src="https://github.com/user-attachments/assets/be037449-0af2-4ced-8b0a-3176d6dd59a7" />
<img width="1289" height="581" alt="imagen" src="https://github.com/user-attachments/assets/42ccf756-766d-4cd8-9512-74cafe777d17" />
<img width="1912" height="879" alt="imagen" src="https://github.com/user-attachments/assets/8b2aa5a9-250b-4c7f-9416-b6075f2839e4" />
<img width="1577" height="821" alt="imagen" src="https://github.com/user-attachments/assets/c6fc2cc2-84f9-4ced-b572-e567531088b8" />


### 📦 Supported Providers
| Provider | Free Tier | Chat | Tools | Vision | Images | Audio | Embeddings |
|---|---|---|---|---|---|---|---|
| **Groq** | ✅ | ✅ | ✅ | ✅ | — | ✅ Whisper | — |
| **Cerebras** | ✅ | ✅ | ✅ | — | — | — | — |
| **Gemini** | ✅ | ✅ | ✅ | ✅ | — | — | — |
| **OpenRouter** | ✅ Free models | ✅ | ✅ | ✅ | — | — | — |
| **Mistral** | ✅ | ✅ | ✅ | — | — | — | ✅ mistral-embed |
| **Codestral** | ✅ | ✅ | — | — | — | — | — |
| **Cohere** | ✅ | ✅ | ✅ | — | — | — | ✅ multilingual |
| **NVIDIA NIM** | ✅ | ✅ | ✅ | — | — | — | — |
| **Alibaba** | ✅ | ✅ | ✅ | — | — | — | — |
| **Puter.js** | ✅ (100% free) | ✅ | — | — | — | — | — |
| **Pollinations** | ✅ | — | — | — | ✅ | — | — |
| **Wit.ai** | ✅ | — | — | — | — | ✅ Speech | — |

### 🔑 Access Control
- **User accounts** with email + password login
- **API keys** — create multiple keys per user with individual rate limits
- **Projects** — group users and keys under projects with monthly budgets (USD) and request quotas
- **Admin / User roles** — full RBAC
- **Invitation tokens** — invite teammates to projects via secure tokens
- **Password reset** — built-in token-based password recovery
- **Session management** — cookie-based sessions with configurable timeout

### 💾 Response Cache
- **Hybrid cache** (memory + SQLite) — no Redis required
- Configurable TTL (default 5 min)
- Cache key scoped per `user:apiKey:project` — no cross-user leakage
- `X-Cache: HIT / MISS / BYPASS` header on every response
- Cache bypassed automatically for streaming, function-calling, or high-temperature requests

### 📊 Observability
- **Cost estimation** in USD per request (chat, audio, images, embeddings)
- **Token tracking** — prompt / completion / total tokens with monthly summaries and projections
- **Provider-level metrics** — requests, errors, avg latency, total cost per provider
- **Model-level telemetry** — top models by usage
- **Recent errors** — last 15 failed requests with error messages
- **Usage summaries** per user and per project
- **Spend projection** — estimated end-of-month spend based on current burn rate
- **Dashboard alerts** — proactive warnings for provider cooldowns, budget overruns, and spend spikes

### 🔒 Provider Key Management
- Store encrypted provider API keys in the DB (AES-GCM, key derived from `ROUTER_MASTER_KEY`)
- Multiple keys per provider with priority ordering
- Intelligent key rotation — on `429` (rate limit), `402` (quota), `401/403` (invalid), the gateway automatically:
  - Puts the key in cooldown or disables it permanently
  - Rotates to the next available key
- Unified view of DB keys + environment variable keys with live status

### ⚡ Rate Limiting
- Per API key (configurable RPM)
- Per user (fallback when no key)
- Per provider (RPM / RPD / TPM / TPD / audio seconds)
- Per model (fine-grained limits for specific models)
- Anonymous IP rate limiting

---

## 🚀 Self-Hosting

### Requirements
- **[Bun](https://bun.sh) ≥ 1.1** (the only system dependency)
- A server, VPS, or any Linux machine

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/vaga-route-ai.git
cd vaga-route-ai/bun-ai-api

# 2. Install dependencies
bun install

# 3. Set your environment (optional — keys can be added via the UI later)
cp .env.example .env

# 4. Start the server
bun run start
```

Open `http://localhost:3000` — the first-run setup wizard will guide you through creating your admin account.

### Environment Variables

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Logging
LOG_LEVEL=info           # debug | info | warn | error
PRETTY_LOGS=0            # 1 = human-readable, 0 = JSON (recommended for production)

# Security
API_SECRET=              # Optional: legacy master Bearer token
ROUTER_MASTER_KEY=       # Optional: 32-byte hex/base64 key to encrypt service keys
                         # If not set, a key is auto-generated and saved to router.master.key

# Database
ROUTER_DB_PATH=          # Optional: custom SQLite path
                         # Development default: ./router.sqlite
                         # Production default: /data/router.sqlite

# Response Cache
RESPONSE_CACHE_ENABLED=1
RESPONSE_CACHE_BACKEND=hybrid   # hybrid | memory | sqlite
RESPONSE_CACHE_TTL_SECONDS=300
```

> **Provider API keys** don't need to go in `.env`. You can add them at any time through the **Service Keys** panel in the dashboard — they're stored encrypted in SQLite.

### Development Mode

```bash
bun run dev      # Hot-reload on file changes
```

### Running Tests

```bash
bun test
```

---

## 🐳 Docker

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000
ENV NODE_ENV=production
CMD ["bun", "run", "start"]
```

```bash
docker build -t vaga-route-ai .
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e ROUTER_DB_PATH=/app/data/router.sqlite \
  -e NODE_ENV=production \
  vaga-route-ai
```

---

## ☁️ Deploy on Coolify / Railway / Render

This project includes a `nixpacks.toml` for zero-config deployment on platforms that support Nixpacks (Railway, Coolify, etc.):

```toml
[phases.setup]
nixPkgs = ["bun"]

[phases.install]
cmds = ["bun install"]

[start]
cmd = "bun run start"
```

**Recommended environment variables for production:**
```
NODE_ENV=production
PRETTY_LOGS=0
LOG_LEVEL=info
ROUTER_MASTER_KEY=<your-32-byte-secret>
ROUTER_DB_PATH=/data/router.sqlite   # mount a persistent volume here
```

Important for Coolify:
- Mount a persistent volume at `/data`
- Keep the same `ROUTER_MASTER_KEY` across redeploys
- If you don't set `ROUTER_DB_PATH`, production now defaults to `/data/router.sqlite`

---

## 🌐 API Reference

VagaRoute AI exposes an **OpenAI-compatible** API. Any OpenAI SDK or client works out of the box — just change the `baseURL`.

### Authentication

```bash
Authorization: Bearer <your-api-key>
```

### Chat Completions

```bash
POST /v1/chat/completions
```

```json
{
  "model": "auto",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false
}
```

**Virtual models:**
| Model | Behavior |
|---|---|
| `auto` | Best available free model (default) |
| `tools` | Best available model with function-calling support |
| `img` | Best available model with vision support |
| Any provider model | e.g., `groq/llama-3.3-70b-versatile` |

**Response headers:**
```
X-Cache: HIT | MISS | BYPASS
X-Service: groq/llama-3.3-70b-versatile
X-Request-Id: <uuid>
```

### List Models

```bash
GET /v1/models
```

Returns all loaded models with their current status (`available` / `cooldown` / `disabled`).

### Image Generation

```bash
POST /v1/images/generations
Content-Type: application/json

{
  "prompt": "A futuristic city at night",
  "model": "flux",
  "n": 1,
  "size": "1024x1024"
}
```

### Audio Transcription

```bash
POST /v1/audio/transcriptions
Content-Type: multipart/form-data

file=@audio.mp3
provider=groq          # groq (default) | witai
language=en            # optional
```

### Embeddings

```bash
POST /v1/embeddings
Content-Type: application/json

{
  "input": "Your text here"
}
```

Automatically uses Mistral `mistral-embed`, with Cohere `embed-multilingual-v3.0` as fallback.

### Health Check

```bash
GET /health
```

```json
{
  "status": "ok",
  "uptime_seconds": 3600,
  "bootstrap_required": false,
  "services": {
    "total": 42,
    "available": 38,
    "disabled": 2
  }
}
```

---

## 🖥️ Dashboard

The built-in web dashboard is served at the root URL (`/`). It includes:

- **Pool status** — all loaded models with availability, cooldown timers, tool/vision support
- **Metrics** — requests, tokens, cost (USD) per provider and model
- **Usage summaries** — per user and per project with quota/budget tracking
- **Spend projection** — month-to-date + estimated end-of-month cost
- **Recent errors** — last 15 failed requests with error context
- **Alerts** — proactive warnings (provider down, budget over 80%, spend spikes)
- **Cache stats** — hit rate, active entries, stores
- **User management** — create, activate/deactivate users, set quotas and budgets
- **API Key management** — create, revoke, set rate limits
- **Service Key management** — add provider API keys, set priority, monitor cooldown state
- **Rate limit rules** — configure RPM/RPD/TPM/TPD per provider or model
- **Project management** — create projects, invite members, set budgets

---

## 🏗️ Architecture

```
bun-ai-api/
├── index.ts              # HTTP router — all API routes
├── core/
│   ├── config.ts         # Environment config
│   ├── costs.ts          # USD cost estimation per provider/model/type
│   ├── db.ts             # SQLite schema, queries, migrations
│   ├── pool.ts           # Service pool — loading, routing, failover logic
│   ├── providerKeys.ts   # API key management with intelligent retry/rotation
│   ├── providerLimits.ts # Pre-request provider limit checks
│   ├── responseCache.ts  # Hybrid memory+SQLite response cache
│   ├── tokenizer.ts      # Token estimation (CJK, URLs, code-aware)
│   └── usageLimits.ts    # Rate limit evaluation engine
├── middlewares/
│   ├── auth.ts           # Sessions, API keys, invitations, password reset
│   └── rateLimit.ts      # Per-key/user rate limit middleware
├── services/             # Provider adapters
│   ├── groq.ts
│   ├── gemini.ts
│   ├── openrouter.ts
│   ├── mistral.ts
│   ├── codestral.ts
│   ├── cohere.ts
│   ├── cerebras.ts
│   ├── nvidia.ts
│   ├── alibaba.ts
│   └── puter.ts
└── utils/
    ├── cors.ts
    ├── crypto.ts         # AES-GCM encryption, token hashing, key generation
    ├── logger.ts         # Pino structured logging
    ├── requestContext.ts
    └── stream.ts         # SSE streaming, token observation
```

**Stack:**
- **Runtime**: [Bun](https://bun.sh) — fast JS/TS runtime with native SQLite
- **Database**: SQLite via `bun:sqlite` — embedded, zero-config
- **Logging**: [Pino](https://getpino.io) — structured JSON logs
- **Encryption**: Node.js `crypto` with AES-256-GCM for provider secrets

---

## 🔐 Security

- Provider API keys are **AES-256-GCM encrypted** before storage. The encryption key (`ROUTER_MASTER_KEY`) never touches the database.
- User passwords are hashed with **Bun's built-in Argon2** hasher.
- Session tokens and API keys are stored as **SHA-256 hashes** — the raw value is only shown once on creation.
- CORS is configurable per `allowedOrigins` in settings.
- All admin endpoints require explicit `role: 'admin'` on the authenticated user.

---

## 📋 Comparison

> Last updated: March 2026

| | VagaRoute AI | LiteLLM | Bifrost | Portkey | Helicone |
|---|---|---|---|---|---|
| **Runtime** | Bun (TS) | Python | Go | Node.js | Rust |
| **Open source** | ✅ MIT | ✅ MIT | ✅ MIT | ✅ MIT (Mar 2026) | ✅ Apache 2 |
| **Free-tier focus** | ✅ Core feature | ❌ | ❌ | ❌ | ❌ |
| **External deps** | 🟢 None (SQLite) | 🔴 Redis + PG + Prisma | 🟡 Optional Redis | 🟢 Stateless | 🔴 Postgres + Redis |
| **Response cache** | ✅ Memory + SQLite | ✅ Redis required | ✅ Semantic | ✅ Simple + Semantic | ✅ Semantic (Rust) |
| **Cost tracking** | ✅ Built-in USD | ✅ Built-in | ✅ Built-in | ✅ Built-in | ✅ Built-in |
| **Token tracking** | ✅ Prompt/completion | ✅ | ✅ | ✅ | ✅ |
| **Multi-tenancy** | ✅ Projects + budgets | ✅ Teams + budgets | ✅ Orgs + virtual keys | ✅ Workspaces | ✅ Organizations |
| **Per-user budgets & quotas** | ✅ USD limit + request cap per user | ✅ | ❌ | ✅ | ❌ |
| **Dashboard** | ✅ Built-in, role-scoped (admin/user) | ✅ Requires PG | ✅ Built-in | ✅ Built-in | ✅ Built-in |
| **Image generation** | ✅ Pollinations (free, native) | 🟡 Proxy only | 🟡 Proxy only | 🟡 Proxy only | 🟡 Proxy only |
| **Audio transcription** | ✅ Groq + Wit.ai (native) | 🟡 Proxy only | 🟡 Proxy only | 🟡 Proxy only | 🟡 Proxy only |
| **Embeddings** | ✅ Mistral + Cohere (native) | 🟡 Proxy only | 🟡 Proxy only | 🟡 Proxy only | 🟡 Proxy only |
| **Provider count** | ~11 built-in + unlimited custom | 100+ built-in | 20+ built-in | 1,600+ models | 20+ built-in |
| **Custom providers** | ✅ Any OpenAI-compatible URL, from UI | 🟡 Config file only | 🟡 Config file only | 🟡 Config file only | ❌ |
| **Failover/retry** | ✅ Up to 10 retries, tier-ordered | ✅ | ✅ | ✅ | ✅ |
| **Key rotation** | ✅ Auto on 429 / 402 / 401 / 403 | 🟡 Manual | ✅ | ✅ | ✅ |
| **Rate limiting** | ✅ Per key / user / provider / model | ✅ | ✅ Virtual keys | ✅ | ✅ |
| **Model tier overrides** | ✅ Per-model UI + `AGENT_MODELS` env pin | ❌ | 🟡 Priority weights | ❌ | ❌ |
| **Guardrails** | ❌ | 🟡 Basic | ✅ | ✅ | ✅ |
| **MCP support** | ❌ | ❌ | ✅ MCP gateway | ✅ MCP gateway | ❌ |
| **First-run onboarding** | ✅ Wizard UI on first boot | ❌ | ❌ | ❌ | ❌ |
| **Deploy complexity** | 🟢 1 process, 1 command | 🔴 Complex (Redis + PG) | 🟡 Docker recommended | 🟢 `npx` or Docker | 🔴 Requires PG + Redis |
| **Self-hosted** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Supply-chain safety** | 🟢 Minimal deps | ⚠️ CVE Mar 2026 (v1.82.7/8) | 🟢 Go binaries | 🟢 | 🟢 |

### When to pick VagaRoute AI

- You want a **zero-dependency, single-process** self-hosted gateway — one `bun run start` and you're live
- You prioritize **free-tier models** — the auto-router picks high-capability free models first (70B+, GPT-4o, Claude 3.5) with tier-based ordering and up to 10-retry failover
- You need **native image gen and audio transcription**, not a pass-through proxy
- You want to add **any OpenAI-compatible API as a custom provider** from the dashboard — base URL, AES-encrypted key, per-model tool/vision flags — no config files
- You want **fine-grained routing control** — manually override model tier priority from the UI, or pin specific models to tool-use routing via `AGENT_MODELS`
- You need **per-user spend limits** — monthly USD budget and request quota, independent of project-level limits
- You want **RBAC that actually scales down** — admins see everything; regular users see only their own usage, keys, and projects with no data leakage
- You want a **first-run onboarding wizard** that takes you from zero to operational in < 2 minutes with no external services

### When to pick an alternative

| Need | Consider |
|---|---|
| 100+ providers out of the box | **LiteLLM** (but prepare for Redis + PG overhead) |
| Ultra-low latency at high RPS (5,000+) | **Bifrost** (Go, ~11 µs overhead) |
| Enterprise guardrails + MCP gateway | **Portkey** or **Bifrost** |
| Best-in-class observability (Rust speed) | **Helicone** |
| Already on Cloudflare infrastructure | **Cloudflare AI Gateway** |

---

## 🤝 Acknowledgements

### Pollinations.ai

[![Built With Pollinations](https://img.shields.io/badge/Built%20with-Pollinations-8a2be2?style=for-the-badge&logo=data:image/png;base64,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&logoColor=white&labelColor=6a0dad)](https://pollinations.ai)

VagaRoute AI uses **[Pollinations.ai](https://pollinations.ai)** for free image generation via the `/v1/images/generations` endpoint.

| Asset | Preview | URL |
|---|---|---|
| Logo | ![Pollinations logo](https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo.svg) | [logo.svg](https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo.svg) |
| Logo + Text | ![Pollinations logo text](https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo-text.svg) | [logo-text.svg](https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo-text.svg) |

> See also: [Pollinations Frontend README](https://github.com/pollinations/pollinations/tree/main/image.pollinations.ai)

---

## 📝 License

MIT — see [LICENSE](LICENSE).

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue before submitting large changes.
