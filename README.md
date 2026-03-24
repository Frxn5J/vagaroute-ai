# VagaRoute AI

> **Self-hosted AI Gateway** — Unified API for 10+ LLM providers with zero external dependencies.

[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/database-SQLite-003b57?logo=sqlite)](https://sqlite.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-412991?logo=openai)](https://platform.openai.com/docs/api-reference)

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

## ✨ Key Features

### 🔀 Intelligent Routing
- **Auto mode** (`model: "auto"`) — picks the best available free-tier model automatically
- **Tier-based routing** — prefers high-capability models (70B+, GPT-4o, Claude 3.5) then falls back to smaller ones
- **Tool-use routing** — filters providers that support function calling
- **Vision routing** — filters providers that support image inputs
- **Automatic failover** — up to 10 retries across providers when one fails

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

| | VagaRoute AI | LiteLLM | Bifrost | Portkey |
|---|---|---|---|---|
| **Runtime** | Bun (TS) | Python | Go | TS/Elixir |
| **Free-tier focus** | ✅ Core feature | ❌ | ❌ | ❌ |
| **External deps** | 🟢 None (SQLite) | 🔴 Redis + PG | 🟡 Redis | 🔴 Cloud/PG |
| **Response cache** | ✅ Memory+SQLite | ✅ Redis only | ✅ Semantic | ✅ Semantic |
| **Cost tracking** | ✅ Built-in | ✅ | ✅ | ✅ |
| **Multi-tenancy** | ✅ Projects | ✅ Teams | ✅ Orgs | ✅ Advanced |
| **Dashboard** | ✅ Built-in | ✅ | ✅ | ✅ |
| **Image generation** | ✅ Pollinations | Proxy only | Proxy only | ✅ |
| **Audio transcription** | ✅ Groq + Wit.ai | Proxy only | Proxy only | Proxy only |
| **Deploy complexity** | 🟢 1 process | 🔴 Complex infra | 🟡 Moderate | 🔴 Cloud/complex |

---

## 📝 License

MIT — see [LICENSE](LICENSE).

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue before submitting large changes.
