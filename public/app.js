const app = document.querySelector('#app');

function createEmptyCustomProviderDraft() {
  return { name: '', protocol: 'openai', baseUrl: '', apiKey: '', models: [] };
}

function createEmptyCustomProviderModel() {
  return {
    id: '',
    supportsTools: false,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsVideoGeneration: false,
  };
}

function getCustomProviderProtocolOptions() {
  return [
    { value: 'openai', label: 'OpenAI compatible' },
    { value: 'gemini', label: 'Gemini API' },
    { value: 'anthropic', label: 'Anthropic Messages' },
  ];
}

function formatCustomProviderProtocol(protocol) {
  const labels = {
    openai: 'OpenAI',
    gemini: 'Gemini',
    anthropic: 'Anthropic',
  };
  return labels[String(protocol || 'openai').toLowerCase()] || 'OpenAI';
}

function getCustomProviderBaseUrlPlaceholder(protocol) {
  if (protocol === 'gemini') {
    return 'https://generativelanguage.googleapis.com/v1beta';
  }
  if (protocol === 'anthropic') {
    return 'https://api.anthropic.com/v1';
  }
  return 'https://api.ejemplo.com/v1';
}

function createEmptyCustomProviderDiscoveryState() {
  return {
    draft: { loading: false, message: '' },
    edit: { loading: false, message: '' },
  };
}

const providerOptions = [
  'openrouter',
  'groq',
  'witai',
  'mistral',
  'codestral',
  'gemini',
  'cohere',
  'nvidia',
  'cerebras',
  'alibaba',
  'puter',
  'qwenchat',
  'pollinations',
];

const state = {
  mode: 'loading',
  authMode: 'login',
  invitePreview: null,
  view: 'overview',
  metricsTab: 'overview',
  settingsPage: 'general',
  settingsGuide: null,
  needsSetup: false,
  dashboard: null,
  me: null,
  flash: null,
  lastCreatedApiKey: null,
  sharedValueKind: 'api-key',
  currentPlayground: 'chat',
  currentPlaygroundTab: 'curl',
  playgroundAuthMode: 'session',
  playgroundApiKey: '',
  playgroundBodies: {},
  playgroundResponse: null,
  playgroundBusy: false,
  playgroundAudioProvider: 'groq',
  playgroundAudioLanguage: 'es',
  modelAliasCategory: 'chat',
  chatDraft: '',
  chatModel: 'auto',
  chatMessages: [
    {
      role: 'assistant',
      content: 'Listo para probar el router. Escribe un mensaje y uso el endpoint OpenAI-compatible del backend.',
    },
  ],
  busy: false,
  cpDraft: createEmptyCustomProviderDraft(),
  cpEditing: null,
  cpDiscovery: createEmptyCustomProviderDiscoveryState(),
  // Quick Start state
  qsAgent: 'opencode',
  qsSelectedModels: [],
  qsCopied: null,
  qsProviderFilter: '',
};

function getSettingsPages() {
  const isAdminUser = state.dashboard?.auth?.isAdmin;
  const basePages = [
    {
      id: 'general',
      label: 'General',
      title: 'Ajustes generales',
      description: 'Nombre del sistema, sesion, limites base y comportamiento global del router.',
    },
    {
      id: 'api-keys',
      label: 'API keys',
      title: 'Tus API keys',
      description: 'Crea, limita y desactiva llaves para integraciones o pruebas.',
    },
  ];

  if (!isAdminUser) {
    return basePages;
  }

  return [
    ...basePages,
    {
      id: 'users',
      label: 'Usuarios',
      title: 'Usuarios',
      description: 'Alta de cuentas nuevas y control de acceso al panel.',
    },
    {
      id: 'projects',
      label: 'Proyectos',
      title: 'Proyectos y cuotas',
      description: 'Presupuestos, cuotas mensuales e invitaciones temporales.',
    },
    {
      id: 'service-keys',
      label: 'Service keys',
      title: 'Service keys',
      description: 'Llaves de proveedores externas desde el sistema o el panel para failover.',
    },
    {
      id: 'custom-providers',
      label: 'Proveedores',
      title: 'Proveedores personalizados',
      description: 'Conecta cualquier API compatible con OpenAI al router con sus propios modelos y configuracion.',
    },
    {
      id: 'provider-limits',
      label: 'Limites proveedor',
      title: 'Limites por proveedor',
      description: 'Protege proveedores completos con cooldown y techos de uso.',
    },
    {
      id: 'model-limits',
      label: 'Limites modelo',
      title: 'Limites por modelo',
      description: 'Restringe modelos puntuales sin afectar al resto del proveedor.',
    },
    {
      id: 'model-tiers',
      label: 'Prioridad de modelos',
      title: 'Prioridad de modelos',
      description: 'Controla el orden en que el router elige modelos. Tier 1 tiene maxima prioridad, tier 3 es fallback.',
    },
    {
      id: 'model-aliases',
      label: 'Compatibilidad',
      title: 'Compatibilidad de modelos',
      description: 'Crea alias para mapear modelos externos hacia modelos reales del pool. Permite compatibilidad con clientes que usan nombres de modelos especificos.',
    },
  ];
}

function ensureValidSettingsPage() {
  const pages = getSettingsPages();
  if (!pages.some((page) => page.id === state.settingsPage)) {
    state.settingsPage = pages[0]?.id || 'general';
  }
}

function getSettingsPageInfo(pageId = state.settingsPage) {
  ensureValidSettingsPage();
  return getSettingsPages().find((page) => page.id === pageId) || getSettingsPages()[0];
}

function getSettingsGuideContent(pageId = state.settingsPage) {
  const guides = {
    general: {
      eyebrow: 'Tutorial rapido',
      title: 'Como usar los ajustes generales',
      intro: 'Estos campos cambian el comportamiento base del router y del panel para todos los usuarios.',
      items: [
        {
          title: 'Nombre del sistema',
          text: 'Actualiza el nombre visible del panel y ayuda a identificar este despliegue.',
        },
        {
          title: 'Sesion y limites base',
          text: 'Define cuanto duran las sesiones y el tope por defecto para API keys nuevas y trafico anonimo.',
        },
        {
          title: 'Origenes y modelo por defecto',
          text: 'Allowed origins controla CORS y el modelo default simplifica pruebas iniciales.',
        },
        {
          title: 'Toggles operativos',
          text: 'Puedes limitar OpenRouter a modelos gratis o decidir si los usuarios crean sus propias keys.',
        },
      ],
    },
    'api-keys': {
      eyebrow: 'Tutorial rapido',
      title: 'Como administrar API keys',
      intro: 'Esta pagina sirve para crear llaves de integracion y ajustar su capacidad sin tocar el resto del sistema.',
      items: [
        {
          title: 'Crear una key',
          text: 'Usa nombres claros como n8n, bot-web o staging para saber quien consume cada llave.',
        },
        {
          title: 'Rate limit',
          text: 'El limite por minuto evita que una sola integracion sature el router o agote proveedores.',
        },
        {
          title: 'Activar o desactivar',
          text: 'Si una integracion falla o se comprometio, puedes apagar su key sin borrar historico.',
        },
      ],
    },
    users: {
      eyebrow: 'Tutorial rapido',
      title: 'Como gestionar usuarios',
      intro: 'Desde aqui das acceso a nuevas personas y controlas si una cuenta puede seguir entrando.',
      items: [
        {
          title: 'Crear usuario',
          text: 'La contrasena es temporal; luego la persona puede iniciar sesion y usar su API key inicial.',
        },
        {
          title: 'Estado',
          text: 'Desactivar un usuario corta acceso al panel y evita uso futuro con su cuenta.',
        },
        {
          title: 'Ultimo login',
          text: 'Te ayuda a detectar cuentas sin uso o accesos sospechosos.',
        },
      ],
    },
    projects: {
      eyebrow: 'Tutorial rapido',
      title: 'Como gestionar proyectos y cuotas',
      intro: 'Esta pagina concentra cuotas, invitaciones temporales y seguimiento de consumo por proyecto.',
      items: [
        {
          title: 'Crear proyecto',
          text: 'Define cuota mensual de requests para detectar consumo alto cuanto antes.',
        },
        {
          title: 'Invitaciones temporales',
          text: 'Puedes invitar por correo o con un link temporal que se comparte manualmente.',
        },
        {
          title: 'Alertas de consumo',
          text: 'La vista cruza requests y tokens para priorizar equipos o clientes con mas riesgo.',
        },
      ],
    },
    'service-keys': {
      eyebrow: 'Tutorial rapido',
      title: 'Como usar service keys',
      intro: 'Las service keys pueden venir de variables del sistema o del panel; el router rota y prioriza ambas para mantener disponibilidad.',
      items: [
        {
          title: 'Sistema o panel',
          text: 'Si ya configuraste variables como GROQ_API_KEY u OPENROUTER_API_KEY en el sistema, el backend las usa sin depender de .env.',
        },
        {
          title: 'Prioridad',
          text: 'Valores mas bajos o altos ordenan el failover segun la logica actual del backend; manten una convención consistente.',
        },
        {
          title: 'Reset router',
          text: 'Sirve para limpiar estados temporales del pool cuando estas haciendo pruebas o recuperandote de errores.',
        },
      ],
    },
    'provider-limits': {
      eyebrow: 'Tutorial rapido',
      title: 'Como funcionan los limites por proveedor',
      intro: 'Estos ajustes frenan a un proveedor completo cuando se acerca a sus topes o cuando quieres repartir mejor la carga.',
      items: [
        {
          title: 'Modo',
          text: 'Sin limite desactiva la regla, Solo tokens usa umbrales simples y Estilo Groq replica una estrategia mas estricta.',
        },
        {
          title: 'RPM, RPD, TPM y TPD',
          text: 'Controlan requests o tokens por minuto y por dia para evitar bloqueos o saturacion inesperada.',
        },
        {
          title: 'ASH y ASD',
          text: 'Son topes adicionales para audio o ventanas especiales del proveedor, utiles cuando el backend aplica cooldown preventivo.',
        },
      ],
    },
    'model-limits': {
      eyebrow: 'Tutorial rapido',
      title: 'Como usar los limites por modelo',
      intro: 'Cuando un modelo es caro, sensible o inestable, puedes ponerle reglas propias sin afectar otros modelos del mismo proveedor.',
      items: [
        {
          title: 'Nuevo limite',
          text: 'Elige un modelo del pool visible y guarda una regla dedicada para ese id exacto.',
        },
        {
          title: 'Limites activos',
          text: 'Puedes editar reglas existentes y dejar modo Sin limite si solo quieres conservar el registro pero desactivar la restriccion.',
        },
        {
          title: 'Cuando usarlo',
          text: 'Es ideal para modelos premium, embeddings costosos o endpoints que se degradan antes que el proveedor completo.',
        },
      ],
    },
    'model-tiers': {
      eyebrow: 'Tutorial rapido',
      title: 'Como funciona la prioridad de modelos',
      intro: 'El router organiza el pool en tiers. Cuando llega una solicitud con model: auto, intenta primero los modelos de menor numero de tier. Dentro del mismo tier, elige al azar para distribuir carga.',
      items: [
        {
          title: 'Tier 1 — Premium',
          text: 'Modelos grandes y capaces como GPT-4, Claude Opus o Gemini Pro. El router los prioriza cuando estan disponibles y la solicitud los admite.',
        },
        {
          title: 'Tier 2 — Balanceado',
          text: 'Modelos de capacidad media como Sonnet, Flash o Mixtral. Cubren la mayoria de los casos de uso con buena relacion velocidad-calidad.',
        },
        {
          title: 'Tier 3 — Rapido',
          text: 'Modelos livianos y rapidos. Se usan como fallback o para tareas simples. Los modelos de pago siempre van despues de cualquier tier gratuito.',
        },
        {
          title: 'Overrides y Auto',
          text: 'Puedes forzar un tier distinto al calculado automaticamente. Auto restaura el valor original basado en el nombre del modelo. Los cambios aplican de inmediato al pool.',
        },
      ],
    },
    'model-aliases': {
      eyebrow: 'Tutorial rapido',
      title: 'Como usar la compatibilidad de modelos',
      intro: 'Los alias te permiten mapear un nombre de modelo externo hacia un modelo real del pool. Esto es util para mantener compatibilidad con clientes que usan nombres especificos.',
      items: [
        {
          title: 'Crear un alias',
          text: 'Elige un alias (como gpt-4) y selecciona el modelo target del pool (como Groq/llama-3.3-70b). El router resolvara el alias automaticamente.',
        },
        {
          title: 'Como funciona',
          text: 'Cuando un cliente llama con model: gpt-4, el router lo transforma a Groq/llama-3.3-70b antes de hacer la peticion. La respuesta muestra el alias original.',
        },
        {
          title: 'Alias vs virtuales',
          text: 'Los modelos virtuales (auto, img, tools) siguen funcionando igual. Los alias solo aplican cuando se especifica un nombre de modelo explicito.',
        },
      ],
    },
  };

  return guides[pageId] || guides.general;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizeChatContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && typeof item.text === 'string') return item.text;
        return JSON.stringify(item);
      })
      .join('\n');
  }
  return String(value ?? '');
}

function isBase64ImageDataUrl(value) {
  return /^data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+$/.test(value.trim());
}

function renderChatMessageContent(value) {
  const content = normalizeChatContent(value);
  const trimmed = content.trim();

  if (isBase64ImageDataUrl(trimmed)) {
    return `<div class="chat-image-wrap"><img class="chat-image" src="${trimmed}" alt="Imagen generada por el chat" /></div>`;
  }

  const dataUrlPattern = /(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=\s]+)/g;
  const parts = content.split(dataUrlPattern);

  return parts
    .filter((part) => part)
    .map((part) => {
      const segment = part.trim();
      if (isBase64ImageDataUrl(segment)) {
        return `<div class="chat-image-wrap"><img class="chat-image" src="${segment}" alt="Imagen generada por el chat" /></div>`;
      }
      return `<div>${escapeHtml(part)}</div>`;
    })
    .join('');
}

function formatProviderLabel(provider) {
  const normalized = normalizeProviderId(provider);
  const labels = {
    openrouter: 'OpenRouter',
    groq: 'Groq',
    witai: 'Wit.ai',
    mistral: 'Mistral',
    codestral: 'Codestral',
    gemini: 'Gemini',
    cohere: 'Cohere',
    nvidia: 'NVIDIA',
    cerebras: 'Cerebras',
    alibaba: 'Alibaba',
    puter: 'Puter',
    qwenchat: 'Qwen Chat',
    pollinations: 'Pollinations',
  };
  return labels[normalized] || provider;
}

function formatServiceKeySource(item) {
  return item.source === 'system' ? 'Sistema' : 'Panel';
}

function renderServiceKeyPriorityCell(item) {
  if (item.isReadonly) {
    return '<span class="muted">Solo lectura</span>';
  }

  return `
    <form class="inline-form" data-form="update-service-key">
      <input type="hidden" name="id" value="${escapeHtml(item.id)}" />
      <input type="text" name="name" value="${escapeHtml(item.name)}" style="max-width: 180px;" />
      <input type="number" name="priority" min="1" value="${escapeHtml(item.priority)}" style="max-width: 92px;" />
      <button class="ghost-button" type="submit">Guardar</button>
    </form>
  `;
}

function renderServiceKeyStateCell(item) {
  const inCooldown = Number(item.cooldownUntil || 0) > Date.now();

  if (item.isReadonly) {
    return `
      <span class="tag ${inCooldown ? 'warn' : 'success'}">${inCooldown ? 'Cooldown' : 'Sistema'}</span>
      ${inCooldown ? `<div class="muted">Hasta ${escapeHtml(formatDate(item.cooldownUntil))}</div>` : ''}
    `;
  }

  return `
    <div class="button-row">
      <button class="${item.isActive ? 'ghost-button' : 'danger-button'}" type="button" data-action="toggle-service-key" data-id="${escapeHtml(item.id)}" data-active="${item.isActive}">
        ${item.isActive ? 'Activa' : 'Inactiva'}
      </button>
      <button class="danger-button" type="button" data-action="delete-service-key" data-id="${escapeHtml(item.id)}">
        Eliminar
      </button>
    </div>
  `;
}

function renderServiceKeyRows(serviceKeys) {
  return serviceKeys.map((item) => `
    <tr>
      <td>${escapeHtml(formatProviderLabel(item.provider))}</td>
      <td>${escapeHtml(formatServiceKeySource(item))}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.keyHint)}</td>
      <td>${renderServiceKeyPriorityCell(item)}</td>
      <td>${renderServiceKeyStateCell(item)}</td>
    </tr>
  `).join('') || '<tr><td colspan="6">Sin service keys registradas.</td></tr>';
}

function formatUsageStatusLabel(status) {
  return status === 'exceeded'
    ? 'Excedido'
    : status === 'warning'
      ? 'Alerta'
      : 'OK';
}

function formatUsageStatusClass(status) {
  return status === 'exceeded'
    ? 'danger'
    : status === 'warning'
      ? 'warn'
      : 'success';
}

function getAuthParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    invite: params.get('invite'),
    reset: params.get('reset'),
  };
}

function clearAuthParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  url.searchParams.delete('reset');
  window.history.replaceState({}, '', url);
}

function getProjectOptions() {
  return state.dashboard?.projects || [];
}

function setFlash(message, type = 'info', details = '') {
  state.flash = { message, type, details };
  render();
}

function clearFlash() {
  state.flash = null;
}

function formatApiErrorDetails(response, payload) {
  const requestId = response.headers.get('x-request-id') || null;
  const details = {
    status: response.status,
    requestId,
    payload,
  };

  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return `HTTP ${response.status}${requestId ? ` | requestId: ${requestId}` : ''}`;
  }
}

function buildFlashFromError(error, fallbackMessage) {
  if (error && typeof error === 'object') {
    return {
      message: typeof error.message === 'string' && error.message.trim() ? error.message : fallbackMessage,
      details: typeof error.flashDetails === 'string' ? error.flashDetails : '',
    };
  }

  return { message: fallbackMessage, details: '' };
}

async function apiRequest(url, options = {}) {
  const config = { method: 'GET', credentials: 'same-origin', ...options };
  const headers = new Headers(config.headers || {});

  if (config.body && !(config.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    config.body = JSON.stringify(config.body);
  }

  config.headers = headers;
  const response = await fetch(url, config);

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (response.status === 401 && !options.allow401) {
    const isAuthError = typeof payload === 'object' && payload?.error?.type === 'auth_error';
    if (isAuthError || url.startsWith('/api/')) {
      state.dashboard = null;
      state.me = null;
      state.mode = state.needsSetup ? 'bootstrap' : 'login';
      render();
      throw new Error('Sesion expirada');
    }
  }

  if (!response.ok) {
    const errorMessage = typeof payload === 'object' && payload?.error?.message
      ? payload.error.message
      : `HTTP ${response.status}`;
    const error = new Error(errorMessage);
    error.flashDetails = formatApiErrorDetails(response, payload);
    throw error;
  }

  return payload;
}

function formatDate(value) {
  if (!value) {
    return 'Nunca';
  }
  return new Date(value).toLocaleString();
}

function formatNumber(value) {
  return new Intl.NumberFormat('es-MX').format(Number(value || 0));
}

function formatTokenCount(value) {
  return `${formatNumber(value)} tok`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDuration(value) {
  const safe = Number(value || 0);
  return `${formatNumber(Math.round(safe))} ms`;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('es-MX', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatShortDate(value) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
  });
}

function formatBucketDate(bucket) {
  if (!bucket) {
    return '-';
  }

  const [year, month, day] = String(bucket).split('-').map((item) => Number(item));
  if (!year || !month || !day) {
    return bucket;
  }

  return new Date(year, month - 1, day).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
  });
}

function metricRatio(value, total) {
  if (!total || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function buildDailyMetricSeries(rows, days = 14) {
  const map = new Map((rows || []).map((item) => [item.bucket, item]));
  const output = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const bucket = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    const row = map.get(bucket);
    output.push({
      bucket,
      label: formatBucketDate(bucket),
      requestCount: row?.requestCount || 0,
      promptTokens: row?.promptTokens || 0,
      completionTokens: row?.completionTokens || 0,
      totalTokens: row?.totalTokens || 0,
      successCount: row?.successCount || 0,
      errorCount: row?.errorCount || 0,
      avgDurationMs: row?.avgDurationMs || 0,
    });
  }

  return output;
}

function renderTokenSplit(promptTokens, completionTokens, totalTokens = promptTokens + completionTokens) {
  return `
    <div class="token-split">
      <span>Env: ${formatTokenCount(promptTokens)}</span>
      <span>Rec: ${formatTokenCount(completionTokens)}</span>
      <strong>Total: ${formatTokenCount(totalTokens)}</strong>
    </div>
  `;
}

function renderMetricsTabNav(activeTab) {
  return `
    <div class="metrics-tabs">
      ${[
        ['overview', 'Resumen'],
        ['providers', 'Proveedores'],
        ['models', 'Modelos'],
        ['consumers', 'Consumo'],
        ['activity', 'Actividad'],
      ].map(([id, label]) => `
        <button class="${activeTab === id ? 'active' : ''}" type="button" data-action="switch-metrics-tab" data-tab="${id}">
          ${escapeHtml(label)}
        </button>
      `).join('')}
    </div>
  `;
}

function renderTrendChart(rows) {
  const series = buildDailyMetricSeries(rows, 14);
  const width = 760;
  const height = 240;
  const padding = 28;
  const maxValue = Math.max(1, ...series.map((item) => Math.max(item.promptTokens, item.completionTokens, item.totalTokens)));
  const stepX = series.length > 1 ? (width - (padding * 2)) / (series.length - 1) : 0;

  const polyline = (key) => series.map((item, index) => {
    const x = padding + (index * stepX);
    const y = height - padding - ((item[key] / maxValue) * (height - (padding * 2)));
    return `${x},${y}`;
  }).join(' ');

  const columns = series.map((item, index) => {
    const x = padding + (index * stepX) - 10;
    const barHeight = (item.totalTokens / maxValue) * (height - (padding * 2));
    const y = height - padding - barHeight;
    return `<rect x="${x}" y="${y}" width="20" height="${barHeight}" rx="8" class="trend-bar" />`;
  }).join('');

  const labels = series.map((item, index) => {
    const x = padding + (index * stepX);
    return `<text x="${x}" y="${height - 6}" text-anchor="middle">${escapeHtml(index % 2 === 0 ? item.label : '')}</text>`;
  }).join('');

  const dots = (key, className) => series.map((item, index) => {
    const x = padding + (index * stepX);
    const y = height - padding - ((item[key] / maxValue) * (height - (padding * 2)));
    return `<circle cx="${x}" cy="${y}" r="3.5" class="${className}" />`;
  }).join('');

  return `
    <div class="chart-card">
      <div class="row-between">
        <div>
          <h3>Tendencia diaria</h3>
          <p class="muted">Ultimos 14 dias con total de tokens y separacion entre enviados y recibidos.</p>
        </div>
        <div class="chart-legend">
          <span><i class="legend-dot total"></i>Total</span>
          <span><i class="legend-dot prompt"></i>Enviados</span>
          <span><i class="legend-dot completion"></i>Recibidos</span>
        </div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" class="trend-chart" role="img" aria-label="Tendencia diaria de tokens">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="chart-axis" />
        ${columns}
        <polyline points="${polyline('promptTokens')}" class="chart-line prompt" />
        <polyline points="${polyline('completionTokens')}" class="chart-line completion" />
        ${dots('promptTokens', 'chart-dot prompt')}
        ${dots('completionTokens', 'chart-dot completion')}
        ${labels}
      </svg>
    </div>
  `;
}

function renderLeaderboard(items, options = {}) {
  const {
    title = 'Distribucion',
    description = '',
    emptyMessage = 'Sin datos.',
    valueKey = 'totalTokens',
    labelKey = 'name',
    limit = 6,
  } = options;
  const safeItems = (items || []).slice(0, limit);
  const maxValue = Math.max(1, ...safeItems.map((item) => Number(item[valueKey] || 0)));

  return `
    <div class="chart-card">
      <div>
        <h3>${escapeHtml(title)}</h3>
        ${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}
      </div>
      <div class="leaderboard">
        ${safeItems.map((item) => `
          <div class="leaderboard-row">
            <div class="row-between">
              <strong>${escapeHtml(item[labelKey])}</strong>
              <span>${formatTokenCount(item.totalTokens || 0)}</span>
            </div>
            <div class="stack-bar">
              <span class="prompt" style="width:${metricRatio(item.promptTokens || 0, maxValue)}%"></span>
              <span class="completion" style="width:${metricRatio(item.completionTokens || 0, maxValue)}%"></span>
            </div>
            ${renderTokenSplit(item.promptTokens || 0, item.completionTokens || 0, item.totalTokens || 0)}
          </div>
        `).join('') || `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`}
      </div>
    </div>
  `;
}

function getAppName() {
  return state.dashboard?.settings?.appName || 'VagaRoute AI';
}

function getModelOptions() {
  const models = state.dashboard?.pool?.models || [];
  return [
    { id: 'auto', label: 'auto' },
    ...models.map((model) => ({ id: model.id, label: model.id })),
  ];
}

const PLAYGROUND_MODEL_GROUPS = {
  chat: [
    {
      label: 'Virtuales',
      options: [
        { id: 'auto', label: 'auto' },
        { id: 'tools', label: 'tools' },
        { id: 'img', label: 'img' },
      ],
    },
  ],
  images: [
    {
      label: 'Modelos nativos · Pollinations',
      options: [
        { id: 'flux', label: 'flux' },
        { id: 'sdxl', label: 'sdxl' },
        { id: 'turbo', label: 'turbo' },
        { id: 'playground', label: 'playground' },
        { id: 'illustrious', label: 'illustrious' },
      ],
    },
    {
      label: 'Modelos nativos · Qwen Chat',
      options: [
        { id: 'qwen-image', label: 'qwen-image' },
        { id: 'wan', label: 'wan' },
        { id: 'imagegeneration', label: 'imagegeneration' },
        { id: 'qwenimage', label: 'qwenimage' },
      ],
    },
  ],
  imageEdit: [
    {
      label: 'Modelos nativos · Qwen Chat',
      options: [
        { id: 'qwen-image-edit', label: 'qwen-image-edit' },
      ],
    },
  ],
  videos: [
    {
      label: 'Modelo nativo · Qwen Chat',
      options: [
        { id: 'qwen-video', label: 'qwen-video' },
      ],
    },
  ],
};

function getDashboardAliasCategory(categoryId) {
  const categories = Array.isArray(state.dashboard?.modelAliasCategories) ? state.dashboard.modelAliasCategories : [];
  return categories.find((category) => category.id === categoryId) || null;
}

function uniqueOptionList(values) {
  const seen = new Set();
  const options = [];
  for (const value of values || []) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    options.push({ id, label: id });
  }
  return options;
}

function playgroundSupportsModelSelection(key = state.currentPlayground) {
  return ['chat', 'images', 'imageEdit', 'videos'].includes(key);
}

function safeParsePlaygroundDraft(key = state.currentPlayground) {
  const draft = getPlaygroundDraft(key);
  if (typeof draft !== 'string' || !draft.trim() || !draft.trim().startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(draft);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getPlaygroundModelValue(key = state.currentPlayground) {
  if (!playgroundSupportsModelSelection(key)) {
    return null;
  }

  const parsed = safeParsePlaygroundDraft(key);
  if (!parsed) {
    return 'auto';
  }

  return typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : 'auto';
}

function getPlaygroundModelGroups(key = state.currentPlayground) {
  if (!playgroundSupportsModelSelection(key)) {
    return [];
  }

  const models = Array.isArray(state.dashboard?.pool?.models) ? state.dashboard.pool.models : [];
  const aliasCategory = getDashboardAliasCategory(key === 'imageEdit' ? 'imageEdit' : key);
  const aliasTargets = uniqueOptionList(aliasCategory?.targets || []);
  const grouped = key === 'chat'
    ? [
        ...PLAYGROUND_MODEL_GROUPS.chat,
        {
          label: 'Premium · Tier 1',
          options: models.filter((model) => !model.paidOnly && Number(model.tier) === 1).map((model) => ({ id: model.id, label: model.id })),
        },
        {
          label: 'Balanceado · Tier 2',
          options: models.filter((model) => !model.paidOnly && Number(model.tier) === 2).map((model) => ({ id: model.id, label: model.id })),
        },
        {
          label: 'Rapido · Tier 3',
          options: models.filter((model) => !model.paidOnly && Number(model.tier) === 3).map((model) => ({ id: model.id, label: model.id })),
        },
        {
          label: 'Pago',
          options: models.filter((model) => model.paidOnly).map((model) => ({ id: model.id, label: model.id })),
        },
        {
          label: 'Aliases de chat',
          options: uniqueOptionList((getDashboardAliasCategory('chat')?.targets || []).filter((id) => !models.some((model) => model.id === id))),
        },
      ]
    : [
        ...(PLAYGROUND_MODEL_GROUPS[key] || []),
        {
          label: key === 'images'
            ? 'Targets disponibles · Imágenes'
            : key === 'imageEdit'
              ? 'Targets disponibles · Edición'
              : 'Targets disponibles · Videos',
          options: aliasTargets,
        },
      ];

  const currentValue = getPlaygroundModelValue(key);
  const knownIds = new Set(grouped.flatMap((group) => group.options.map((option) => option.id)));
  if (currentValue && !knownIds.has(currentValue)) {
    grouped.unshift({
      label: 'Actual',
      options: [{ id: currentValue, label: `${currentValue} (no disponible)` }],
    });
  }

  return grouped.filter((group) => group.options.length > 0);
}

function setPlaygroundModelValue(modelId, key = state.currentPlayground) {
  if (!playgroundSupportsModelSelection(key)) {
    return;
  }

  const parsed = safeParsePlaygroundDraft(key) || safeParsePlaygroundDraftFromExample(key) || {};
  parsed.model = modelId;
  setPlaygroundDraft(key, JSON.stringify(parsed, null, 2));
}

function safeParsePlaygroundDraftFromExample(key) {
  const example = getPlaygroundExample(key);
  if (!example || typeof example.body !== 'string' || !example.body.trim().startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(example.body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function renderPlaygroundModelControl(key = state.currentPlayground) {
  if (key === 'audio') {
    const audioModel = state.playgroundAudioProvider === 'witai' ? 'speech' : 'whisper-large-v3';
    return `<label>Modelo
      <input value="${escapeHtml(audioModel)}" readonly />
    </label>`;
  }

  if (!playgroundSupportsModelSelection(key)) {
    return `<label>Modelo
      <input value="N/A" readonly />
    </label>`;
  }

  const modelValue = getPlaygroundModelValue(key) || 'auto';
  const groups = getPlaygroundModelGroups(key);

  return `<label>Modelo
    <select data-action="playground-model" id="playground-model-select">
      ${groups.map((group) => `<optgroup label="${escapeHtml(group.label)}">${group.options.map((option) => `<option value="${escapeHtml(option.id)}" ${modelValue === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</optgroup>`).join('')}
    </select>
  </label>`;
}

function getProviderRateLimitMap() {
  const rules = state.dashboard?.rateLimits?.providerRules || [];
  return new Map(rules.map((rule) => [rule.scopeId, rule]));
}

function getModelRateLimitMap() {
  const rules = state.dashboard?.rateLimits?.modelRules || [];
  return new Map(rules.map((rule) => [rule.scopeId, rule]));
}

function normalizeProviderId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('.', '')
    .replaceAll(' ', '')
    .replaceAll('_', '')
    .replaceAll('-', '');
}

function createEmptyLimitRule(scopeId, provider = null) {
  return {
    scopeId,
    provider,
    mode: 'none',
    rpm: null,
    rpd: null,
    tpm: null,
    tpd: null,
    ash: null,
    asd: null,
  };
}

function getProviderPoolState(providerId) {
  const providers = state.dashboard?.pool?.providers || [];
  return providers.find((item) => item.id === providerId) || null;
}

function renderLimitModeOptions(selectedMode = 'none') {
  return [
    ['none', 'Sin limite'],
    ['tokens', 'Solo tokens'],
    ['groq', 'Estilo Groq'],
  ].map(([value, label]) => `<option value="${value}" ${selectedMode === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function renderLimitFields(rule = createEmptyLimitRule('default')) {
  const safeRule = { ...createEmptyLimitRule(rule.scopeId || 'default', rule.provider || null), ...rule };
  const fieldValue = (value) => value == null ? '' : escapeHtml(value);

  return `
    <label>Modo
      <select name="mode">
        ${renderLimitModeOptions(safeRule.mode)}
      </select>
    </label>
    <div class="limit-field-grid">
      <label>RPM
        <input name="rpm" type="number" min="1" placeholder="30" value="${fieldValue(safeRule.rpm)}" />
      </label>
      <label>RPD
        <input name="rpd" type="number" min="1" placeholder="1000" value="${fieldValue(safeRule.rpd)}" />
      </label>
      <label>TPM
        <input name="tpm" type="number" min="1" placeholder="6000" value="${fieldValue(safeRule.tpm)}" />
      </label>
      <label>TPD
        <input name="tpd" type="number" min="1" placeholder="500000" value="${fieldValue(safeRule.tpd)}" />
      </label>
      <label>ASH
        <input name="ash" type="number" min="1" placeholder="7200" value="${fieldValue(safeRule.ash)}" />
      </label>
      <label>ASD
        <input name="asd" type="number" min="1" placeholder="28800" value="${fieldValue(safeRule.asd)}" />
      </label>
    </div>
  `;
}

function parseNullableNumber(value) {
  if (value === '' || value == null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function getLimitPayloadFromFormData(formData) {
  return {
    mode: String(formData.get('mode') || 'none'),
    rpm: parseNullableNumber(formData.get('rpm')),
    rpd: parseNullableNumber(formData.get('rpd')),
    tpm: parseNullableNumber(formData.get('tpm')),
    tpd: parseNullableNumber(formData.get('tpd')),
    ash: parseNullableNumber(formData.get('ash')),
    asd: parseNullableNumber(formData.get('asd')),
  };
}

function getMultiValueFormEntries(formData, key) {
  return formData.getAll(key)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function renderProjectModelPicker(selectedModelIds, availableModels) {
  if (!availableModels.length) {
    return '<div class="muted">No hay modelos cargados en el pool.</div>';
  }

  const selected = new Set(selectedModelIds || []);
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.5rem;max-height:220px;overflow:auto;padding:0.75rem;border:1px solid var(--border-color);border-radius:12px;background:rgba(255,255,255,0.02);">
      ${availableModels.map((model) => `
        <label style="display:flex;gap:0.55rem;align-items:flex-start;">
          <input type="checkbox" name="allowedModelIds" value="${escapeHtml(model.id)}" ${selected.has(model.id) ? 'checked' : ''} />
          <span>
            <strong style="display:block;">${escapeHtml(model.id)}</strong>
            <span class="muted" style="display:block;">${escapeHtml(model.provider)}${model.supportsTools ? ' · tools' : ''}${model.supportsVision ? ' · vision' : ''}</span>
          </span>
        </label>
      `).join('')}
    </div>
  `;
}

function getPlaygroundExamples() {
  const baseUrl = window.location.origin;
  return {
    chat: {
      title: '/v1/chat/completions',
      description: 'Chat compatible con OpenAI con routing automatico entre proveedores.',
      systemPrompt: 'Eres un asistente conciso y experto en automatizacion.',
      inputLabel: 'Input',
      curl: `curl ${baseUrl}/v1/chat/completions \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "auto",\n    "stream": false,\n    "messages": [\n      { "role": "user", "content": "Resume el estado del sistema." }\n    ]\n  }'`,
      javascript: `const response = await fetch("${baseUrl}/v1/chat/completions", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({\n    model: "auto",\n    stream: false,\n    messages: [\n      { role: "user", content: "Resume el estado del sistema." }\n    ]\n  })\n});\n\nconst data = await response.json();\nconsole.log(data);`,
      body: `{\n  "model": "auto",\n  "stream": false,\n  "messages": [\n    { "role": "user", "content": "Resume el estado del sistema." }\n  ]\n}`,
      response: `{\n  "id": "chatcmpl_xxx",\n  "object": "chat.completion",\n  "model": "Groq/llama-3.3-70b",\n  "choices": [\n    {\n      "message": {\n        "role": "assistant",\n        "content": "El sistema esta operativo y el pool tiene proveedores activos."\n      }\n    }\n  ]\n}`,
    },
    models: {
      title: '/v1/models',
      description: 'Lista todos los modelos visibles para el router, incluyendo aliases virtuales.',
      systemPrompt: 'Sin instrucciones del sistema para este endpoint.',
      inputLabel: 'Request',
      curl: `curl ${baseUrl}/v1/models -H "Authorization: Bearer YOUR_API_KEY"`,
      javascript: `const response = await fetch("${baseUrl}/v1/models", {\n  headers: { "Authorization": "Bearer YOUR_API_KEY" }\n});\n\nconst data = await response.json();\nconsole.log(data.data);`,
      body: 'GET /v1/models',
      response: `{\n  "object": "list",\n  "data": [\n    { "id": "auto", "owned_by": "system" },\n    { "id": "Groq/llama-3.3-70b", "owned_by": "Groq" }\n  ]\n}`,
    },
    embeddings: {
      title: '/v1/embeddings',
      description: 'Embeddings con failover Mistral -> Cohere.',
      systemPrompt: 'Usa este endpoint para indexacion, busqueda o RAG.',
      inputLabel: 'Input',
      curl: `curl ${baseUrl}/v1/embeddings \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "input": ["documento uno", "documento dos"]\n  }'`,
      javascript: `const response = await fetch("${baseUrl}/v1/embeddings", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ input: ["documento uno", "documento dos"] })\n});\n\nconst data = await response.json();\nconsole.log(data);`,
      body: `{\n  "input": ["documento uno", "documento dos"]\n}`,
      response: `{\n  "object": "list",\n  "model": "mistral-embed",\n  "data": [\n    { "object": "embedding", "index": 0, "embedding": [0.01, 0.02] }\n  ]\n}`,
    },
    images: {
      title: '/v1/images/generations',
      description: 'Generacion de imagenes lo mas compatible posible con OpenAI. El backend se resuelve por modelo y disponibilidad.',
      systemPrompt: 'Describe visualmente el resultado esperado y el estilo.',
      inputLabel: 'Prompt',
      curl: `curl ${baseUrl}/v1/images/generations \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "prompt": "A warm dashboard illustration",\n    "model": "flux"\n  }'`,
      javascript: `const response = await fetch("${baseUrl}/v1/images/generations", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_KEY",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({\n    prompt: "A warm dashboard illustration",\n    model: "flux"\n  })\n});\n\nconst data = await response.json();\nconsole.log(data);`,
      body: `{\n  "prompt": "A warm dashboard illustration",\n  "model": "flux"\n}`,
      response: `{\n  "created": 1710000000,\n  "data": [\n    { "url": "data:image/jpeg;base64,/9j..." }\n  ]\n}`,
    },
    imageEdit: {
      title: '/v1/images/edits',
      description: 'Edicion de imagenes con contrato compatible con OpenAI usando URL remota, archivo local o base64.',
      systemPrompt: 'Indica claramente que partes de la imagen quieres preservar y que debe cambiar.',
      inputLabel: 'JSON body',
      curl: `curl ${baseUrl}/v1/images/edits \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Add a neon skyline in the background",
    "image": "https://download.samplelib.com/png/sample-hut-400x300.png",
    "response_format": "url"
  }'`,
      javascript: `const response = await fetch("${baseUrl}/v1/images/edits", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    prompt: "Add a neon skyline in the background",
    image: "https://download.samplelib.com/png/sample-hut-400x300.png",
    response_format: "url"
  })
});

const data = await response.json();
console.log(data);`,
      body: `{
  "prompt": "Add a neon skyline in the background",
  "image": "https://download.samplelib.com/png/sample-hut-400x300.png",
  "response_format": "url"
}`,
      response: `{
  "created": 1710000000,
  "data": [
    { "url": "https://cdn.example.com/edited-image.png" }
  ]
}`,
    },
    videos: {
      title: '/v1/videos',
      description: 'Generacion de video desde el playground con el alias mas cercano al contrato de OpenAI disponible en este gateway.',
      systemPrompt: 'Describe escena, encuadre, movimiento de camara y duracion esperada.',
      inputLabel: 'JSON body',
      curl: `curl ${baseUrl}/v1/videos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cinematic drone shot over a futuristic city",
    "model": "qwen-video",
    "size": "1280x720"
  }'`,
      javascript: `const response = await fetch("${baseUrl}/v1/videos", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    prompt: "A cinematic drone shot over a futuristic city",
    model: "qwen-video",
    size: "1280x720"
  })
});

const data = await response.json();`,
      body: `{
  "prompt": "A cinematic drone shot over a futuristic city",
  "model": "qwen-video",
  "size": "1280x720"
}`,
      response: `{
  "created": 1710000000,
  "data": [
    { "url": "https://cdn.example.com/generated-video.mp4" }
  ]
}`,
    },
    audio: {
      title: '/v1/audio/transcriptions',
      description: 'Transcripcion de audio usando Groq o Wit.ai con llaves rotativas por proveedor.',
      systemPrompt: 'Sube audio, elige proveedor y opcionalmente define idioma para Groq.',
      inputLabel: 'Form data',
      curl: `curl ${baseUrl}/v1/audio/transcriptions \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -F "file=@audio.mp3" \\\n  -F "provider=witai" \\\n  -F "language=es" \\\n  -F "duration_seconds=45"`,
      javascript: `const form = new FormData();\nform.append("file", audioFile);\nform.append("provider", "witai"); // o "groq"\nform.append("language", "es"); // Groq usa este campo; Wit.ai lo ignora\nform.append("duration_seconds", "45"); // opcional, ayuda al cooldown preventivo por audio\n\nconst response = await fetch("${baseUrl}/v1/audio/transcriptions", {\n  method: "POST",\n  headers: { "Authorization": "Bearer YOUR_API_KEY" },\n  body: form\n});\n\nconst data = await response.json();`,
      body: 'multipart/form-data',
      response: `{\n  "text": "Esta es la transcripcion del audio enviado."\n}`,
    },
    metrics: {
      title: '/v1/metrics',
      description: 'Metricas consolidadas con tendencia diaria y split de tokens enviados y recibidos.',
      systemPrompt: 'Consulta estado operativo, rate limits y uso.',
      inputLabel: 'Request',
      curl: `curl ${baseUrl}/v1/metrics -H "Authorization: Bearer YOUR_API_KEY"`,
      javascript: `const response = await fetch("${baseUrl}/v1/metrics", {\n  headers: { "Authorization": "Bearer YOUR_API_KEY" }\n});\n\nconst data = await response.json();\nconsole.log(data);`,
      body: 'GET /v1/metrics',
      response: `{\n  "summary": {\n    "successRate": 99.2,\n    "promptTokens": 120340,\n    "completionTokens": 84321\n  },\n  "daily_metrics": [\n    { "bucket": "2026-03-24", "promptTokens": 8400, "completionTokens": 6200 }\n  ],\n  "provider_metrics": [\n    { "provider": "Groq", "totalRequests": 124, "promptTokens": 70000, "completionTokens": 49000 }\n  ]\n}`,
    },
  };
}

function getPlaygroundExample(key = state.currentPlayground) {
  return getPlaygroundExamples()[key];
}

function getPlaygroundDraft(key = state.currentPlayground) {
  const example = getPlaygroundExample(key);
  if (!state.playgroundBodies[key]) {
    state.playgroundBodies[key] = example.body;
  }
  return state.playgroundBodies[key];
}

function setPlaygroundDraft(key, value) {
  state.playgroundBodies[key] = value;
}

function getPlaygroundModelLabel(key = state.currentPlayground) {
  if (key === 'audio') {
    return state.playgroundAudioProvider === 'witai' ? 'speech' : 'whisper-large-v3';
  }
  if (key === 'models' || key === 'metrics') {
    return 'N/A';
  }

  const draft = getPlaygroundDraft(key);
  if (typeof draft !== 'string' || !draft.trim() || !draft.trim().startsWith('{')) {
    return 'N/A';
  }

  try {
    const parsed = JSON.parse(draft);
    return typeof parsed?.model === 'string' && parsed.model.trim() ? parsed.model.trim() : 'Auto';
  } catch {
    return 'JSON invalido';
  }
}

function extractPlaygroundErrorPayload(payload, fallbackStatus) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const error = payload.error && typeof payload.error === 'object' ? payload.error : null;
    return {
      message: typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : `HTTP ${fallbackStatus}`,
      type: typeof error?.type === 'string' ? error.type : null,
      code: typeof error?.code === 'string' || typeof error?.code === 'number' ? String(error.code) : null,
      payload,
    };
  }

  return {
    message: typeof payload === 'string' && payload.trim() ? payload.trim() : `HTTP ${fallbackStatus}`,
    type: null,
    code: null,
    payload,
  };
}

function formatPlaygroundFailure(details) {
  const parts = [details.endpoint, `HTTP ${details.status}`, details.type, details.code, details.message]
    .filter(Boolean);
  return parts.join(' | ');
}

function formatPlaygroundConsolePayload(payload) {
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsDataURL(file);
  });
}

function buildPlaygroundHeaders(isJson = true) {
  const headers = new Headers();
  if (state.playgroundAuthMode === 'apiKey' && state.playgroundApiKey.trim()) {
    const token = state.playgroundApiKey.trim();
    headers.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`);
  }
  if (isJson) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

async function executePlaygroundRequest() {
  const example = getPlaygroundExample();
  const draft = getPlaygroundDraft();
  const startedAt = Date.now();
  let requestPayload = null;
  const selectedImageEditFile = state.currentPlayground === 'imageEdit'
    ? (() => {
      const input = document.querySelector('#playground-image-edit-file');
      return input instanceof HTMLInputElement ? input.files?.[0] || null : null;
    })()
    : null;
  const selectedAudioFile = state.currentPlayground === 'audio'
    ? (() => {
      const input = document.querySelector('#playground-audio-file');
      return input instanceof HTMLInputElement ? input.files?.[0] || null : null;
    })()
    : null;
  state.playgroundBusy = true;
  state.playgroundResponse = {
    status: 'running',
    elapsedMs: 0,
    data: 'Ejecutando request...',
  };
  render();

  try {
    let response;
    if (state.currentPlayground === 'chat') {
      const payload = JSON.parse(draft);
      requestPayload = payload;
      response = await fetch('/v1/chat/completions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(true),
        body: JSON.stringify(payload),
      });
    } else if (state.currentPlayground === 'embeddings') {
      const payload = JSON.parse(draft);
      requestPayload = payload;
      response = await fetch('/v1/embeddings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(true),
        body: JSON.stringify(payload),
      });
    } else if (state.currentPlayground === 'images') {
      const payload = JSON.parse(draft);
      requestPayload = payload;
      response = await fetch('/v1/images/generations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(true),
        body: JSON.stringify(payload),
      });
    } else if (state.currentPlayground === 'imageEdit') {
      const payload = JSON.parse(draft);
      if (selectedImageEditFile) {
        payload.image = await readFileAsDataUrl(selectedImageEditFile);
      }
      requestPayload = payload;
      response = await fetch('/v1/images/edits', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(true),
        body: JSON.stringify(payload),
      });
    } else if (state.currentPlayground === 'videos') {
      const payload = JSON.parse(draft);
      requestPayload = payload;
      response = await fetch('/v1/videos', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(true),
        body: JSON.stringify(payload),
      });
    } else if (state.currentPlayground === 'metrics') {
      response = await fetch('/v1/metrics', {
        method: 'GET',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(false),
      });
    } else if (state.currentPlayground === 'models') {
      response = await fetch('/v1/models', {
        method: 'GET',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(false),
      });
    } else if (state.currentPlayground === 'audio') {
      if (!selectedAudioFile) {
        throw new Error('Selecciona un archivo de audio para probar transcripciones.');
      }
      const form = new FormData();
      form.append('file', selectedAudioFile);
      form.append('provider', state.playgroundAudioProvider);
      if (state.playgroundAudioLanguage.trim()) {
        form.append('language', state.playgroundAudioLanguage.trim());
      }
      response = await fetch('/v1/audio/transcriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildPlaygroundHeaders(false),
        body: form,
      });
    } else {
      throw new Error(`No hay executor para ${example.title}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    const serialized = formatPlaygroundConsolePayload(payload);

    state.playgroundResponse = {
      status: response.ok ? response.status : `HTTP ${response.status}`,
      elapsedMs: Date.now() - startedAt,
      data: serialized,
    };

    if (!response.ok) {
      const parsedError = extractPlaygroundErrorPayload(payload, response.status);
      const failureDetails = {
        endpoint: example.title,
        status: response.status,
        requestId: response.headers.get('x-request-id') || null,
        type: parsedError.type,
        code: parsedError.code,
        message: parsedError.message,
        requestPayload,
        responsePayload: parsedError.payload,
      };
      console.error('[Playground] Request failed', failureDetails);
      throw Object.assign(new Error(formatPlaygroundFailure(failureDetails)), {
        playgroundDetails: failureDetails,
      });
    }

    if (state.mode === 'app') {
      await refreshDashboard();
    }
  } catch (error) {
    const details = error?.playgroundDetails || null;
    state.playgroundResponse = {
      status: details ? `HTTP ${details.status}` : 'error',
      elapsedMs: Date.now() - startedAt,
      data: details ? JSON.stringify(details, null, 2) : (error.message || 'No se pudo ejecutar la peticion.'),
    };
    if (!details) {
      console.error('[Playground] Request crashed', {
        endpoint: example.title,
        message: error.message || 'No se pudo ejecutar la peticion.',
        requestPayload,
        error,
      });
    }
    throw error;
  } finally {
    state.playgroundBusy = false;
    render();
  }
}

function flashMarkup() {
  if (!state.flash && !state.lastCreatedApiKey) {
    return '';
  }

  const flash = state.flash
    ? `<div class="flash ${state.flash.type === 'error' ? 'error' : ''}">
        <div class="row-between">
          <strong>${escapeHtml(state.flash.type === 'error' ? 'Atencion' : 'Actualizacion')}</strong>
          <button class="ghost-button" data-action="dismiss-flash">Cerrar</button>
        </div>
        <p>${escapeHtml(state.flash.message)}</p>
        ${state.flash.details ? `<div class="code-block">${escapeHtml(state.flash.details)}</div>` : ''}
      </div>`
    : '';

  const apiKeyFlash = state.lastCreatedApiKey
    ? `<div class="flash">
        <div class="row-between">
          <strong>${escapeHtml(state.sharedValueKind === 'invite-link' ? 'Link de invitacion' : state.sharedValueKind === 'reset-link' ? 'Link de recuperacion' : 'API key generada')}</strong>
          <button class="secondary-button" data-action="copy-last-api-key">Copiar</button>
        </div>
        <p>${escapeHtml(state.sharedValueKind === 'invite-link' ? 'Copialo y compartelo antes de que expire.' : state.sharedValueKind === 'reset-link' ? 'Copialo ahora y usalo para definir una nueva contrasena.' : 'Guardala ahora porque despues no se vuelve a mostrar.')}</p>
        <div class="code-block">${escapeHtml(state.lastCreatedApiKey)}</div>
      </div>`
    : '';

  return `${flash}${apiKeyFlash}`;
}

function renderAuthCard({ title, subtitle, body, sideTitle, sideText, sideList }) {
  return `
    <div class="auth-layout">
      <section class="auth-card">
        <div class="auth-copy">
          <p class="tag">Router seguro</p>
          <h1>${escapeHtml(sideTitle)}</h1>
          <p>${escapeHtml(sideText)}</p>
          <ul>
            ${sideList.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
        <div class="auth-form">
          <div>
            <img src="/logo.png" alt="VagaRoute AI Logo" style="max-height: 64px; margin-bottom: 1.5rem; border-radius: 12px; display: block;" />
            <p class="tag">${escapeHtml(getAppName())}</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="muted">${escapeHtml(subtitle)}</p>
          </div>
          ${flashMarkup()}
          ${body}
        </div>
      </section>
    </div>
  `;
}

function renderBootstrap() {
  return renderAuthCard({
    title: 'Registro inicial',
    subtitle: 'Crea la primera cuenta administradora. Esta pantalla no volvera a mostrarse despues del setup.',
    sideTitle: 'Primer arranque del router',
    sideText: 'Aqui nace la cuenta raiz del panel. Desde ella vas a gestionar usuarios, llaves, limites, proveedores y metricas.',
    sideList: [
      'Se crea la cuenta admin y su primera API key.',
      'El panel quedara listo para chat, playground y configuracion.',
      'Las sesiones expiran y el sistema volvera al login cuando corresponda.',
    ],
    body: `
      <form data-form="bootstrap">
        <label>Nombre
          <input name="name" placeholder="Admin principal" required />
        </label>
        <label>Correo
          <input name="email" type="email" placeholder="admin@empresa.com" required />
        </label>
        <label>Contrasena
          <input name="password" type="password" placeholder="Minimo 8 caracteres" required />
        </label>
        <button class="primary-button" type="submit">Crear cuenta administradora</button>
      </form>
    `,
  });
}

function renderLogin() {
  const authParams = getAuthParams();
  const invite = state.invitePreview;

  if (state.authMode === 'invite' && authParams.invite) {
    return renderAuthCard({
      title: 'Aceptar invitacion',
      subtitle: invite?.projectName
        ? `Te vas a unir a ${invite.projectName}.`
        : 'Activa tu acceso con este link temporal.',
      sideTitle: 'Acceso guiado',
      sideText: 'Este flujo crea tu cuenta, te asigna al proyecto y te deja dentro del panel de una vez.',
      sideList: [
        'La invitacion puede traer proyecto y rol preconfigurados.',
        'Recibes una API key inicial para usar el router.',
        'Al terminar quedas con sesion iniciada.',
      ],
      body: `
        <form data-form="accept-invite">
          ${invite?.email ? `<div class="tag">${escapeHtml(invite.email)}</div>` : `
            <label>Correo
              <input name="email" type="email" placeholder="tu@correo.com" required />
            </label>
          `}
          <label>Nombre
            <input name="name" placeholder="Tu nombre" required />
          </label>
          <label>Contrasena
            <input name="password" type="password" minlength="8" placeholder="Minimo 8 caracteres" required />
          </label>
          <button class="primary-button" type="submit">Activar acceso</button>
          <button class="ghost-button" type="button" data-action="switch-auth-mode" data-mode="login">Volver al login</button>
        </form>
      `,
    });
  }

  if (state.authMode === 'reset-confirm' && authParams.reset) {
    return renderAuthCard({
      title: 'Definir nueva contrasena',
      subtitle: 'Este link temporal te permite recuperar el acceso.',
      sideTitle: 'Recuperacion segura',
      sideText: 'Cuando guardes la nueva contrasena, el link dejara de servir.',
      sideList: [
        'El token expira automaticamente.',
        'La contrasena debe tener al menos 8 caracteres.',
        'Despues podras volver a iniciar sesion normalmente.',
      ],
      body: `
        <form data-form="password-reset-confirm">
          <label>Nueva contrasena
            <input name="password" type="password" minlength="8" placeholder="Minimo 8 caracteres" required />
          </label>
          <button class="primary-button" type="submit">Guardar contrasena</button>
          <button class="ghost-button" type="button" data-action="switch-auth-mode" data-mode="login">Volver al login</button>
        </form>
      `,
    });
  }

  if (state.authMode === 'reset-request') {
    return renderAuthCard({
      title: 'Recuperar contrasena',
      subtitle: 'Genera un link temporal para volver a entrar.',
      sideTitle: 'Reset asistido',
      sideText: 'Si todavia no tienes mail transaccional, el panel te mostrara el link temporal para copiarlo.',
      sideList: [
        'Usa el correo exacto de tu cuenta.',
        'El link temporal expira automaticamente.',
        'Puedes volver al login cuando quieras.',
      ],
      body: `
        <form data-form="password-reset-request">
          <label>Correo
            <input name="email" type="email" placeholder="tu@correo.com" required />
          </label>
          <button class="primary-button" type="submit">Generar link temporal</button>
          <button class="ghost-button" type="button" data-action="switch-auth-mode" data-mode="login">Volver al login</button>
        </form>
      `,
    });
  }

  return renderAuthCard({
    title: 'Iniciar sesion',
    subtitle: 'Accede al panel para gestionar el router y probar los endpoints.',
    sideTitle: 'Control central del API',
    sideText: 'El panel unifica operacion, playground, usuarios, service keys y metricas por proveedor y modelo.',
    sideList: [
      'Sesiones con expiracion controlada.',
      'API keys por usuario con rate limits editables.',
      'Rotacion de llaves de proveedor cuando una se agota.',
    ],
    body: `
      <form data-form="login">
        <label>Correo
          <input name="email" type="email" placeholder="tu@correo.com" required />
        </label>
        <label>Contrasena
          <input name="password" type="password" placeholder="Tu contrasena" required />
        </label>
        <button class="primary-button" type="submit">Entrar al panel</button>
        <div class="button-row" style="margin-top: 0.75rem;">
          <button class="ghost-button" type="button" data-action="switch-auth-mode" data-mode="reset-request">Olvide mi contrasena</button>
        </div>
      </form>
    `,
  });
}

function renderOverview() {
  const dashboard = state.dashboard;
  const metrics = dashboard.metrics;
  const pool = dashboard.pool;
  const hottestModels = dashboard.modelTelemetry.slice(0, 10);
  const alerts = dashboard.alerts || [];
  const recentErrors = dashboard.recentErrors || [];
  const tokens = dashboard.tokens || { currentMonthTokens: 0, projectedMonthTokens: 0 };
  const cache = dashboard.cache || { enabled: false, backend: 'disabled', entries: 0, hits: 0, misses: 0, hitRate: 0, ttlSeconds: 0 };
  const tokenization = dashboard.tokenization || { mode: 'fallback', exactForCompletedResponses: false };
  const activeProviders = pool.providers.filter((provider) => provider.status === 'available').length;

  return `
    <section class="grid-3">
      <article class="stat-card">
        <span class="muted">Requests totales</span>
        <strong>${formatNumber(metrics.totals.requests)}</strong>
        <small>Acumulados en la telemetria del router.</small>
      </article>
      <article class="stat-card">
        <span class="muted">Tokens del mes</span>
        <strong>${formatTokenCount(tokens.currentMonthTokens)}</strong>
        <small>Proyeccion: ${formatTokenCount(tokens.projectedMonthTokens)}</small>
      </article>
      <article class="stat-card">
        <span class="muted">Salud del sistema</span>
        <strong>${formatNumber(activeProviders)}/${formatNumber(pool.providers.length)}</strong>
        <small>${formatNumber(pool.cooldown)} modelos en cooldown y ${formatNumber(alerts.length)} alertas activas.</small>
      </article>
    </section>

    <section class="grid-2">
      <article class="panel">
        <div class="row-between">
          <div>
            <h3>Estado del pool</h3>
            <p class="muted">Visibilidad rapida de disponibilidad, vision, tools y proyectos activos.</p>
          </div>
          <button class="ghost-button" data-action="refresh-dashboard">Actualizar</button>
        </div>
        <p class="muted">${formatNumber(metrics.totals.projects)} proyectos, ${formatNumber(metrics.totals.users)} usuarios, ${formatNumber(metrics.totals.serviceApiKeys)} service keys.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Proveedor</th>
                <th>Capacidades</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${pool.models.slice(0, 12).map((model) => `
                <tr>
                  <td>${escapeHtml(model.id)}</td>
                  <td>${escapeHtml(model.provider)}</td>
                  <td>${model.supportsTools ? 'tools ' : ''}${model.supportsVision ? 'vision' : ''}</td>
                  <td><span class="tag ${model.status === 'available' ? 'success' : model.status === 'cooldown' ? 'warn' : 'danger'}">${escapeHtml(model.status)}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <h3>Modelos mas usados</h3>
        <p class="muted">Basado en la telemetria persistida del router.</p>
        ${hottestModels.length === 0 ? '<div class="empty-state">Todavia no hay trafico registrado.</div>' : hottestModels.map((item) => {
          const width = Math.min(100, item.requests_served * 5 || 3);
          return `
            <div style="margin-bottom: 0.9rem;">
              <div class="row-between">
                <strong>${escapeHtml(item.id)}</strong>
                <span>${formatNumber(item.requests_served)} req</span>
              </div>
              <div class="meter"><span style="width:${width}%"></span></div>
            </div>
        `;
        }).join('')}
      </article>
    </section>

    <section class="grid-2">
      <article class="panel">
        <h3>Cache de respuestas</h3>
        <p class="muted">Reduce latencia y consumo repetido en chat no-stream cuando la solicitud es repetible.</p>
        <div class="grid-3">
          <article class="panel" style="padding: 0.9rem;">
            <span class="muted">Backend</span>
            <strong>${escapeHtml(cache.enabled ? cache.backend : 'disabled')}</strong>
          </article>
          <article class="panel" style="padding: 0.9rem;">
            <span class="muted">Hit rate</span>
            <strong>${escapeHtml(`${cache.hitRate}%`)}</strong>
          </article>
          <article class="panel" style="padding: 0.9rem;">
            <span class="muted">Entradas activas</span>
            <strong>${formatNumber(cache.entries)}</strong>
          </article>
        </div>
        <p class="muted">Hits: ${formatNumber(cache.hits)} | Misses: ${formatNumber(cache.misses)} | TTL: ${formatNumber(cache.ttlSeconds)}s</p>
      </article>

      <article class="panel">
        <h3>Tokenizacion</h3>
        <p class="muted">El backend toma uso exacto del provider cuando el stream lo reporta y usa fallback seguro cuando no existe.</p>
        <div class="grid-2">
          <article class="panel" style="padding: 0.9rem;">
            <span class="muted">Modo</span>
            <strong>${escapeHtml(tokenization.mode)}</strong>
          </article>
          <article class="panel" style="padding: 0.9rem;">
            <span class="muted">Conteo exacto</span>
            <strong>${tokenization.exactForCompletedResponses ? 'Activo' : 'Fallback'}</strong>
          </article>
        </div>
      </article>
    </section>

    <section class="grid-2">
      <article class="panel">
        <h3>Alertas activas</h3>
        <p class="muted">Consumo alto, proveedores degradados y capacidad.</p>
        ${alerts.length === 0 ? '<div class="empty-state">Sin alertas por ahora.</div>' : `
          <div class="settings-nav-list">
            ${alerts.map((alert) => `
              <article class="panel" style="padding: 0.9rem;">
                <div class="row-between">
                  <strong>${escapeHtml(alert.title)}</strong>
                  <span class="tag ${alert.severity === 'error' ? 'danger' : alert.severity === 'warning' ? 'warn' : ''}">${escapeHtml(alert.severity)}</span>
                </div>
                <p class="muted">${escapeHtml(alert.message)}</p>
              </article>
            `).join('')}
          </div>
        `}
      </article>

      <article class="panel">
        <h3>Errores recientes</h3>
        <p class="muted">Ultimos fallos visibles para triage rapido.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ruta</th>
                <th>Proveedor</th>
                <th>Status</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${recentErrors.map((item) => `
                <tr>
                  <td>${escapeHtml(item.path)}</td>
                  <td>${escapeHtml(item.provider ? formatProviderLabel(item.provider) : '-')}</td>
                  <td>${formatNumber(item.statusCode)}</td>
                  <td>${escapeHtml(item.errorMessage || item.model || '-')}</td>
                </tr>
              `).join('') || '<tr><td colspan="4">Sin errores recientes.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderChat() {
  const modelOptions = getModelOptions();
  return `
    <section class="chat-card">
      <div class="row-between">
        <div>
          <h3>Chat de pruebas</h3>
          <p class="muted">Usa la misma API del router sin salir del panel.</p>
        </div>
        <label style="min-width: 220px;">
          Modelo
          <select id="chat-model-select" name="model" data-action="chat-model">
            ${modelOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${state.chatModel === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="chat-log" id="chat-log">
        ${state.chatMessages.map((message) => `
          <div class="bubble ${escapeHtml(message.role)}">
            <strong>${message.role === 'assistant' ? 'Router' : message.role === 'user' ? 'Tu' : 'Sistema'}</strong>
            <div>${renderChatMessageContent(message.content)}</div>
          </div>
        `).join('')}
      </div>
      <form data-form="chat">
        <label>Mensaje
          <textarea name="message" data-action="chat-draft" placeholder="Escribe aqui para probar /v1/chat/completions" required>${escapeHtml(state.chatDraft)}</textarea>
        </label>
        <div class="button-row">
          <button class="primary-button" type="submit">${state.busy ? 'Enviando...' : 'Enviar al router'}</button>
          <button class="ghost-button" type="button" data-action="clear-chat">Limpiar chat</button>
        </div>
      </form>
    </section>
  `;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    const chatLog = document.querySelector('#chat-log');
    if (chatLog instanceof HTMLElement) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  });
}

function renderPlayground() {
  const examples = getPlaygroundExamples();
  const active = examples[state.currentPlayground];
  const draft = getPlaygroundDraft();
  const currentSnippet = state.currentPlaygroundTab === 'javascript' ? active.javascript : active.curl;
  const responseMarkup = state.playgroundResponse
    ? `
      <div class="playground-response">
        <div class="row-between">
          <strong>Live response</strong>
          <span class="tag">${escapeHtml(state.playgroundResponse.status)}</span>
        </div>
        <p class="muted">Tiempo: ${escapeHtml(state.playgroundResponse.elapsedMs)} ms</p>
        <div class="playground-code">${escapeHtml(state.playgroundResponse.data)}</div>
      </div>
    `
    : `
      <div class="playground-response">
        <strong>Live response</strong>
        <p class="muted">Ejecuta una prueba y aqui veras el resultado real del endpoint.</p>
      </div>
    `;
  return `
    <section class="playground-shell">
      <aside class="playground-menu">
        <div>
          <h3>Playground</h3>
          <p class="muted">Diseño operativo inspirado en OpenAI para probar y documentar cada endpoint.</p>
        </div>
        ${Object.keys(examples).map((key) => `
          <button class="${state.currentPlayground === key ? 'secondary-button' : 'ghost-button'}" type="button" data-action="pick-playground" data-playground="${key}">
            ${escapeHtml(examples[key].title)}
          </button>
        `).join('')}
      </aside>

      <div class="playground-stage">
        <div class="playground-toolbar">
          <div>
            <span class="tag">${escapeHtml(active.title)}</span>
            <h3 style="margin: 0.75rem 0 0.35rem;">${escapeHtml(active.description)}</h3>
            <p class="muted" style="margin: 0;">Base URL: ${escapeHtml(window.location.origin)}</p>
          </div>
          <div class="playground-toolbar-grid">
            <label>Autenticacion
              <select data-action="playground-auth-mode" id="playground-auth-mode">
                <option value="session" ${state.playgroundAuthMode === 'session' ? 'selected' : ''}>Sesion actual</option>
                <option value="apiKey" ${state.playgroundAuthMode === 'apiKey' ? 'selected' : ''}>API key manual</option>
              </select>
            </label>
            ${renderPlaygroundModelControl()}
            <label>Modo
              <input value="OpenAI compatible" readonly />
            </label>
          </div>
        </div>

        ${state.playgroundAuthMode === 'apiKey' ? `
          <label>API key para pruebas
            <input id="playground-api-key" data-action="playground-api-key" value="${escapeHtml(state.playgroundApiKey)}" placeholder="router_xxx o Bearer token" />
          </label>
        ` : ''}

        <div class="playground-columns">
          <section class="playground-editor">
            <label>Instructions
              <textarea readonly>${escapeHtml(active.systemPrompt)}</textarea>
            </label>
            ${state.currentPlayground === 'audio' ? `
              <label>Archivo de audio
                <input id="playground-audio-file" type="file" accept="audio/*" />
              </label>
              <label>Proveedor
                <select data-action="playground-audio-provider">
                  <option value="groq" ${state.playgroundAudioProvider === 'groq' ? 'selected' : ''}>Groq</option>
                  <option value="witai" ${state.playgroundAudioProvider === 'witai' ? 'selected' : ''}>Wit.ai</option>
                </select>
              </label>
              <label>Language
                <input id="playground-audio-language" data-action="playground-audio-language" value="${escapeHtml(state.playgroundAudioLanguage)}" placeholder="es" />
              </label>
              <label>${escapeHtml(active.inputLabel)}
                <textarea readonly>${escapeHtml(active.body)}</textarea>
              </label>
            ` : state.currentPlayground === 'imageEdit' ? `
              <label>Imagen local opcional
                <input id="playground-image-edit-file" type="file" accept="image/*" />
              </label>
              <p class="muted" style="margin-top: -0.35rem;">Si eliges un archivo, el playground lo convierte a data URL y reemplaza el campo <code>image</code> del JSON al ejecutar.</p>
              <label>${escapeHtml(active.inputLabel)}
                <textarea id="playground-body" data-action="playground-body">${escapeHtml(draft)}</textarea>
              </label>
            ` : `
              <label>${escapeHtml(active.inputLabel)}
                <textarea id="playground-body" data-action="playground-body">${escapeHtml(draft)}</textarea>
              </label>
            `}
            <div class="button-row">
              <button class="primary-button" type="button" data-action="run-playground">${state.playgroundBusy ? 'Ejecutando...' : 'Run'}</button>
              <button class="ghost-button" type="button" data-action="reset-playground-body">Reset body</button>
            </div>
          </section>

          <section class="playground-preview">
            <div class="playground-tabs">
              <button class="${state.currentPlaygroundTab === 'curl' ? 'secondary-button' : 'ghost-button'}" type="button" data-action="pick-playground-tab" data-tab="curl">cURL</button>
              <button class="${state.currentPlaygroundTab === 'javascript' ? 'secondary-button' : 'ghost-button'}" type="button" data-action="pick-playground-tab" data-tab="javascript">JavaScript</button>
              <button class="ghost-button" type="button" data-action="copy-playground-snippet">Copiar</button>
            </div>
            <div class="playground-code">${escapeHtml(currentSnippet)}</div>
            <div class="playground-response">
              <strong>Sample output</strong>
              <div class="playground-code">${escapeHtml(active.response)}</div>
            </div>
            ${responseMarkup}
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderMetrics() {
  const metrics = state.dashboard.metrics;
  const tokens = state.dashboard.tokens || {
    currentMonthTokens: 0,
    projectedMonthTokens: 0,
    currentMonthPromptTokens: 0,
    projectedMonthPromptTokens: 0,
    currentMonthCompletionTokens: 0,
    projectedMonthCompletionTokens: 0,
  };
  const projectUsage = state.dashboard.projectUsage || [];
  const userUsage = state.dashboard.userUsage || [];
  const activeProviders = state.dashboard.pool?.providers?.filter((item) => item.status === 'available').length || 0;
  const summary = metrics.summary || {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    successRate: 0,
    avgDurationMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  const providerRows = metrics.providers.map((item) => ({
    ...item,
    providerLabel: formatProviderLabel(item.provider),
  }));
  const modelRows = metrics.models.slice(0, 25);
  const requestTypeRows = metrics.requestTypes || [];
  const metricsTabs = renderMetricsTabNav(state.metricsTab);

  let tabContent = '';

  if (state.metricsTab === 'overview') {
    tabContent = `
      <section class="metrics-summary-grid">
        <article class="metric-card">
          <span class="muted">Requests totales</span>
          <strong>${formatNumber(summary.requestCount)}</strong>
          <small>${formatNumber(activeProviders)}/${formatNumber(state.dashboard.pool?.providers?.length || 0)} proveedores disponibles</small>
        </article>
        <article class="metric-card">
          <span class="muted">Tokens enviados</span>
          <strong>${formatTokenCount(tokens.currentMonthPromptTokens)}</strong>
          <small>Proyeccion: ${formatTokenCount(tokens.projectedMonthPromptTokens)}</small>
        </article>
        <article class="metric-card">
          <span class="muted">Tokens recibidos</span>
          <strong>${formatTokenCount(tokens.currentMonthCompletionTokens)}</strong>
          <small>Proyeccion: ${formatTokenCount(tokens.projectedMonthCompletionTokens)}</small>
        </article>
        <article class="metric-card">
          <span class="muted">Salud general</span>
          <strong>${formatPercent(summary.successRate)}</strong>
          <small>Latencia media: ${formatDuration(summary.avgDurationMs)}</small>
        </article>
      </section>

      <section class="metrics-layout">
        ${renderTrendChart(metrics.daily || [])}
        <div class="chart-card">
          <h3>Snapshot del mes</h3>
          <div class="stats-list">
            <div><span>Total tokens</span><strong>${formatTokenCount(tokens.currentMonthTokens)}</strong></div>
            <div><span>Tokens enviados</span><strong>${formatTokenCount(tokens.currentMonthPromptTokens)}</strong></div>
            <div><span>Tokens recibidos</span><strong>${formatTokenCount(tokens.currentMonthCompletionTokens)}</strong></div>
            <div><span>Errores</span><strong>${formatNumber(summary.errorCount)}</strong></div>
          </div>
        </div>
      </section>

      <section class="metrics-layout">
        ${renderLeaderboard(providerRows.slice().sort((left, right) => right.totalTokens - left.totalTokens), {
          title: 'Top proveedores',
          description: 'Comparativa por volumen total y split de tokens.',
          labelKey: 'providerLabel',
          emptyMessage: 'Sin proveedores con trafico.',
        })}
        ${renderLeaderboard(requestTypeRows.slice().sort((left, right) => right.totalTokens - left.totalTokens), {
          title: 'Tipos de request',
          description: 'Que endpoints consumen mas tokens.',
          labelKey: 'requestType',
          emptyMessage: 'Sin tipos de request aun.',
        })}
      </section>

      ${renderLeaderboard(userUsage.slice().sort((left, right) => right.totalTokens - left.totalTokens), {
        title: 'Usuarios con mas consumo',
        description: 'Uso mensual agrupado por cuenta.',
        labelKey: 'name',
        emptyMessage: 'Sin usuarios con consumo aun.',
      })}
    `;
  }

  if (state.metricsTab === 'providers') {
    tabContent = `
      <section class="metrics-layout">
        ${renderLeaderboard(providerRows.slice().sort((left, right) => right.totalTokens - left.totalTokens), {
          title: 'Distribucion por proveedor',
          description: 'Cada barra separa prompt y completion.',
          labelKey: 'providerLabel',
          limit: 8,
          emptyMessage: 'Sin proveedores con trafico.',
        })}
        <div class="chart-card">
          <h3>Detalle por proveedor</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Requests</th>
                  <th>Enviados</th>
                  <th>Recibidos</th>
                  <th>Total</th>
                  <th>Exitos</th>
                  <th>Errores</th>
                  <th>Avg ms</th>
                </tr>
              </thead>
              <tbody>
                ${providerRows.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.providerLabel)}</td>
                    <td>${formatNumber(item.totalRequests)}</td>
                    <td>${formatTokenCount(item.promptTokens)}</td>
                    <td>${formatTokenCount(item.completionTokens)}</td>
                    <td>${formatTokenCount(item.totalTokens)}</td>
                    <td>${formatNumber(item.successCount)}</td>
                    <td>${formatNumber(item.errorCount)}</td>
                    <td>${formatDuration(item.avgDurationMs)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="8">Sin actividad registrada.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  if (state.metricsTab === 'models') {
    tabContent = `
      <section class="metrics-layout">
        ${renderLeaderboard(modelRows.slice().sort((left, right) => right.totalTokens - left.totalTokens), {
          title: 'Top modelos',
          description: 'Modelos mas pesados por volumen total.',
          labelKey: 'model',
          limit: 8,
          emptyMessage: 'Sin metricas por modelo todavia.',
        })}
        <div class="chart-card">
          <h3>Detalle por modelo</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Proveedor</th>
                  <th>Requests</th>
                  <th>Enviados</th>
                  <th>Recibidos</th>
                  <th>Total</th>
                  <th>Exitos</th>
                  <th>Errores</th>
                  <th>Avg ms</th>
                </tr>
              </thead>
              <tbody>
                ${modelRows.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.model)}</td>
                    <td>${escapeHtml(formatProviderLabel(item.provider))}</td>
                    <td>${formatNumber(item.totalRequests)}</td>
                    <td>${formatTokenCount(item.promptTokens)}</td>
                    <td>${formatTokenCount(item.completionTokens)}</td>
                    <td>${formatTokenCount(item.totalTokens)}</td>
                    <td>${formatNumber(item.successCount)}</td>
                    <td>${formatNumber(item.errorCount)}</td>
                    <td>${formatDuration(item.avgDurationMs)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="9">Sin metricas por modelo todavia.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  if (state.metricsTab === 'consumers') {
    tabContent = `
      <section class="metrics-layout">
        ${renderLeaderboard(userUsage.slice().sort((left, right) => right.totalTokens - left.totalTokens), {
          title: 'Usuarios',
          description: 'Ranking de consumo mensual por usuario.',
          labelKey: 'name',
          limit: 8,
          emptyMessage: 'Sin usuarios con consumo aun.',
        })}
        ${renderLeaderboard(projectUsage.slice().sort((left, right) => right.totalTokens - left.totalTokens), {
          title: 'Proyectos',
          description: 'Ranking de consumo mensual por proyecto.',
          labelKey: 'name',
          limit: 8,
          emptyMessage: 'Sin proyectos con consumo aun.',
        })}
      </section>

      <section class="grid-2">
        <article class="chart-card">
          <h3>Uso por usuario</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Requests</th>
                  <th>Enviados</th>
                  <th>Recibidos</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                ${userUsage.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${formatNumber(item.requestCount)}</td>
                    <td>${formatTokenCount(item.promptTokens || 0)}</td>
                    <td>${formatTokenCount(item.completionTokens || 0)}</td>
                    <td>${formatTokenCount(item.totalTokens)}</td>
                    <td><span class="tag ${formatUsageStatusClass(item.status)}">${escapeHtml(formatUsageStatusLabel(item.status))}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="6">Sin usuarios con consumo aun.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>

        <article class="chart-card">
          <h3>Uso por proyecto</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Requests</th>
                  <th>Enviados</th>
                  <th>Recibidos</th>
                  <th>Total</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                ${projectUsage.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${formatNumber(item.requestCount)}</td>
                    <td>${formatTokenCount(item.promptTokens || 0)}</td>
                    <td>${formatTokenCount(item.completionTokens || 0)}</td>
                    <td>${formatTokenCount(item.totalTokens)}</td>
                    <td><span class="tag ${formatUsageStatusClass(item.status)}">${escapeHtml(formatUsageStatusLabel(item.status))}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="6">Sin proyectos con consumo aun.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  if (state.metricsTab === 'activity') {
    tabContent = `
      <section class="metrics-layout">
        ${renderTrendChart(metrics.daily || [])}
        <div class="chart-card">
          <h3>Actividad por tipo</h3>
          <div class="leaderboard">
            ${requestTypeRows.map((item) => `
              <div class="leaderboard-row">
                <div class="row-between">
                  <strong>${escapeHtml(item.requestType)}</strong>
                  <span>${formatNumber(item.requestCount)} req</span>
                </div>
                <div class="stack-bar">
                  <span class="prompt" style="width:${metricRatio(item.promptTokens, item.totalTokens)}%"></span>
                  <span class="completion" style="width:${metricRatio(item.completionTokens, item.totalTokens)}%"></span>
                </div>
                ${renderTokenSplit(item.promptTokens, item.completionTokens, item.totalTokens)}
                <small class="muted">Latencia media: ${formatDuration(item.avgDurationMs)}</small>
              </div>
            `).join('') || '<div class="empty-state">Sin actividad aun.</div>'}
          </div>
        </div>
      </section>

      <section class="chart-card">
        <h3>Requests recientes</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ruta</th>
                <th>Proveedor</th>
                <th>Status</th>
                <th>Enviados</th>
                <th>Recibidos</th>
                <th>Total</th>
                <th>Tiempo</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${metrics.recent.map((item) => `
                <tr>
                  <td>${escapeHtml(formatShortDate(item.createdAt))}</td>
                  <td>${escapeHtml(item.path)}</td>
                  <td>${escapeHtml(item.provider ? formatProviderLabel(item.provider) : '-')}</td>
                  <td><span class="tag ${item.statusCode >= 400 ? 'danger' : 'success'}">${formatNumber(item.statusCode)}</span></td>
                  <td>${formatTokenCount(item.promptTokens || 0)}</td>
                  <td>${formatTokenCount(item.completionTokens || 0)}</td>
                  <td>${formatTokenCount(item.totalTokens)}</td>
                  <td>${formatDuration(item.durationMs)}</td>
                  <td>${escapeHtml(item.errorMessage || item.model || item.requestType || '-')}</td>
                </tr>
              `).join('') || '<tr><td colspan="9">Aun no hay requests.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  return `
    <section class="metrics-shell">
      <article class="panel metrics-hero">
        <div>
          <p class="tag">Analitica</p>
          <h3>Centro de metricas</h3>
          <p class="muted">Vista organizada por pestanias con graficas, tendencia diaria y separacion entre tokens enviados y recibidos.</p>
        </div>
        <div class="metrics-kpis">
          <div>
            <span class="muted">Tokens del mes</span>
            <strong>${formatTokenCount(tokens.currentMonthTokens)}</strong>
          </div>
          <div>
            <span class="muted">Env/Rec</span>
            <strong>${formatCompactNumber(tokens.currentMonthPromptTokens)} / ${formatCompactNumber(tokens.currentMonthCompletionTokens)}</strong>
          </div>
        </div>
      </article>
      ${metricsTabs}
      ${tabContent}
    </section>
  `;
}

function renderSettings() {
  const dashboard = state.dashboard;
  const isAdminUser = dashboard.auth.isAdmin;
  const settings = dashboard.settings;
  const ownApiKeys = dashboard.apiKeys;
  const providerRuleMap = getProviderRateLimitMap();
  const modelRules = dashboard.rateLimits?.modelRules || [];
  const availableModels = (dashboard.pool?.models || []).map((item) => item.id);
  const availableModelIds = availableModels;
  const defaultModelId = availableModels[0] || '';

  return `
    <section class="settings-grid">
      <article class="panel">
        <div class="row-between">
          <div>
            <h3>Tus API keys</h3>
            <p class="muted">Cada usuario recibe una por defecto y aqui puede crear mas.</p>
          </div>
        </div>
        <form data-form="create-api-key">
          <label>Nombre de la API key
            <input name="name" placeholder="Integracion n8n" required />
          </label>
          ${isAdminUser ? `
            <label>Rate limit por minuto
              <input name="rateLimitPerMinute" type="number" min="1" value="${escapeHtml(settings.defaultApiKeyRateLimit)}" />
            </label>
          ` : ''}
          <button class="secondary-button" type="submit">Generar API key</button>
        </form>
        <div class="table-wrap" style="margin-top: 1rem;">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Prefijo</th>
                <th>Rate limit</th>
                <th>Estado</th>
                <th>Uso</th>
              </tr>
            </thead>
            <tbody>
              ${ownApiKeys.map((item) => `
                <tr>
                  <td>${escapeHtml(item.name)}</td>
                  <td>${escapeHtml(item.keyPrefix)}</td>
                  <td>
                    ${isAdminUser ? `
                      <form class="inline-form" data-form="update-api-key">
                        <input type="hidden" name="id" value="${escapeHtml(item.id)}" />
                        <input type="number" name="rateLimitPerMinute" min="1" value="${escapeHtml(item.rateLimitPerMinute)}" style="max-width: 96px;" />
                        <button class="ghost-button" type="submit">Guardar</button>
                      </form>
                    ` : escapeHtml(item.rateLimitPerMinute)}
                  </td>
                  <td>
                    <button class="${item.isActive ? 'ghost-button' : 'secondary-button'}" type="button" data-action="toggle-api-key" data-id="${escapeHtml(item.id)}" data-active="${item.isActive}">
                      ${item.isActive ? 'Activa' : 'Inactiva'}
                    </button>
                  </td>
                  <td>${formatNumber(item.totalRequests)}</td>
                </tr>
              `).join('') || '<tr><td colspan="5">Sin API keys.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <h3>Ajustes generales</h3>
        <p class="muted">Parametros base del panel y del comportamiento del router.</p>
        ${isAdminUser ? `
          <form data-form="update-settings">
            <label>Nombre del sistema
              <input name="appName" value="${escapeHtml(settings.appName)}" required />
            </label>
            <label>Sesion (minutos)
              <input name="sessionTimeoutMinutes" type="number" min="15" value="${escapeHtml(settings.sessionTimeoutMinutes)}" />
            </label>
            <label>Rate limit default por minuto
              <input name="defaultApiKeyRateLimit" type="number" min="1" value="${escapeHtml(settings.defaultApiKeyRateLimit)}" />
            </label>
            <label>Rate limit anonimo por IP
              <input name="anonymousRateLimitPerMinute" type="number" min="1" value="${escapeHtml(settings.anonymousRateLimitPerMinute)}" />
            </label>
            <label>Orígenes permitidos (coma separada o *)
              <input name="allowedOrigins" value="${escapeHtml(settings.allowedOrigins)}" />
            </label>
            <label>Modelo default del chat
              <input name="defaultChatModel" value="${escapeHtml(settings.defaultChatModel)}" />
            </label>
            <label>
              <select name="openRouterFreeOnly">
                <option value="false" ${!settings.openRouterFreeOnly ? 'selected' : ''}>OpenRouter lista modelos gratis y de paga</option>
                <option value="true" ${settings.openRouterFreeOnly ? 'selected' : ''}>OpenRouter solo muestra modelos gratuitos</option>
              </select>
            </label>
            <label>
              <select name="enableUserKeyCreation">
                <option value="true" ${settings.enableUserKeyCreation ? 'selected' : ''}>Usuarios pueden crear sus propias API keys</option>
                <option value="false" ${!settings.enableUserKeyCreation ? 'selected' : ''}>Solo admins crean API keys</option>
              </select>
            </label>
            <button class="primary-button" type="submit">Guardar ajustes</button>
          </form>
        ` : '<div class="empty-state">Solo los administradores pueden editar estos ajustes.</div>'}
      </article>
    </section>

    ${isAdminUser ? `
      <section class="settings-grid">
        <article class="panel">
          <h3>Crear usuario</h3>
          <form data-form="create-user">
            <label>Nombre
              <input name="name" required />
            </label>
            <label>Correo
              <input name="email" type="email" required />
            </label>
            <label>Contrasena temporal
              <input name="password" type="password" minlength="8" required />
            </label>
            <button class="secondary-button" type="submit">Crear usuario sin admin</button>
          </form>
        </article>

        <article class="panel">
          <h3>Service keys</h3>
          <form data-form="create-service-key">
            <label>Proveedor
              <select name="provider">
                  ${providerOptions.map((provider) => `<option value="${provider}">${formatProviderLabel(provider)}</option>`).join('')}
              </select>
            </label>
            <label>Nombre interno
              <input name="name" placeholder="Groq key principal" required />
            </label>
            <label>Service API key
              <input name="value" required />
            </label>
            <label>Prioridad
              <input name="priority" type="number" min="1" value="100" />
            </label>
            <button class="primary-button" type="submit">Agregar service key</button>
          </form>
        </article>
      </section>

      <section class="panel">
        <div class="row-between">
          <div>
            <h3>Limites por proveedor</h3>
            <p class="muted">Cada proveedor puede quedar en cooldown completo antes de que el endpoint externo responda con error.</p>
          </div>
        </div>
        <div class="limit-grid">
          ${providerOptions.map((providerId) => {
            const rule = providerRuleMap.get(providerId) || createEmptyLimitRule(providerId, providerId);
            const providerState = getProviderPoolState(providerId);
            return `
              <form class="limit-card" data-form="update-provider-limit">
                <input type="hidden" name="provider" value="${escapeHtml(providerId)}" />
                <div class="row-between">
                  <strong>${escapeHtml(formatProviderLabel(providerId))}</strong>
                  <span class="tag ${providerState?.status === 'cooldown' ? 'warn' : 'success'}">${escapeHtml(providerState?.status || 'available')}</span>
                </div>
                <p class="muted">Modelos visibles: ${formatNumber(providerState?.models || 0)}${providerState?.cooldownUntil ? ` | Hasta: ${escapeHtml(formatDate(providerState.cooldownUntil))}` : ''}</p>
                ${providerState?.lastReason ? `<p class="muted">${escapeHtml(providerState.lastReason)}</p>` : ''}
                ${renderLimitFields(rule)}
                <button class="primary-button" type="submit">Guardar limite</button>
              </form>
            `;
          }).join('')}
        </div>
      </section>

      <section class="settings-grid">
        <article class="panel">
          <h3>Nuevo limite por modelo</h3>
          ${availableModels.length === 0 ? '<div class="empty-state">No hay modelos cargados para configurar limites.</div>' : `
            <form data-form="update-model-limit">
              <label>Modelo
                <select name="modelId">
                  ${availableModelIds.map((modelId) => `<option value="${escapeHtml(modelId)}">${escapeHtml(modelId)}</option>`).join('')}
                </select>
              </label>
              ${renderLimitFields(createEmptyLimitRule(defaultModelId, defaultModelId.split('/')[0] || null))}
              <button class="primary-button" type="submit">Guardar limite del modelo</button>
            </form>
          `}
        </article>

        <article class="panel">
          <div class="row-between">
            <div>
              <h3>Limites activos por modelo</h3>
              <p class="muted">Puedes dejar un modelo con modo "Sin limite" para desactivar su restriccion guardada.</p>
            </div>
          </div>
          ${modelRules.length === 0 ? '<div class="empty-state">Todavia no hay limites por modelo configurados.</div>' : `
            <div class="limit-grid">
              ${modelRules.map((rule) => `
                <form class="limit-card" data-form="update-model-limit">
                  <input type="hidden" name="modelId" value="${escapeHtml(rule.scopeId)}" />
                  <div class="row-between">
                    <strong>${escapeHtml(rule.scopeId)}</strong>
                    <span class="tag">${escapeHtml(rule.mode)}</span>
                  </div>
                  <p class="muted">Proveedor: ${escapeHtml(formatProviderLabel(rule.provider || rule.scopeId.split('/')[0] || ''))}</p>
                  ${renderLimitFields(rule)}
                  <button class="secondary-button" type="submit">Actualizar modelo</button>
                </form>
              `).join('')}
            </div>
          `}
        </article>
      </section>

      <section class="settings-grid">
        <article class="panel">
          <div class="row-between">
            <div>
              <h3>Usuarios</h3>
              <p class="muted">Activa o desactiva cuentas del sistema.</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Ultimo login</th>
                </tr>
              </thead>
              <tbody>
                ${dashboard.users.map((user) => `
                  <tr>
                    <td>${escapeHtml(user.name)}</td>
                    <td>${escapeHtml(user.email)}</td>
                    <td>${escapeHtml(user.role)}</td>
                    <td>
                      <button class="${user.isActive ? 'ghost-button' : 'danger-button'}" type="button" data-action="toggle-user" data-id="${escapeHtml(user.id)}" data-active="${user.isActive}">
                        ${user.isActive ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td>${escapeHtml(formatDate(user.lastLoginAt))}</td>
                  </tr>
                `).join('') || '<tr><td colspan="5">Sin usuarios.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel">
          <div class="row-between">
            <div>
              <h3>Service keys cargadas</h3>
              <p class="muted">Puedes desactivar una llave o cambiar su prioridad para el failover.</p>
            </div>
            <button class="ghost-button" type="button" data-action="reset-router">Reset router</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Origen</th>
                  <th>Nombre</th>
                  <th>Hint</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                ${renderServiceKeyRows(dashboard.serviceKeys)}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    ` : ''}
  `;
}

function renderSettingsGuideModal() {
  if (!state.settingsGuide) {
    return '';
  }

  const guide = getSettingsGuideContent(state.settingsGuide);
  return `
    <div class="modal-backdrop" data-action="close-settings-guide">
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-guide-title">
        <div class="row-between">
          <div>
            <p class="tag">${escapeHtml(guide.eyebrow)}</p>
            <h3 id="settings-guide-title">${escapeHtml(guide.title)}</h3>
          </div>
          <button class="ghost-button" type="button" data-action="close-settings-guide">Cerrar</button>
        </div>
        <p class="muted">${escapeHtml(guide.intro)}</p>
        <div class="tutorial-list">
          ${guide.items.map((item, index) => `
            <article class="tutorial-item">
              <strong>${index + 1}. ${escapeHtml(item.title)}</strong>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function mergeDiscoveredCustomProviderModels(existingModels, discoveredModels) {
  const existingMap = new Map(
    (existingModels || [])
      .filter((model) => typeof model?.id === 'string' && model.id.trim())
      .map((model) => [model.id.trim(), { ...model, id: model.id.trim() }]),
  );

  const merged = [];
  for (const model of discoveredModels || []) {
    const id = String(model?.id || '').trim();
    if (!id) {
      continue;
    }

    const current = existingMap.get(id);
    merged.push(current || {
      ...createEmptyCustomProviderModel(),
      id,
      supportsTools: Boolean(model?.supportsTools),
      supportsVision: Boolean(model?.supportsVision),
      supportsImageGeneration: Boolean(model?.supportsImageGeneration),
      supportsVideoGeneration: Boolean(model?.supportsVideoGeneration),
    });
    existingMap.delete(id);
  }

  for (const model of existingMap.values()) {
    merged.push(model);
  }

  return merged;
}

function renderCustomProviderDiscovery(scope, protocol = 'openai') {
  const discovery = state.cpDiscovery[scope] || { loading: false, message: '' };
  const targetLabel = protocol === 'gemini'
    ? '/models con x-goog-api-key'
    : protocol === 'anthropic'
      ? '/models con x-api-key'
      : '/models del provider';
  const buttonLabel = discovery.loading ? `Consultando ${targetLabel}...` : 'Autocargar modelos';
  const baseHelp = scope === 'edit'
    ? `Usa la Base URL actual y, si no escribes una nueva key, reutiliza la guardada para consultar ${targetLabel}.`
    : `Consulta ${targetLabel} y fusiona lo encontrado con tu lista actual.`;

  return `
    <div style="margin-bottom: 0.75rem;">
      <div class="row-between" style="gap: 0.75rem; align-items: center;">
        <div>
          <div style="font-size: 0.8rem; font-weight: 600; color: var(--muted-light); letter-spacing: 0.01em;">Descubrimiento automatico</div>
          <p class="muted" style="margin: 0.25rem 0 0;">${escapeHtml(baseHelp)}</p>
        </div>
        <button class="secondary-button" type="button" data-action="cp-discover-models" data-scope="${escapeHtml(scope)}" ${discovery.loading ? 'disabled' : ''}>
          ${escapeHtml(buttonLabel)}
        </button>
      </div>
      ${discovery.message ? `<p class="muted" style="margin: 0.5rem 0 0;">${escapeHtml(discovery.message)}</p>` : ''}
    </div>
  `;
}

function renderModelsBuilder(models, scope, protocol = 'openai') {
  const rows = models.map((model, index) => `
    <div class="cp-model-row">
      <input
        type="text"
        placeholder="proveedor/nombre-modelo"
        value="${escapeHtml(model.id)}"
        data-action="cp-model-field"
        data-scope="${escapeHtml(scope)}"
        data-index="${index}"
        data-field="id"
      />
      <label class="cp-check">
        <input
          type="checkbox"
          data-action="cp-model-field"
          data-scope="${escapeHtml(scope)}"
          data-index="${index}"
          data-field="supportsTools"
          ${model.supportsTools ? 'checked' : ''}
        />
        Tools
      </label>
      <label class="cp-check">
        <input
          type="checkbox"
          data-action="cp-model-field"
          data-scope="${escapeHtml(scope)}"
          data-index="${index}"
          data-field="supportsVision"
          ${model.supportsVision ? 'checked' : ''}
        />
        Vision
      </label>
      <label class="cp-check">
        <input
          type="checkbox"
          data-action="cp-model-field"
          data-scope="${escapeHtml(scope)}"
          data-index="${index}"
          data-field="supportsImageGeneration"
          ${model.supportsImageGeneration ? 'checked' : ''}
        />
        Img
      </label>
      <label class="cp-check">
        <input
          type="checkbox"
          data-action="cp-model-field"
          data-scope="${escapeHtml(scope)}"
          data-index="${index}"
          data-field="supportsVideoGeneration"
          ${model.supportsVideoGeneration ? 'checked' : ''}
        />
        Video
      </label>
      <button
        class="ghost-button"
        type="button"
        data-action="cp-remove-model"
        data-scope="${escapeHtml(scope)}"
        data-index="${index}"
        style="padding: 0.4rem 0.6rem;"
        title="Eliminar modelo"
      >×</button>
    </div>
  `).join('');

  return `
    <div class="cp-models-section">
      ${renderCustomProviderDiscovery(scope, protocol)}
      <div class="row-between" style="margin-bottom: 0.6rem;">
        <span style="font-size: 0.8rem; font-weight: 600; color: var(--muted-light); letter-spacing: 0.01em;">Modelos</span>
        <button class="ghost-button" type="button" data-action="cp-add-model" data-scope="${escapeHtml(scope)}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
          + Agregar modelo
        </button>
      </div>
      <p class="muted" style="margin: 0 0 0.6rem; font-size: 0.78rem;">Marca <strong>Img</strong> o <strong>Video</strong> para habilitar el modelo en <code>/v1/images/generations</code> o <code>/v1/videos</code> usando el nombre ${scope === 'edit' ? '<code>slug/modelo</code>' : 'del provider/modelo al guardar'}.</p>
      ${rows || '<div class="empty-state" style="padding: 0.875rem; text-align: left;">Agrega al menos un modelo para habilitar el proveedor.</div>'}
    </div>
  `;
}

function renderSettingsCustomProviders() {
  const providers = state.dashboard.customProviders || [];
  const draft = state.cpDraft;
  const editing = state.cpEditing;

  const createForm = `
    <article class="panel">
      <h3>Nuevo proveedor</h3>
      <p class="muted">Conecta endpoints compatibles con OpenAI, Gemini o Anthropic. El router los traduce al formato interno y los incluye en el pool automaticamente.</p>
      <form data-form="create-custom-provider" style="margin-top: 1rem;">
        <div class="grid-2">
          <label>Nombre
            <input name="name" placeholder="Mi proveedor local" required value="${escapeHtml(draft.name)}" data-action="cp-draft-name" />
          </label>
          <label>Protocolo
            <select name="protocol" data-action="cp-draft-protocol">
              ${getCustomProviderProtocolOptions().map((option) => `
                <option value="${escapeHtml(option.value)}" ${draft.protocol === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>
              `).join('')}
            </select>
          </label>
        </div>
        <div class="grid-2">
          <label>Base URL
            <input name="baseUrl" placeholder="${escapeHtml(getCustomProviderBaseUrlPlaceholder(draft.protocol))}" required value="${escapeHtml(draft.baseUrl)}" data-action="cp-draft-baseUrl" />
          </label>
          <label>API Key <span class="muted" style="font-weight: 400;">(opcional)</span>
            <input name="apiKey" type="password" placeholder="${draft.protocol === 'gemini' ? 'AIza...' : draft.protocol === 'anthropic' ? 'sk-ant-...' : 'sk-...'}" autocomplete="new-password" value="${escapeHtml(draft.apiKey)}" data-action="cp-draft-apiKey" />
          </label>
        </div>
        ${renderModelsBuilder(draft.models, 'draft', draft.protocol)}
        <div class="button-row">
          <button class="primary-button" type="submit">Crear proveedor</button>
        </div>
      </form>
    </article>
  `;

  const editPanel = editing ? `
    <article class="panel" style="border-color: var(--accent); border-left-width: 2px;">
      <div class="row-between" style="margin-bottom: 1rem;">
        <div>
          <h3>Editando: ${escapeHtml(editing.name)}</h3>
          <p class="muted">Slug: <code style="font-family: var(--font-mono); font-size: 0.8rem;">${escapeHtml(editing.slug)}</code></p>
        </div>
        <button class="ghost-button" type="button" data-action="cancel-edit-custom-provider">Cancelar</button>
      </div>
        <form data-form="edit-custom-provider">
          <input type="hidden" name="id" value="${escapeHtml(editing.id)}" />
          <div class="grid-2">
            <label>Nombre
              <input name="name" required value="${escapeHtml(editing.name)}" data-action="cp-edit-name" />
            </label>
            <label>Protocolo
              <select name="protocol" data-action="cp-edit-protocol">
                ${getCustomProviderProtocolOptions().map((option) => `
                  <option value="${escapeHtml(option.value)}" ${editing.protocol === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>
                `).join('')}
              </select>
            </label>
          </div>
          <div class="grid-2">
            <label>Base URL
              <input name="baseUrl" required placeholder="${escapeHtml(getCustomProviderBaseUrlPlaceholder(editing.protocol))}" value="${escapeHtml(editing.baseUrl)}" data-action="cp-edit-baseUrl" />
            </label>
            <label>${editing.hasApiKey ? 'Nueva API Key <span class="muted" style="font-weight:400;">(dejar vacío para conservar la actual)</span>' : 'API Key <span class="muted" style="font-weight:400;">(opcional)</span>'}
              <input name="newApiKey" type="password" placeholder="${editing.protocol === 'gemini' ? 'AIza...' : editing.protocol === 'anthropic' ? 'sk-ant-...' : 'sk-...'}" autocomplete="new-password" value="${escapeHtml(editing.newApiKey || '')}" data-action="cp-edit-apiKey" />
            </label>
          </div>
          ${editing.hasApiKey ? `
            <div>
              <button class="danger-button" type="button" data-action="cp-clear-api-key" style="font-size: 0.8rem;">
              Eliminar API key almacenada
              </button>
            </div>
          ` : ''}
          ${renderModelsBuilder(editing.models, 'edit', editing.protocol)}
          <div class="button-row">
            <button class="primary-button" type="submit">Guardar cambios</button>
            <button class="ghost-button" type="button" data-action="cancel-edit-custom-provider">Cancelar</button>
        </div>
      </form>
    </article>
  ` : '';

  const providerList = `
    <article class="panel">
      <div class="row-between">
        <div>
          <h3>Proveedores registrados</h3>
          <p class="muted">${providers.length === 0 ? 'No hay proveedores personalizados todavia.' : `${providers.length} proveedor${providers.length !== 1 ? 'es' : ''} en el pool.`}</p>
        </div>
      </div>
      ${providers.length === 0 ? `
        <div class="empty-state" style="margin-top: 0.75rem;">
          Crea tu primer proveedor arriba para empezar a usarlo en el router.
        </div>
      ` : `
        <div class="cp-provider-list">
          ${providers.map((provider) => `
            <div class="cp-provider-row ${editing?.id === provider.id ? 'cp-provider-row--editing' : ''}">
              <div class="cp-provider-info">
                <div class="row-between">
                  <div style="display: flex; align-items: center; gap: 0.625rem;">
                    <strong>${escapeHtml(provider.name)}</strong>
                    <span class="tag ${provider.isActive ? 'success' : ''}">${provider.isActive ? 'Activo' : 'Inactivo'}</span>
                    ${provider.hasApiKey ? '<span class="tag">Con clave</span>' : '<span class="tag warn">Sin clave</span>'}
                  </div>
                  <div class="button-row">
                    <button
                      class="${provider.isActive ? 'ghost-button' : 'secondary-button'}"
                      type="button"
                      data-action="toggle-custom-provider"
                      data-id="${escapeHtml(provider.id)}"
                      data-active="${provider.isActive}"
                    >${provider.isActive ? 'Desactivar' : 'Activar'}</button>
                    <button
                      class="ghost-button"
                      type="button"
                      data-action="edit-custom-provider"
                      data-id="${escapeHtml(provider.id)}"
                    >Editar</button>
                    <button
                      class="danger-button"
                      type="button"
                      data-action="delete-custom-provider"
                      data-id="${escapeHtml(provider.id)}"
                    >Eliminar</button>
                  </div>
                </div>
                <div class="cp-provider-meta">
                  <span class="muted">Slug:</span>
                  <code style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted-light);">${escapeHtml(provider.slug)}</code>
                  <span class="muted">·</span>
                  <span class="muted">Protocolo:</span>
                  <span class="tag">${escapeHtml(formatCustomProviderProtocol(provider.protocol))}</span>
                  <span class="muted">·</span>
                  <span class="muted">URL:</span>
                  <code style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--muted-light);">${escapeHtml(provider.baseUrl)}</code>
                  <span class="muted">·</span>
                  <span class="muted">${provider.models.length} modelo${provider.models.length !== 1 ? 's' : ''}</span>
                </div>
                ${provider.models.length > 0 ? `
                  <div class="cp-model-tags">
                    ${provider.models.map((model) => `
                      <span class="tag">
                        ${escapeHtml(model.id)}
                        ${model.supportsTools ? '<span title="Tools">⚙</span>' : ''}
                        ${model.supportsVision ? '<span title="Vision">👁</span>' : ''}
                        ${model.supportsImageGeneration ? '<span title="Imagen">🖼</span>' : ''}
                        ${model.supportsVideoGeneration ? '<span title="Video">🎬</span>' : ''}
                      </span>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </article>
  `;

  return `
    ${createForm}
    ${editPanel}
    ${providerList}
  `;
}

function renderSettingsModelTiers() {
  const models = (state.dashboard.pool?.models || []).filter((m) => !m.paidOnly);
  const overrides = state.dashboard.modelTierOverrides || [];
  const overrideMap = new Map(overrides.map((o) => [o.modelId, o.tier]));

  const tierLabel = { 1: 'Premium', 2: 'Balanceado', 3: 'Rapido' };
  const tierClass = { 1: 'success', 2: '', 3: 'warn' };

  const rows = models.map((model) => {
    const override = overrideMap.get(model.id);
    const currentTier = model.tier ?? 3;
    const isOverridden = override !== undefined;

    return `
      <tr>
        <td>
          <div style="font-family: var(--font-mono); font-size: 0.78rem;">${escapeHtml(model.id)}</div>
          ${isOverridden ? '<span class="tag" style="font-size: 0.7rem; margin-top: 0.2rem;">Override</span>' : ''}
        </td>
        <td><span class="tag">${escapeHtml(formatProviderLabel(model.provider))}</span></td>
        <td>
          <span class="tag ${escapeHtml(tierClass[currentTier] || '')}">
            Tier ${escapeHtml(currentTier)} — ${escapeHtml(tierLabel[currentTier] || 'Custom')}
          </span>
        </td>
        <td>
          <div class="button-row" style="gap: 0.3rem;">
            ${[1, 2, 3].map((t) => `
              <button
                class="${currentTier === t && isOverridden ? 'secondary-button' : 'ghost-button'}"
                type="button"
                data-action="set-model-tier"
                data-model="${escapeHtml(model.id)}"
                data-tier="${t}"
                style="padding: 0.3rem 0.6rem; font-size: 0.78rem;"
                title="Forzar tier ${t}"
              >${t}</button>
            `).join('')}
            ${isOverridden ? `
              <button
                class="ghost-button"
                type="button"
                data-action="reset-model-tier"
                data-model="${escapeHtml(model.id)}"
                style="padding: 0.3rem 0.6rem; font-size: 0.78rem; color: var(--muted);"
                title="Restaurar tier automatico"
              >Auto</button>
            ` : `
              <span style="padding: 0.3rem 0.6rem; font-size: 0.78rem; color: var(--muted);">Auto</span>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <article class="panel">
      <h3>Modelos en el pool</h3>
      <p class="muted">
        Los modelos de pago siempre van al final. Los cambios recargan el pool de inmediato.
        ${overrides.length > 0 ? `<strong>${overrides.length} override${overrides.length !== 1 ? 's' : ''} activo${overrides.length !== 1 ? 's' : ''}.</strong>` : ''}
      </p>
      ${models.length === 0 ? `
        <div class="empty-state">No hay modelos gratuitos en el pool en este momento.</div>
      ` : `
        <div class="table-wrap" style="margin-top: 1rem;">
          <table>
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Proveedor</th>
                <th>Tier actual</th>
                <th>Cambiar tier</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `}
    </article>
  `;
}

function renderSettingsModelAliases() {
  const aliases = state.dashboard.modelAliases || [];
  const fallbackAliasCategories = [
    { id: 'chat', name: 'Chat', targets: (state.dashboard.pool?.models || []).map((model) => model.id) },
    { id: 'images', name: 'Generación de imágenes', targets: ['flux', 'sdxl', 'turbo', 'playground', 'illustrious', 'qwen-image', 'wan', 'imagegeneration', 'qwenimage'] },
    { id: 'imageEdit', name: 'Edición de imágenes', targets: ['qwen-image-edit'] },
    { id: 'videos', name: 'Videos', targets: ['qwen-video'] },
  ];
  const dashboardAliasCategories = Array.isArray(state.dashboard.modelAliasCategories) ? state.dashboard.modelAliasCategories : [];
  const aliasCategories = dashboardAliasCategories.length > 0
    ? dashboardAliasCategories.map((category) => ({
        ...category,
        targets: Array.isArray(category.targets) && category.targets.length > 0
          ? category.targets
          : (fallbackAliasCategories.find((fallback) => fallback.id === category.id)?.targets || []),
      }))
    : fallbackAliasCategories;
  const selectedCategory = aliasCategories.some((category) => category.id === state.modelAliasCategory)
    ? state.modelAliasCategory
    : 'chat';
  const selectedCategoryInfo = aliasCategories.find((category) => category.id === selectedCategory) || aliasCategories[0];
  const categoryOptions = aliasCategories.map((category) => `<option value="${category.id}" ${category.id === selectedCategory ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
  const targetOptions = selectedCategoryInfo
    ? selectedCategoryInfo.targets.map((target) => `<option value="${escapeHtml(target)}">${escapeHtml(target)}</option>`).join('')
    : '';

  const rows = aliases.map((alias) => `
    <tr>
      <td>
        <div style="font-family: var(--font-mono); font-size: 0.85rem;">${escapeHtml(alias.alias)}</div>
      </td>
      <td>
        <div style="font-family: var(--font-mono); font-size: 0.85rem;">${escapeHtml(alias.targetModel)}</div>
      </td>
      <td>
        <span class="tag ${alias.category === 'chat' ? '' : alias.category === 'images' ? 'info' : alias.category === 'imageEdit' ? 'warning' : 'success'}">${alias.category === 'chat' ? 'Chat' : alias.category === 'images' ? 'Imágenes' : alias.category === 'imageEdit' ? 'Edición' : 'Videos'}</span>
      </td>
      <td>
        <span class="tag ${alias.isActive ? 'success' : 'muted'}">${alias.isActive ? 'Activo' : 'Inactivo'}</span>
      </td>
      <td>
        <button class="danger-button" type="button" data-action="delete-model-alias" data-alias="${escapeHtml(alias.alias)}" data-category="${escapeHtml(alias.category || 'chat')}" style="padding: 0.3rem 0.6rem; font-size: 0.78rem;">
          Eliminar
        </button>
      </td>
    </tr>
  `).join('');

  return `
    <article class="panel">
      <h3>Crear nuevo alias</h3>
      <p class="muted">Mapea un alias externo hacia un modelo real del pool o un target multimedia válido. Ejemplo: alias "gpt-image-1" → target "flux".</p>
      <form data-form="create-model-alias" style="margin-top: 1rem;">
        <div class="form-grid" style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.75rem; align-items: end;">
          <label>Alias (nombre externo)
            <input type="text" name="alias" placeholder="gpt-4" required style="font-family: var(--font-mono);" />
          </label>
          <label>Categoría
            <select name="category" data-action="model-alias-category" required>
              ${categoryOptions}
            </select>
          </label>
          <label>Modelo target
            <select name="targetModel" required>
              <option value="">Selecciona un target...</option>
              ${targetOptions}
            </select>
          </label>
          <button class="secondary-button" type="submit">Crear alias</button>
        </div>
        <p class="muted" style="margin-top: 0.5rem; font-size: 0.8rem;">
          <strong>Chat:</strong> Debe existir en el pool. 
          <strong>Imágenes/Edición/Videos:</strong> Targets válidos del proveedor (no necesitan estar en el pool).
        </p>
      </form>
    </article>

    <article class="panel" style="margin-top: 1.5rem;">
      <h3>Alias activos</h3>
      <p class="muted">
        ${aliases.length === 0 ? 'No hay aliases configurados.' : `${aliases.length} alias${aliases.length !== 1 ? 's' : ''} activo${aliases.length !== 1 ? 's' : ''}.`}
      </p>
      ${aliases.length === 0 ? '' : `
        <div class="table-wrap" style="margin-top: 1rem;">
          <table>
            <thead>
              <tr>
                <th>Alias</th>
                <th>Target</th>
                <th>Categoría</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `}
    </article>
  `;
}

function renderSettingsMultiPage() {
  const dashboard = state.dashboard;
  const isAdminUser = dashboard.auth.isAdmin;
  const settings = dashboard.settings;
  const ownApiKeys = dashboard.apiKeys;
  const projects = dashboard.projects || [];
  const invitations = dashboard.invitations || [];
  const projectUsage = dashboard.projectUsage || [];
  const providerRuleMap = getProviderRateLimitMap();
  const modelRules = dashboard.rateLimits?.modelRules || [];
  const availableModels = dashboard.pool?.models || [];
  const availableModelIds = availableModels.map((item) => item.id);
  const defaultModelId = availableModelIds[0] || '';
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
  const projectUsageById = new Map(projectUsage.map((summary) => [summary.id, summary]));

  ensureValidSettingsPage();
  const pages = getSettingsPages();
  const activePage = getSettingsPageInfo();
  let pageContent = '';

  if (state.settingsPage === 'general') {
    pageContent = `
      <article class="panel">
        <h3>Ajustes generales</h3>
        <p class="muted">Parametros base del panel y del comportamiento del router.</p>
        ${isAdminUser ? `
          <form data-form="update-settings">
            <label>Nombre del sistema
              <input name="appName" value="${escapeHtml(settings.appName)}" required />
            </label>
            <label>Sesion (minutos)
              <input name="sessionTimeoutMinutes" type="number" min="15" value="${escapeHtml(settings.sessionTimeoutMinutes)}" />
            </label>
            <label>Rate limit default por minuto
              <input name="defaultApiKeyRateLimit" type="number" min="1" value="${escapeHtml(settings.defaultApiKeyRateLimit)}" />
            </label>
            <label>Rate limit anonimo por IP
              <input name="anonymousRateLimitPerMinute" type="number" min="1" value="${escapeHtml(settings.anonymousRateLimitPerMinute)}" />
            </label>
            <label>Origenes permitidos (coma separada o *)
              <input name="allowedOrigins" value="${escapeHtml(settings.allowedOrigins)}" />
            </label>
            <label>Modelo default del chat
              <input name="defaultChatModel" value="${escapeHtml(settings.defaultChatModel)}" />
            </label>
            <label>
              <select name="openRouterFreeOnly">
                <option value="false" ${!settings.openRouterFreeOnly ? 'selected' : ''}>OpenRouter lista modelos gratis y de paga</option>
                <option value="true" ${settings.openRouterFreeOnly ? 'selected' : ''}>OpenRouter solo muestra modelos gratuitos</option>
              </select>
            </label>
            <label>
              <select name="enableUserKeyCreation">
                <option value="true" ${settings.enableUserKeyCreation ? 'selected' : ''}>Usuarios pueden crear sus propias API keys</option>
                <option value="false" ${!settings.enableUserKeyCreation ? 'selected' : ''}>Solo admins crean API keys</option>
              </select>
            </label>
            <button class="primary-button" type="submit">Guardar ajustes</button>
          </form>
        ` : '<div class="empty-state">Solo los administradores pueden editar estos ajustes.</div>'}
      </article>
    `;
  }

  if (state.settingsPage === 'api-keys') {
    pageContent = `
      <article class="panel">
        <div class="row-between">
          <div>
            <h3>Tus API keys</h3>
            <p class="muted">Cada usuario recibe una por defecto y aqui puede crear mas.</p>
          </div>
        </div>
        <form data-form="create-api-key">
          <label>Nombre de la API key
            <input name="name" placeholder="Integracion n8n" required />
          </label>
          <label>Proyecto
            <select name="projectId">
              <option value="">Sin proyecto</option>
              ${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('')}
            </select>
          </label>
          ${isAdminUser ? `
            <label>Rate limit por minuto
              <input name="rateLimitPerMinute" type="number" min="1" value="${escapeHtml(settings.defaultApiKeyRateLimit)}" />
            </label>
          ` : ''}
          <button class="secondary-button" type="submit">Generar API key</button>
        </form>
        <div class="table-wrap" style="margin-top: 1rem;">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Proyecto</th>
                <th>Prefijo</th>
                <th>Rate limit</th>
                <th>Estado</th>
                <th>Uso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${ownApiKeys.map((item) => `
                <tr>
                  <td>${escapeHtml(item.name)}</td>
                  <td>${escapeHtml(item.projectId ? projectNameById.get(item.projectId) || item.projectId : 'Sin proyecto')}</td>
                  <td style="font-family: var(--font-mono); font-size: 0.82rem;">${escapeHtml(item.keyPrefix)}...</td>
                  <td>
                    ${isAdminUser ? `
                      <form class="inline-form" data-form="update-api-key">
                        <input type="hidden" name="id" value="${escapeHtml(item.id)}" />
                        <input type="number" name="rateLimitPerMinute" min="1" value="${escapeHtml(item.rateLimitPerMinute)}" style="max-width: 96px;" />
                        <button class="ghost-button" type="submit">Guardar</button>
                      </form>
                    ` : escapeHtml(item.rateLimitPerMinute)}
                  </td>
                  <td>
                    <button class="${item.isActive ? 'ghost-button' : 'secondary-button'}" type="button" data-action="toggle-api-key" data-id="${escapeHtml(item.id)}" data-active="${item.isActive}">
                      ${item.isActive ? 'Activa' : 'Inactiva'}
                    </button>
                  </td>
                  <td>${formatNumber(item.totalRequests)}</td>
                  <td>
                    <button
                      class="ghost-button"
                      type="button"
                      data-action="regenerate-api-key"
                      data-id="${escapeHtml(item.id)}"
                      data-name="${escapeHtml(item.name)}"
                      title="Genera una nueva key — la actual deja de funcionar"
                      style="font-size: 0.78rem; padding: 0.25rem 0.6rem;"
                    >Regenerar</button>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="7">Sin API keys.</td></tr>'}
            </tbody>
          </table>
        </div>
        ${state.lastCreatedApiKey ? `
          <div class="revealed-key-banner" style="margin-top: 1rem; padding: 1rem; border-radius: var(--radius); border: 1px solid rgba(196,135,90,0.4); background: rgba(196,135,90,0.07);">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
              <span style="font-size: 0.85rem; font-weight: 600; color: var(--accent);">🔑 Tu API key — guárdala ahora, no se volverá a mostrar</span>
              <button
                class="ghost-button"
                type="button"
                data-action="dismiss-revealed-key"
                style="font-size: 0.75rem; padding: 0.2rem 0.5rem; color: var(--muted);"
              >Cerrar</button>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <code style="font-family: var(--font-mono); font-size: 0.82rem; background: var(--bg-soft); padding: 0.4rem 0.7rem; border-radius: 4px; word-break: break-all; flex: 1;">${escapeHtml(state.lastCreatedApiKey)}</code>
              <button
                class="secondary-button"
                type="button"
                data-action="copy-revealed-key"
                style="font-size: 0.78rem; flex-shrink: 0;"
              >${state.qsCopied === 'revealedkey' ? '✓ Copiada!' : 'Copiar'}</button>
            </div>
          </div>
        ` : ''}
      </article>
    `;
  }

  if (isAdminUser && state.settingsPage === 'users') {
    pageContent = `
      <section class="settings-grid">
        <article class="panel">
          <h3>Crear usuario</h3>
          <form data-form="create-user">
            <label>Nombre
              <input name="name" required />
            </label>
            <label>Correo
              <input name="email" type="email" required />
            </label>
            <label>Contrasena temporal
              <input name="password" type="password" minlength="8" required />
            </label>
            <label>Proyecto inicial
              <select name="projectId">
                <option value="">Sin proyecto</option>
                ${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('')}
              </select>
            </label>
            <label>Cuota mensual de requests
              <input name="monthlyRequestQuota" type="number" min="0" placeholder="1000" />
            </label>
            <button class="secondary-button" type="submit">Crear usuario sin admin</button>
          </form>
        </article>

        <article class="panel">
          <div class="row-between">
            <div>
              <h3>Usuarios</h3>
              <p class="muted">Activa cuentas, ajusta cuotas y genera links de recuperacion administrados.</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Cuotas</th>
                  <th>Estado</th>
                  <th>Uso</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${dashboard.users.map((user) => `
                  <tr>
                    <td>${escapeHtml(user.name)}</td>
                    <td>${escapeHtml(user.email)}</td>
                    <td>
                      <form class="inline-form" data-form="update-user-product">
                        <input type="hidden" name="id" value="${escapeHtml(user.id)}" />
                        <input type="number" name="monthlyRequestQuota" min="0" value="${escapeHtml(user.monthlyRequestQuota ?? '')}" placeholder="Req/mes" style="max-width: 96px;" />
                        <button class="ghost-button" type="submit">Guardar</button>
                      </form>
                    </td>
                    <td>
                      <button class="${user.isActive ? 'ghost-button' : 'danger-button'}" type="button" data-action="toggle-user" data-id="${escapeHtml(user.id)}" data-active="${user.isActive}">
                        ${user.isActive ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td>
                      ${(() => {
                        const summary = dashboard.userUsage.find((item) => item.id === user.id);
                        if (!summary) {
                          return '<span class="tag">Sin uso</span>';
                        }
                        return `<span class="tag ${formatUsageStatusClass(summary.status)}">${escapeHtml(formatUsageStatusLabel(summary.status))}</span>`;
                      })()}
                    </td>
                    <td>
                      <div class="button-row">
                        <button class="ghost-button" type="button" data-action="request-user-reset" data-id="${escapeHtml(user.id)}">Reset</button>
                        <span class="muted">${escapeHtml(formatDate(user.lastLoginAt))}</span>
                      </div>
                    </td>
                  </tr>
                `).join('') || '<tr><td colspan="6">Sin usuarios.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  if (isAdminUser && state.settingsPage === 'projects') {
    pageContent = `
      <section class="settings-grid">
        <article class="panel">
          <h3>Crear proyecto</h3>
          <form data-form="create-project">
            <label>Nombre
              <input name="name" placeholder="Producto web" required />
            </label>
            <label>Descripcion
              <textarea name="description" placeholder="Equipo, entorno o cliente"></textarea>
            </label>
            <label>Cuota mensual de requests
              <input name="requestQuotaMonthly" type="number" min="0" placeholder="5000" />
            </label>
            <label>Disponibilidad de modelos
              <select name="modelAccessMode">
                <option value="all">Todos los modelos del pool</option>
                <option value="selected">Solo los modelos seleccionados</option>
                <option value="none">Ningun modelo</option>
              </select>
            </label>
            <div>
              <div class="muted" style="margin-bottom:0.5rem;">Si eliges "solo seleccionados", estas casillas definen la allowlist del proyecto.</div>
              ${renderProjectModelPicker([], availableModels)}
            </div>
            <button class="primary-button" type="submit">Crear proyecto</button>
          </form>
        </article>

        <article class="panel">
          <h3>Invitar usuario</h3>
          <p class="muted">Puedes invitar por correo o generar un link temporal abierto.</p>
          <form data-form="create-invitation">
            <label>Correo (opcional)
              <input name="email" type="email" placeholder="persona@empresa.com" />
            </label>
            <label>Proyecto
              <select name="projectId">
                <option value="">Sin proyecto</option>
                ${projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('')}
              </select>
            </label>
            <label>Rol
              <select name="role">
                <option value="member">Miembro</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <label>Expira en horas
              <input name="expiresHours" type="number" min="1" value="72" />
            </label>
            <button class="secondary-button" type="submit">Generar invitacion</button>
          </form>
        </article>
      </section>

      <section class="panel">
          <div class="row-between">
            <div>
              <h3>Proyectos activos</h3>
              <p class="muted">Cuota y salud de consumo por proyecto.</p>
            </div>
          </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Uso actual</th>
                <th>Configuracion</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${projects.map((project) => {
                const summary = projectUsageById.get(project.id);
                return `
                  <tr>
                    <td>
                      <strong>${escapeHtml(project.name)}</strong>
                      <div class="muted">${escapeHtml(project.slug)}</div>
                      <div class="muted">${project.modelAccessMode === 'all' ? 'Modelos: todos' : project.modelAccessMode === 'none' ? 'Modelos: ninguno' : `Modelos: ${escapeHtml(String(project.allowedModelIds?.length || 0))} seleccionados`}</div>
                    </td>
                    <td>
                      <div>${formatNumber(summary?.requestCount || 0)} req</div>
                      <div class="muted">${formatTokenCount(summary?.totalTokens || 0)}</div>
                    </td>
                    <td>
                      <form data-form="update-project">
                        <input type="hidden" name="id" value="${escapeHtml(project.id)}" />
                        <div style="display:grid;gap:0.5rem;">
                          <input type="text" name="name" value="${escapeHtml(project.name)}" placeholder="Nombre" style="max-width: 180px;" />
                          <input type="number" name="requestQuotaMonthly" min="0" value="${escapeHtml(project.requestQuotaMonthly ?? '')}" placeholder="Req/mes" style="max-width: 120px;" />
                          <select name="modelAccessMode" style="max-width: 220px;">
                            <option value="all" ${project.modelAccessMode === 'all' ? 'selected' : ''}>Todos los modelos</option>
                            <option value="selected" ${project.modelAccessMode === 'selected' ? 'selected' : ''}>Solo seleccionados</option>
                            <option value="none" ${project.modelAccessMode === 'none' ? 'selected' : ''}>Ningun modelo</option>
                          </select>
                          ${renderProjectModelPicker(project.allowedModelIds || [], availableModels)}
                        </div>
                        <input type="hidden" name="description" value="${escapeHtml(project.description ?? '')}" />
                        <input type="hidden" name="isActive" value="${project.isActive ? 'true' : 'false'}" />
                        <button class="ghost-button" type="submit">Guardar</button>
                      </form>
                    </td>
                    <td>
                      <span class="tag ${formatUsageStatusClass(summary?.status || 'ok')}">${escapeHtml(formatUsageStatusLabel(summary?.status || 'ok'))}</span>
                    </td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="4">Sin proyectos.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <h3>Invitaciones recientes</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Correo</th>
                <th>Proyecto</th>
                <th>Rol</th>
                <th>Expira</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${invitations.map((invitation) => `
                <tr>
                  <td>${escapeHtml(invitation.email || 'Link abierto')}</td>
                  <td>${escapeHtml(invitation.projectName || 'Sin proyecto')}</td>
                  <td>${escapeHtml(invitation.role)}</td>
                  <td>${escapeHtml(formatDate(invitation.expiresAt))}</td>
                  <td><span class="tag ${invitation.acceptedAt ? 'success' : 'warn'}">${invitation.acceptedAt ? 'Aceptada' : 'Pendiente'}</span></td>
                </tr>
              `).join('') || '<tr><td colspan="5">Sin invitaciones recientes.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  if (isAdminUser && state.settingsPage === 'service-keys') {
    pageContent = `
      <section class="settings-grid">
        <article class="panel">
          <h3>Agregar service key</h3>
          <p class="muted">Si ya definiste variables del sistema como GROQ_API_KEY, el router las toma sin necesidad de guardarlas en .env ni registrarlas aqui.</p>
          <form data-form="create-service-key">
            <label>Proveedor
              <select name="provider">
                ${providerOptions.map((provider) => `<option value="${provider}">${formatProviderLabel(provider)}</option>`).join('')}
              </select>
            </label>
            <label>Nombre interno
              <input name="name" placeholder="Groq key principal" required />
            </label>
            <label>Service API key
              <input name="value" required />
            </label>
            <label>Prioridad
              <input name="priority" type="number" min="1" value="100" />
            </label>
            <button class="primary-button" type="submit">Agregar service key</button>
          </form>
        </article>

        <article class="panel">
          <div class="row-between">
            <div>
              <h3>Service keys cargadas</h3>
              <p class="muted">Las llaves del panel se editan aqui; las del sistema aparecen como solo lectura.</p>
            </div>
            <button class="ghost-button" type="button" data-action="reset-router">Reset router</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Origen</th>
                  <th>Nombre</th>
                  <th>Hint</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                ${renderServiceKeyRows(dashboard.serviceKeys)}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    `;
  }

  if (isAdminUser && state.settingsPage === 'provider-limits') {
    pageContent = `
      <section class="panel">
        <div class="row-between">
          <div>
            <h3>Limites por proveedor</h3>
            <p class="muted">Cada proveedor puede quedar en cooldown completo antes de que el endpoint externo responda con error.</p>
          </div>
        </div>
        <div class="limit-grid">
          ${providerOptions.map((providerId) => {
            const rule = providerRuleMap.get(providerId) || createEmptyLimitRule(providerId, providerId);
            const providerState = getProviderPoolState(providerId);
            return `
              <form class="limit-card" data-form="update-provider-limit">
                <input type="hidden" name="provider" value="${escapeHtml(providerId)}" />
                <div class="row-between">
                  <strong>${escapeHtml(formatProviderLabel(providerId))}</strong>
                  <span class="tag ${providerState?.status === 'cooldown' ? 'warn' : 'success'}">${escapeHtml(providerState?.status || 'available')}</span>
                </div>
                <p class="muted">Modelos visibles: ${formatNumber(providerState?.models || 0)}${providerState?.cooldownUntil ? ` | Hasta: ${escapeHtml(formatDate(providerState.cooldownUntil))}` : ''}</p>
                ${providerState?.lastReason ? `<p class="muted">${escapeHtml(providerState.lastReason)}</p>` : ''}
                ${renderLimitFields(rule)}
                <button class="primary-button" type="submit">Guardar limite</button>
              </form>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  if (isAdminUser && state.settingsPage === 'model-limits') {
    pageContent = `
      <section class="settings-grid">
        <article class="panel">
          <h3>Nuevo limite por modelo</h3>
          ${availableModels.length === 0 ? '<div class="empty-state">No hay modelos cargados para configurar limites.</div>' : `
            <form data-form="update-model-limit">
              <label>Modelo
                <select name="modelId">
                  ${availableModelIds.map((modelId) => `<option value="${escapeHtml(modelId)}">${escapeHtml(modelId)}</option>`).join('')}
                </select>
              </label>
              ${renderLimitFields(createEmptyLimitRule(defaultModelId, defaultModelId.split('/')[0] || null))}
              <button class="primary-button" type="submit">Guardar limite del modelo</button>
            </form>
          `}
        </article>

        <article class="panel">
          <div class="row-between">
            <div>
              <h3>Limites activos por modelo</h3>
              <p class="muted">Puedes dejar un modelo con modo "Sin limite" para desactivar su restriccion guardada.</p>
            </div>
          </div>
          ${modelRules.length === 0 ? '<div class="empty-state">Todavia no hay limites por modelo configurados.</div>' : `
            <div class="limit-grid">
              ${modelRules.map((rule) => `
                <form class="limit-card" data-form="update-model-limit">
                  <input type="hidden" name="modelId" value="${escapeHtml(rule.scopeId)}" />
                  <div class="row-between">
                    <strong>${escapeHtml(rule.scopeId)}</strong>
                    <span class="tag">${escapeHtml(rule.mode)}</span>
                  </div>
                  <p class="muted">Proveedor: ${escapeHtml(formatProviderLabel(rule.provider || rule.scopeId.split('/')[0] || ''))}</p>
                  ${renderLimitFields(rule)}
                  <button class="secondary-button" type="submit">Actualizar modelo</button>
                </form>
              `).join('')}
            </div>
          `}
        </article>
      </section>
    `;
  }

  if (state.settingsPage === 'custom-providers') {
    pageContent = renderSettingsCustomProviders();
  }

  if (isAdminUser && state.settingsPage === 'model-tiers') {
    pageContent = renderSettingsModelTiers();
  }

  if (isAdminUser && state.settingsPage === 'model-aliases') {
    pageContent = renderSettingsModelAliases();
  }

  return `
    <section class="settings-shell">
      <aside class="settings-nav panel">
        <div>
          <p class="tag">Multi pagina</p>
          <h3 style="margin-bottom: 0.45rem;">Ajustes</h3>
          <p class="muted" style="margin: 0;">Cada categoria vive en su propia vista para que editar sea mas claro.</p>
        </div>
        <div class="settings-nav-list">
          ${pages.map((page) => `
            <button class="${state.settingsPage === page.id ? 'secondary-button' : 'ghost-button'}" type="button" data-action="switch-settings-page" data-page="${page.id}">
              ${escapeHtml(page.label)}
            </button>
          `).join('')}
        </div>
      </aside>

      <div class="settings-page">
        <section class="panel settings-page-hero">
          <div>
            <p class="tag">${escapeHtml(activePage.label)}</p>
            <h3>${escapeHtml(activePage.title)}</h3>
            <p class="muted">${escapeHtml(activePage.description)}</p>
          </div>
          <div class="button-row">
            <button class="ghost-button" type="button" data-action="open-settings-guide" data-page="${escapeHtml(activePage.id)}">Ver tutorial</button>
          </div>
        </section>
        ${pageContent}
      </div>
    </section>
  `;
}

// ─── Quick Start ──────────────────────────────────────────────────────────────

function getQuickStartAgents() {
  return [
    {
      id: 'opencode',
      name: 'opencode',
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
      description: 'Agente de codigo en terminal. Soporta multiples modelos configurables en JSON.',
      multiModel: true,
      configType: 'json-file',
      configFile: '.opencode.json',
      configNote: 'Requiere dos archivos: auth.json global y .opencode.json en tu proyecto.',
    },
    {
      id: 'cline',
      name: 'Cline (VS Code)',
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>',
      description: 'Extension de VS Code. Un solo modelo por configuracion (OpenAI Compatible).',
      multiModel: false,
      configType: 'ui-steps',
      configNote: 'Configura desde la UI de VS Code — no requiere editar archivos.',
    },
    {
      id: 'continue',
      name: 'Continue.dev',
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 21v-5h5"></path></svg>',
      description: 'Extension de VS Code / JetBrains. Soporta multiples modelos en config.yaml.',
      multiModel: true,
      configType: 'yaml-file',
      configFile: '~/.continue/config.yaml',
      configNote: 'Archivo global en ~/.continue/config.yaml o local en .continue/config.yaml',
    },
    {
      id: 'aider',
      name: 'Aider',
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>',
      description: 'Agente de codigo en terminal. Un modelo activo por sesion, via .env o flags.',
      multiModel: false,
      configType: 'env-file',
      configFile: '.aider.conf.yml',
      configNote: 'Crea un archivo .aider.conf.yml en la raiz de tu proyecto.',
    },
    {
      id: 'cursor',
      name: 'Cursor IDE',
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 7.07 17 2.51-7.39L21 11.07z"></path></svg>',
      description: 'IDE con AI integrada. Configuracion via UI — no edita archivos de texto.',
      multiModel: false,
      configType: 'ui-steps',
      configNote: 'Configura desde Cursor Settings > Models — no requiere editar archivos.',
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path><path d="M9 18c-4.51 2-5-2-7-2"></path></svg>',
      description: 'Copilot nativo de VS Code. Requiere settings.json o extension OAIProvider.',
      multiModel: false,
      configType: 'json-file',
      configFile: '.vscode/settings.json',
      configNote: 'Agrega esta clave al settings.json de tu proyecto o al global de VS Code.',
    },
  ];
}


function getQuickStartBaseUrl() {
  return window.location.origin + '/v1';
}

function getQuickStartApiKey() {
  // Si tenemos una key recien creada en sesion, mostrarla completa
  if (state.lastCreatedApiKey) return state.lastCreatedApiKey;
  // Fallback: hint enmascarado
  const keys = state.dashboard?.apiKeys || [];
  const active = keys.find((k) => k.isActive);
  return active ? active.hint || '' : '';
}

function getQuickStartModels() {
  return (state.dashboard?.pool?.models || [])
    .filter((m) => !m.paidOnly)
    .map((m) => ({ id: m.id, provider: String(m.provider || 'custom') }));
}

function buildOpenCodeConfig(selectedModels, baseUrl, apiKey) {
  const models = selectedModels.length > 0 ? selectedModels : ['auto'];
  const firstModel = models[0];

  const authConfig = {
    "vagaroute-ai": {
      "type": "api",
      "key": apiKey,
      "baseURL": baseUrl,
      "models": models
    }
  };

  const opencodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    model: `vagaroute-ai/${firstModel}`,
    provider: {
      'vagaroute-ai': {
        name: 'VagaRoute AI',
        api: 'openai',
        models: models,
      },
    },
  };

  return {
    authJson: JSON.stringify(authConfig, null, 2),
    opencodeJson: JSON.stringify(opencodeConfig, null, 2)
  };
}

function buildContinueConfig(selectedModels, baseUrl, apiKey) {
  const models = selectedModels.length > 0 ? selectedModels : ['auto'];
  const modelEntries = models.map((m) => ({
    name: m,
    provider: 'openai',
    model: m,
    apiKey: apiKey,
    apiBase: baseUrl,
  }));

  const yaml = `models:\n${modelEntries.map((entry) => `  - name: "${entry.name}"\n    provider: openai\n    model: "${entry.model}"\n    apiKey: "${entry.apiKey}"\n    apiBase: "${entry.apiBase}"`).join('\n')}`;
  return yaml;
}

function buildAiderConfig(selectedModel, baseUrl, apiKey) {
  const model = selectedModel || 'auto';
  return `# .aider.conf.yml — Configuracion de Aider para VagaRoute AI\n# Coloca este archivo en la raiz de tu proyecto\n\nmodel: openai/${model}\nopenai-api-base: ${baseUrl}\nopenai-api-key: ${apiKey}\n\n# Metadata opcional para modelos desconocidos (crea .aider.model.metadata.json)\n# {\n#   "openai/${model}": {\n#     "max_tokens": 8192,\n#     "max_input_tokens": 128000,\n#     "max_output_tokens": 8192,\n#     "input_cost_per_token": 0.0,\n#     "output_cost_per_token": 0.0,\n#     "mode": "chat"\n#   }\n# }`;
}

function buildCopilotSettingsJson(selectedModel, baseUrl, apiKey) {
  const model = selectedModel || 'auto';
  const settings = {
    'github.copilot.advanced': {
      'authProvider': 'github',
    },
    'github.copilot.chat.customOAIModels': [
      {
        id: model,
        name: `VagaRoute AI — ${model}`,
        baseUrl: baseUrl,
        apiKey: apiKey,
        supportsToolCalls: true,
        supportsVision: false,
      },
    ],
  };
  return JSON.stringify(settings, null, 2);
}

function buildClineSteps(selectedModel, baseUrl, apiKey) {
  const model = selectedModel || 'auto';
  return [
    { step: '1', label: 'Abre VS Code y ve al panel de Cline en la barra lateral.', code: null },
    { step: '2', label: 'Haz clic en el icono ⚙️ (configuracion) en la esquina superior derecha del panel.', code: null },
    { step: '3', label: 'Selecciona API Provider:', code: 'OpenAI Compatible' },
    { step: '4', label: 'Ingresa la Base URL:', code: baseUrl },
    { step: '5', label: 'Ingresa tu API Key:', code: apiKey },
    { step: '6', label: 'Ingresa el Model ID:', code: model },
    { step: '7', label: 'Haz clic en Done / Save.', code: null },
  ];
}

function buildCursorSteps(selectedModel, baseUrl, apiKey) {
  const model = selectedModel || 'auto';
  return [
    { step: '1', label: 'Abre Cursor Settings con Ctrl+Shift+J (o Cmd+Shift+J en Mac).', code: null },
    { step: '2', label: 'Ve a la pestana Models.', code: null },
    { step: '3', label: 'Haz clic en Add Model (+) e ingresa el nombre del modelo:', code: model },
    { step: '4', label: 'Baja a la seccion OpenAI API Key e ingresa tu API Key:', code: apiKey },
    { step: '5', label: 'Activa la opcion Override OpenAI Base URL e ingresa:', code: baseUrl },
    { step: '6', label: 'Haz clic en Verify para confirmar la conexion.', code: null },
  ];
}

function renderQuickStartStepList(steps) {
  return `
    <div class="qs-steps">
      ${steps.map((step) => `
        <div class="qs-step">
          <span class="qs-step-num">${escapeHtml(step.step)}</span>
          <div class="qs-step-body">
            <p>${escapeHtml(step.label)}</p>
            ${step.code ? `
              <div class="qs-code-row">
                <code class="qs-inline-code">${escapeHtml(step.code)}</code>
                <button
                  class="ghost-button"
                  type="button"
                  data-action="qs-copy"
                  data-qs-text="${escapeHtml(step.code)}"
                  style="padding: 0.2rem 0.6rem; font-size: 0.75rem;"
                >${state.qsCopied === step.code ? '✓ Copiado' : 'Copiar'}</button>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderQuickStartConfigBlock(label, content, copyId) {
  const isCopied = state.qsCopied === copyId;
  return `
    <div class="qs-config-block">
      <div class="qs-config-header">
        <span class="qs-config-label">${escapeHtml(label)}</span>
        <button
          class="${isCopied ? 'secondary-button' : 'ghost-button'}"
          type="button"
          data-action="qs-copy"
          data-qs-text="${escapeHtml(content)}"
          data-qs-id="${escapeHtml(copyId)}"
          style="padding: 0.3rem 0.8rem; font-size: 0.78rem;"
        >${isCopied ? '✓ Copiado!' : 'Copiar todo'}</button>
      </div>
      <pre class="qs-pre"><code>${escapeHtml(content)}</code></pre>
    </div>
  `;
}

function renderQuickstart() {
  const agents = getQuickStartAgents();
  const selectedAgent = agents.find((a) => a.id === state.qsAgent) || agents[0];
  const baseUrl = getQuickStartBaseUrl();
  const apiKey = getQuickStartApiKey();
  const allModelObjects = getQuickStartModels(); // [{id, provider}]
  const allModelIds = allModelObjects.map((m) => m.id);
  const selectedModels = state.qsSelectedModels;
  const firstModel = selectedModels[0] || allModelIds[0] || 'auto';
  const apiKeyHint = !state.lastCreatedApiKey && !apiKey;

  let outputSection = '';

  if (selectedAgent.id === 'opencode') {
    const configContent = buildOpenCodeConfig(
      selectedModels.length > 0 ? selectedModels : allModelIds.slice(0, 5),
      baseUrl, apiKey,
    );
    outputSection = `
      <p class="muted" style="margin-bottom: 1rem;">
        Selecciona los modelos que quieres incluir en tu configuración de opencode.
      </p>
      ${renderQuickStartModelPicker(allModelObjects, selectedModels, true)}
      <div style="margin-top: 1.5rem;">
        <h4 style="margin-bottom: 0.5rem; font-size: 0.9rem;">1. Autenticación</h4>
        <p class="muted" style="margin-bottom: 1rem; font-size: 0.85rem;">Copia este contenido en <code>~/.local/share/opencode/auth.json</code> para guardar tus credenciales de forma segura.</p>
        ${renderQuickStartConfigBlock('~/.local/share/opencode/auth.json', configContent.authJson, 'opencode-auth')}
      </div>
      <div style="margin-top: 1.5rem;">
        <h4 style="margin-bottom: 0.5rem; font-size: 0.9rem;">2. Configuración del Proyecto</h4>
        <p class="muted" style="margin-bottom: 1rem; font-size: 0.85rem;">Copia este bloque en tu <code>${escapeHtml(selectedAgent.configFile)}</code>.</p>
        ${renderQuickStartConfigBlock(selectedAgent.configFile, configContent.opencodeJson, 'opencode-config')}
      </div>
    `;
  } else if (selectedAgent.id === 'continue') {
    const configContent = buildContinueConfig(
      selectedModels.length > 0 ? selectedModels : allModelIds.slice(0, 3),
      baseUrl, apiKey,
    );
    outputSection = `
      <p class="muted" style="margin-bottom: 1rem;">
        Selecciona los modelos que quieres agregar a tu <code>config.yaml</code> de Continue.
        Cada modelo se agrega como una entrada separada bajo la clave <code>models</code>.
      </p>
      ${renderQuickStartModelPicker(allModelObjects, selectedModels, true)}
      ${renderQuickStartConfigBlock(selectedAgent.configFile, configContent, 'continue-config')}
    `;
  } else if (selectedAgent.id === 'aider') {
    outputSection = `
      <p class="muted" style="margin-bottom: 1rem;">
        Aider usa un solo modelo activo por sesion. Selecciona el modelo principal.
      </p>
      ${renderQuickStartModelPicker(allModelObjects, selectedModels, false)}
      ${renderQuickStartConfigBlock(selectedAgent.configFile, buildAiderConfig(firstModel, baseUrl, apiKey), 'aider-config')}
      <div class="panel" style="margin-top: 1rem; padding: 1rem;">
        <strong style="font-size: 0.85rem;">Alternativa: variables de entorno</strong>
        <p class="muted">Puedes tambien exportar estas variables en tu shell antes de correr aider:</p>
        ${renderQuickStartConfigBlock('.env (shell)', `OPENAI_API_BASE=${baseUrl}\nOPENAI_API_KEY=${apiKey}`, 'aider-env')}
        <p class="muted" style="margin-top: 0.5rem;">Y luego ejecutar: <code>aider --model openai/${firstModel}</code></p>
      </div>
    `;
  } else if (selectedAgent.id === 'copilot') {
    outputSection = `
      <p class="muted" style="margin-bottom: 1rem;">
        Selecciona el modelo que quieres exponer en GitHub Copilot Chat.
        Requiere configuracion en <code>.vscode/settings.json</code> o en settings globales de VS Code.
      </p>
      ${renderQuickStartModelPicker(allModelObjects, selectedModels, false)}
      ${renderQuickStartConfigBlock(selectedAgent.configFile, buildCopilotSettingsJson(firstModel, baseUrl, apiKey), 'copilot-config')}
      <div class="panel" style="margin-top: 1rem; padding: 1rem; border-left: 2px solid var(--warning, #f5a623);">
        <strong style="font-size: 0.85rem; color: var(--warning, #f5a623);">Nota importante</strong>
        <p class="muted">
          La compatibilidad de Copilot con endpoints custom depende de la version del extension y del plan (Free/Pro).
          Si tienes Copilot Business o Enterprise, puede estar restringido por politica de la organizacion.
          Alternativa: usa la extension <strong>OAIProvider</strong> del marketplace de VS Code.
        </p>
      </div>
    `;
  } else if (selectedAgent.id === 'cline') {
    const steps = buildClineSteps(firstModel, baseUrl, apiKey);
    outputSection = `
      <p class="muted" style="margin-bottom: 1rem;">
        Cline se configura desde la UI de VS Code. Selecciona el modelo que usaras como default.
      </p>
      ${renderQuickStartModelPicker(allModelObjects, selectedModels, false)}
      ${renderQuickStartStepList(steps)}
    `;
  } else if (selectedAgent.id === 'cursor') {
    const steps = buildCursorSteps(firstModel, baseUrl, apiKey);
    outputSection = `
      <p class="muted" style="margin-bottom: 1rem;">
        Cursor IDE se configura desde su panel de settings. Selecciona el modelo que registraras.
      </p>
      ${renderQuickStartModelPicker(allModelObjects, selectedModels, false)}
      ${renderQuickStartStepList(steps)}
      <div class="panel" style="margin-top: 1rem; padding: 1rem; border-left: 2px solid var(--accent);">
        <strong style="font-size: 0.85rem;">Nota sobre modelo global</strong>
        <p class="muted">
          El Override de Base URL en Cursor es <strong>global</strong>: aplica a todos los modelos si esta activo.
          Si necesitas alternar entre modelos de Cursor y tu gateway, desactiva el override cuando uses modelos nativos de Cursor.
        </p>
      </div>
    `;
  }

  return `
    <div class="qs-shell">
      <div class="qs-agent-bar">
        ${agents.map((agent) => `
          <button
            class="qs-agent-btn ${state.qsAgent === agent.id ? 'active' : ''}"
            type="button"
            data-action="qs-pick-agent"
            data-agent="${escapeHtml(agent.id)}"
            title="${escapeHtml(agent.description)}"
          >
            <span class="qs-agent-icon">${agent.icon}</span>
            <span class="qs-agent-name">${escapeHtml(agent.name)}</span>
            ${agent.multiModel ? '<span class="qs-multi-badge" title="Soporta multiples modelos">multi</span>' : ''}
          </button>
        `).join('')}
      </div>

      <div class="qs-main">
        <div class="qs-sidebar">
          <div class="panel" style="padding: 1.25rem;">
            <div class="qs-agent-header">
              <span style="font-size: 2rem; line-height: 1;">${selectedAgent.icon}</span>
              <div>
                <strong style="font-size: 1.05rem;">${escapeHtml(selectedAgent.name)}</strong>
                ${selectedAgent.multiModel
                  ? '<span class="tag success" style="font-size: 0.7rem; margin-left: 0.4rem;">Multi-modelo</span>'
                  : '<span class="tag" style="font-size: 0.7rem; margin-left: 0.4rem;">Modelo unico</span>'}
              </div>
            </div>
            <p class="muted" style="margin: 0.75rem 0;">${escapeHtml(selectedAgent.description)}</p>
            <div class="qs-info-grid">
              ${selectedAgent.configFile ? `
                <div>
                  <span class="muted" style="font-size: 0.75rem;">Archivo</span>
                  <code style="font-size: 0.78rem; display: block; margin-top: 0.2rem;">${escapeHtml(selectedAgent.configFile)}</code>
                </div>
              ` : ''}
              <div>
                <span class="muted" style="font-size: 0.75rem;">Tipo</span>
                <span style="font-size: 0.82rem; display: block; margin-top: 0.2rem; text-transform: capitalize;">${escapeHtml(selectedAgent.configType.replace(/-/g, ' '))}</span>
              </div>
            </div>
            ${selectedAgent.configNote ? `
              <p class="muted" style="margin: 0.75rem 0 0; font-size: 0.78rem; border-top: 1px solid var(--border); padding-top: 0.75rem;">
                ${escapeHtml(selectedAgent.configNote)}
              </p>
            ` : ''}
          </div>

          <div class="panel" style="padding: 1.25rem; margin-top: 1rem;">
            <strong style="font-size: 0.85rem; display: block; margin-bottom: 0.75rem;">Tus credenciales</strong>
            <div class="qs-cred-grid">
              <div>
                <span class="muted" style="font-size: 0.75rem;">Base URL</span>
                <div class="qs-cred-row">
                  <code style="font-size: 0.75rem; word-break: break-all;">${escapeHtml(baseUrl)}</code>
                  <button
                    class="ghost-button"
                    type="button"
                    data-action="qs-copy"
                    data-qs-text="${escapeHtml(baseUrl)}"
                    data-qs-id="baseurl"
                    style="padding: 0.2rem 0.5rem; font-size: 0.7rem; flex-shrink: 0;"
                  >${state.qsCopied === 'baseurl' ? '✓' : 'Copiar'}</button>
                </div>
              </div>
              <div>
                <span class="muted" style="font-size: 0.75rem;">API Key</span>
                <div class="qs-cred-row">
                  ${apiKey
                    ? `<code style="font-size: 0.75rem; word-break: break-all; font-family: var(--font-mono);">${escapeHtml(apiKey)}</code>`
                    : `<span class="muted" style="font-size: 0.75rem;">Crea una API key en Ajustes &gt; API keys para verla aqui.</span>`
                  }
                  ${apiKey ? `
                    <button
                      class="ghost-button"
                      type="button"
                      data-action="qs-copy"
                      data-qs-text="${escapeHtml(apiKey)}"
                      data-qs-id="apikey"
                      style="padding: 0.2rem 0.5rem; font-size: 0.7rem; flex-shrink: 0;"
                    >${state.qsCopied === 'apikey' ? '✓' : 'Copiar'}</button>
                  ` : ''}
                </div>
                ${state.lastCreatedApiKey
                  ? `<p style="font-size: 0.7rem; margin-top: 0.25rem; color: var(--accent);">⚠ Key visible solo en esta sesion. Guardala ahora.</p>`
                  : apiKey
                    ? `<p class="muted" style="font-size: 0.7rem; margin-top: 0.25rem;">Hint enmascarado. Crea una nueva key para verla completa.</p>`
                    : ''
                }
              </div>
            </div>
          </div>
        </div>

        <div class="qs-content">
          <div class="panel" style="padding: 1.5rem;">
            <h3 style="margin: 0 0 0.25rem;">Configuracion para ${escapeHtml(selectedAgent.name)}</h3>
            <p class="muted" style="margin: 0 0 1.5rem;">
              ${selectedAgent.configType === 'ui-steps'
                ? 'Sigue estos pasos en la interfaz del agente.'
                : `Copia este contenido en <code>${escapeHtml(selectedAgent.configFile || 'el archivo indicado')}</code>.`}
            </p>
            ${outputSection}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderQuickStartModelPicker(allModelObjects, selectedModels, multi) {
  // allModelObjects: [{id, provider}]
  // selectedModels: [id, ...]
  if (allModelObjects.length === 0) {
    return '<p class="muted">No hay modelos disponibles en el pool en este momento.</p>';
  }

  // Build provider list for filter
  const providers = [...new Set(allModelObjects.map((m) => m.provider).filter(Boolean))].sort();
  const filter = state.qsProviderFilter;
  const filteredObjects = filter ? allModelObjects.filter((m) => m.provider === filter) : allModelObjects;
  const filteredIds = filteredObjects.map((m) => m.id);

  const filterBar = providers.length > 1 ? `
    <div class="qs-filter-bar">
      <span class="qs-filter-label">Proveedor:</span>
      <button
        class="qs-filter-btn ${!filter ? 'active' : ''}"
        type="button"
        data-action="qs-provider-filter"
        data-provider=""
      >Todos</button>
      ${providers.map((p) => `
        <button
          class="qs-filter-btn ${filter === p ? 'active' : ''}"
          type="button"
          data-action="qs-provider-filter"
          data-provider="${escapeHtml(p)}"
        >${escapeHtml(p)}</button>
      `).join('')}
    </div>
  ` : '';

  if (!multi) {
    // Single model radio picker
    const active = selectedModels[0] || filteredIds[0] || '';
    return `
      <div class="qs-model-picker" style="margin-bottom: 1rem;">
        <div class="qs-picker-toolbar">
          <div class="qs-model-picker-label">Selecciona el modelo:</div>
        </div>
        ${filterBar}
        <div class="qs-model-list">
          ${filteredObjects.map(({ id: modelId }) => `
            <label class="qs-model-item ${active === modelId ? 'active' : ''}">
              <input
                type="radio"
                name="qs-model-single"
                value="${escapeHtml(modelId)}"
                ${active === modelId ? 'checked' : ''}
                data-action="qs-pick-single-model"
                data-model="${escapeHtml(modelId)}"
              />
              <span class="qs-model-id">${escapeHtml(modelId)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Multi model checkbox picker
  // "all selected" = empty array; otherwise = explicit list
  const allSelected = selectedModels.length === 0;
  const selectedCount = allSelected ? allModelObjects.length : selectedModels.length;

  return `
    <div class="qs-model-picker" style="margin-bottom: 1rem;">
      <div class="qs-picker-toolbar">
        <div class="qs-model-picker-label">
          Modelos a incluir:
          <span class="muted" style="font-size: 0.75rem; margin-left: 0.4rem;">
            ${selectedCount}/${allModelObjects.length} seleccionados
          </span>
        </div>
        <div class="qs-picker-actions">
          <button
            class="ghost-button"
            type="button"
            data-action="qs-select-all"
            style="padding: 0.2rem 0.6rem; font-size: 0.75rem;"
          >Todo</button>
          <button
            class="ghost-button"
            type="button"
            data-action="qs-deselect-all"
            style="padding: 0.2rem 0.6rem; font-size: 0.75rem; color: var(--muted);"
            ${selectedModels.length === 0 ? 'disabled' : ''}
          >Ninguno</button>
        </div>
      </div>
      ${filterBar}
      <div class="qs-model-list" id="qs-model-list-scroll">
        ${filteredObjects.map(({ id: modelId }) => {
          const checked = allSelected || selectedModels.includes(modelId);
          return `
            <label class="qs-model-item ${checked ? 'active' : ''}">
              <input
                type="checkbox"
                value="${escapeHtml(modelId)}"
                ${checked ? 'checked' : ''}
                data-action="qs-toggle-model"
                data-model="${escapeHtml(modelId)}"
              />
              <span class="qs-model-id">${escapeHtml(modelId)}</span>
            </label>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────

function renderContent() {
  if (!state.dashboard) {
    return '<div class="panel">Cargando dashboard...</div>';
  }

  if (state.view === 'quickstart') return renderQuickstart();
  if (state.view === 'chat') return renderChat();
  if (state.view === 'playground') return renderPlayground();
  if (state.view === 'metrics') return renderMetrics();
  if (state.view === 'settings') return renderSettingsMultiPage();
  return renderOverview();
}

function getViewTitle(view) {
  const titles = {
    overview: 'Resumen operativo',
    quickstart: 'Inicio rapido — Configura tu agente de IA',
    chat: 'Chat embebido',
    playground: 'Playground de endpoints',
    metrics: 'Metricas del router',
    settings: 'Ajustes y seguridad',
  };
  return titles[view] || 'Panel';
}

function renderAppShell() {
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="/logo.png" alt="VagaRoute AI Logo" style="max-height: 48px; margin-bottom: 1rem; border-radius: 8px; display: block;" />
          <p class="tag">${escapeHtml(getAppName())}</p>
          <h1>VagaRoute AI</h1>
          <p>Control oscuro, sobrio y operativo para seguridad, llaves, playground y uso del API.</p>
        </div>
        <nav class="nav">
          ${[
            ['overview', 'Resumen'],
            ['quickstart', 'Inicio rapido'],
            ['chat', 'Chat'],
            ['playground', 'Playground'],
            ['metrics', 'Metricas'],
            ['settings', 'Ajustes'],
          ].map(([id, label]) => `
            <button class="${state.view === id ? 'active' : ''}" type="button" data-action="switch-view" data-view="${id}">
              ${escapeHtml(label)}
            </button>
          `).join('')}
        </nav>
        <div class="sidebar-foot">
          <div>
            <strong>${escapeHtml(state.dashboard.me.name)}</strong>
            <span class="muted">${escapeHtml(state.dashboard.me.email)}</span>
          </div>
          <div class="button-row">
            <span class="tag ${state.dashboard.auth.isAdmin ? 'success' : ''}">${state.dashboard.auth.isAdmin ? 'Administrador' : 'Usuario'}</span>
            <span class="tag">${escapeHtml(state.dashboard.auth.via)}</span>
          </div>
          <button class="danger-button" type="button" data-action="logout">Cerrar sesion</button>
        </div>
      </aside>
      <main class="main">
        <section class="topbar">
          <div class="headline">
            <h2>${escapeHtml(getViewTitle(state.view))}</h2>
            <p>Sesion expira: ${escapeHtml(formatDate(state.dashboard.auth.sessionExpiresAt))}</p>
          </div>
          <div class="button-row">
            <button class="ghost-button" type="button" data-action="refresh-dashboard">Recargar</button>
          </div>
        </section>
        <section class="content">
          ${flashMarkup()}
          ${renderContent()}
        </section>
      </main>
      ${renderSettingsGuideModal()}
    </div>
  `;
}

function render() {
  if (state.mode === 'bootstrap') {
    app.innerHTML = renderBootstrap();
    return;
  }
  if (state.mode === 'login') {
    app.innerHTML = renderLogin();
    return;
  }
  if (state.mode === 'app') {
    app.innerHTML = renderAppShell();
    return;
  }

  app.innerHTML = `
    <div class="auth-layout">
      <div class="auth-card">
        <div class="auth-copy">
          <h1>${escapeHtml(getAppName())}</h1>
          <p>Preparando el panel...</p>
        </div>
        <div class="auth-form">
          <div class="empty-state">Cargando configuracion y estado del router.</div>
        </div>
      </div>
    </div>
  `;
}

async function refreshDashboard() {
  state.dashboard = await apiRequest('/api/dashboard');
  state.me = state.dashboard.me;
  render();
}

async function bootstrapFlow() {
  clearFlash();
  const authParams = getAuthParams();
  const bootstrap = await apiRequest('/api/bootstrap/status', { allow401: true });
  state.needsSetup = bootstrap.needsSetup;
  if (bootstrap.needsSetup) {
    state.mode = 'bootstrap';
    render();
    return;
  }

  try {
    await refreshDashboard();
    state.mode = 'app';
    render();
  } catch {
    state.authMode = authParams.invite ? 'invite' : authParams.reset ? 'reset-confirm' : 'login';
    state.invitePreview = null;
    if (authParams.invite) {
      try {
        const preview = await apiRequest(`/api/invitations/${encodeURIComponent(authParams.invite)}`, { allow401: true });
        state.invitePreview = preview.invitation;
      } catch (error) {
        const flash = buildFlashFromError(error, 'La invitacion ya no es valida.');
        setFlash(flash.message, 'error', flash.details);
        clearAuthParams();
        state.authMode = 'login';
      }
    }
    state.mode = 'login';
    render();
  }
}

async function submitBootstrap(form) {
  const formData = new FormData(form);
  const result = await apiRequest('/api/bootstrap', {
    method: 'POST',
    body: {
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password'),
    },
  });
  state.lastCreatedApiKey = result.rawApiKey;
  state.sharedValueKind = 'api-key';
  state.mode = 'app';
  await refreshDashboard();
  setFlash('Cuenta administradora creada correctamente.');
}

async function submitLogin(form) {
  const formData = new FormData(form);
  await apiRequest('/api/login', {
    method: 'POST',
    body: {
      email: formData.get('email'),
      password: formData.get('password'),
    },
  });
  state.mode = 'app';
  await refreshDashboard();
  setFlash('Sesion iniciada.');
}

async function submitAcceptInvite(form) {
  const formData = new FormData(form);
  const authParams = getAuthParams();
  const result = await apiRequest('/api/invitations/accept', {
    method: 'POST',
    body: {
      token: authParams.invite,
      email: formData.get('email'),
      name: formData.get('name'),
      password: formData.get('password'),
    },
  });
  state.lastCreatedApiKey = result.rawApiKey;
  state.sharedValueKind = 'api-key';
  clearAuthParams();
  state.authMode = 'login';
  state.mode = 'app';
  await refreshDashboard();
  setFlash('Invitacion aceptada. Ya puedes usar el panel.');
}

async function submitPasswordResetRequest(form) {
  const formData = new FormData(form);
  await apiRequest('/api/auth/password-reset/request', {
    method: 'POST',
    body: {
      email: formData.get('email'),
    },
    allow401: true,
  });
  state.authMode = 'login';
  setFlash('Si el correo existe, el administrador vera el link temporal en la terminal del servidor.');
  render();
}

async function submitPasswordResetConfirm(form) {
  const formData = new FormData(form);
  const authParams = getAuthParams();
  await apiRequest('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: {
      token: authParams.reset,
      password: formData.get('password'),
    },
    allow401: true,
  });
  clearAuthParams();
  state.authMode = 'login';
  setFlash('Contrasena actualizada. Ya puedes iniciar sesion.');
  render();
}

async function submitChat(form) {
  const formData = new FormData(form);
  const message = String(formData.get('message') || '').trim();
  if (!message) {
    return;
  }

  const selectedModel = String(formData.get('model') || state.chatModel || '').trim() || state.chatModel || 'auto';
  state.chatModel = selectedModel;
  state.busy = true;
  state.chatDraft = '';
  state.chatMessages.push({ role: 'user', content: message });
  render();
  scrollChatToBottom();

  try {
    const response = await apiRequest('/v1/chat/completions', {
      method: 'POST',
      body: {
        model: state.chatModel || 'auto',
        stream: false,
        messages: state.chatMessages
          .filter((item) => item.role === 'assistant' || item.role === 'user')
          .map((item) => ({ role: item.role, content: item.content })),
      },
    });
    const assistant = response.choices?.[0]?.message?.content || '[Sin contenido]';
    state.chatMessages.push({ role: 'assistant', content: assistant });
    await refreshDashboard();
    scrollChatToBottom();
  } catch (error) {
    state.chatMessages.push({ role: 'system', content: error.message || 'No se pudo completar el chat.' });
    render();
    scrollChatToBottom();
  } finally {
    state.busy = false;
    render();
    scrollChatToBottom();
  }
}

async function submitCreateApiKey(form) {
  const formData = new FormData(form);
  const payload = {
    name: formData.get('name'),
    projectId: formData.get('projectId') || null,
  };

  const rateLimit = formData.get('rateLimitPerMinute');
  if (rateLimit) {
    payload.rateLimitPerMinute = Number(rateLimit);
  }

  const result = await apiRequest('/api/api-keys', {
    method: 'POST',
    body: payload,
  });
  state.lastCreatedApiKey = result.rawApiKey;
  state.sharedValueKind = 'api-key';
  await refreshDashboard();
  setFlash('API key creada con exito.');
}

async function submitUpdateApiKey(form) {
  const formData = new FormData(form);
  const id = String(formData.get('id'));
  await apiRequest(`/api/api-keys/${id}`, {
    method: 'PATCH',
    body: {
      rateLimitPerMinute: Number(formData.get('rateLimitPerMinute')),
    },
  });
  await refreshDashboard();
  setFlash('Rate limit actualizado.');
}

async function submitSettings(form) {
  const formData = new FormData(form);
  await apiRequest('/api/settings', {
    method: 'PUT',
    body: {
      appName: formData.get('appName'),
      sessionTimeoutMinutes: Number(formData.get('sessionTimeoutMinutes')),
      defaultApiKeyRateLimit: Number(formData.get('defaultApiKeyRateLimit')),
      anonymousRateLimitPerMinute: Number(formData.get('anonymousRateLimitPerMinute')),
      allowedOrigins: formData.get('allowedOrigins'),
      defaultChatModel: formData.get('defaultChatModel'),
      enableUserKeyCreation: formData.get('enableUserKeyCreation') === 'true',
      openRouterFreeOnly: formData.get('openRouterFreeOnly') === 'true',
    },
  });
  await refreshDashboard();
  setFlash('Ajustes guardados.');
}

async function submitCreateUser(form) {
  const formData = new FormData(form);
  const result = await apiRequest('/api/users', {
    method: 'POST',
    body: {
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password'),
      projectId: formData.get('projectId') || null,
      monthlyRequestQuota: Number(formData.get('monthlyRequestQuota') || 0) || null,
    },
  });
  state.lastCreatedApiKey = result.rawApiKey;
  state.sharedValueKind = 'api-key';
  await refreshDashboard();
  setFlash('Usuario creado correctamente.');
}

async function submitUpdateUserProduct(form) {
  const formData = new FormData(form);
  const id = String(formData.get('id'));
  await apiRequest(`/api/users/${id}`, {
    method: 'PATCH',
    body: {
      monthlyRequestQuota: Number(formData.get('monthlyRequestQuota') || 0) || null,
    },
  });
  await refreshDashboard();
  setFlash('Cuotas del usuario actualizadas.');
}

async function submitCreateProject(form) {
  const formData = new FormData(form);
  await apiRequest('/api/projects', {
    method: 'POST',
    body: {
      name: formData.get('name'),
      description: formData.get('description'),
      modelAccessMode: formData.get('modelAccessMode') || 'all',
      allowedModelIds: getMultiValueFormEntries(formData, 'allowedModelIds'),
      requestQuotaMonthly: Number(formData.get('requestQuotaMonthly') || 0) || null,
    },
  });
  await refreshDashboard();
  setFlash('Proyecto creado correctamente.');
}

async function submitUpdateProject(form) {
  const formData = new FormData(form);
  const id = String(formData.get('id'));
  await apiRequest(`/api/projects/${id}`, {
    method: 'PATCH',
    body: {
      name: formData.get('name'),
      description: formData.get('description'),
      modelAccessMode: formData.get('modelAccessMode') || 'all',
      allowedModelIds: getMultiValueFormEntries(formData, 'allowedModelIds'),
      requestQuotaMonthly: Number(formData.get('requestQuotaMonthly') || 0) || null,
      isActive: formData.get('isActive') === 'true',
    },
  });
  await refreshDashboard();
  setFlash('Proyecto actualizado.');
}

async function submitCreateInvitation(form) {
  const formData = new FormData(form);
  const result = await apiRequest('/api/invitations', {
    method: 'POST',
    body: {
      email: formData.get('email') || null,
      projectId: formData.get('projectId') || null,
      role: formData.get('role') || 'member',
      expiresHours: Number(formData.get('expiresHours') || 72),
    },
  });
  state.lastCreatedApiKey = result.inviteUrl;
  state.sharedValueKind = 'invite-link';
  await refreshDashboard();
  setFlash('Invitacion creada. Copia el link temporal.');
}

async function submitCreateServiceKey(form) {
  const formData = new FormData(form);
  await apiRequest('/api/service-keys', {
    method: 'POST',
    body: {
      provider: formData.get('provider'),
      name: formData.get('name'),
      value: formData.get('value'),
      priority: Number(formData.get('priority') || 100),
    },
  });
  await refreshDashboard();
  setFlash('Service key agregada y pool recargado.');
}

async function submitUpdateServiceKey(form) {
  const formData = new FormData(form);
  const id = String(formData.get('id'));
  await apiRequest(`/api/service-keys/${id}`, {
    method: 'PATCH',
    body: {
      name: formData.get('name'),
      priority: Number(formData.get('priority')),
    },
  });
  await refreshDashboard();
  setFlash('Service key actualizada.');
}

async function submitCreateCustomProvider(form) {
  const formData = new FormData(form);
  const models = state.cpDraft.models.filter((m) => m.id.trim());
  if (models.length === 0) {
    throw new Error('Agrega al menos un modelo al proveedor.');
  }
  await apiRequest('/api/custom-providers', {
    method: 'POST',
    body: {
      name: String(formData.get('name') || '').trim(),
      protocol: String(formData.get('protocol') || state.cpDraft.protocol || 'openai').trim() || 'openai',
      baseUrl: String(formData.get('baseUrl') || '').trim(),
      apiKey: String(formData.get('apiKey') || '').trim() || null,
      models: models.map((m) => ({
        id: m.id.trim(),
        supportsTools: Boolean(m.supportsTools),
        supportsVision: Boolean(m.supportsVision),
        supportsImageGeneration: Boolean(m.supportsImageGeneration),
        supportsVideoGeneration: Boolean(m.supportsVideoGeneration),
      })),
    },
  });
  state.cpDraft = createEmptyCustomProviderDraft();
  state.cpDiscovery.draft = { loading: false, message: '' };
  await refreshDashboard();
  setFlash('Proveedor creado. Pool recargado.');
}

async function submitUpdateCustomProvider(form) {
  const formData = new FormData(form);
  const id = String(formData.get('id') || '');
  if (!id || !state.cpEditing) {
    throw new Error('No hay proveedor en edicion.');
  }
  const models = state.cpEditing.models.filter((m) => m.id.trim());
  if (models.length === 0) {
    throw new Error('El proveedor debe tener al menos un modelo.');
  }
  const newApiKey = String(state.cpEditing.newApiKey || '').trim();
  const payload = {
    name: String(state.cpEditing.name || '').trim() || undefined,
    protocol: String(state.cpEditing.protocol || 'openai').trim() || 'openai',
    baseUrl: String(state.cpEditing.baseUrl || '').trim() || undefined,
    models: models.map((m) => ({
      id: m.id.trim(),
      supportsTools: Boolean(m.supportsTools),
      supportsVision: Boolean(m.supportsVision),
      supportsImageGeneration: Boolean(m.supportsImageGeneration),
      supportsVideoGeneration: Boolean(m.supportsVideoGeneration),
    })),
  };
  if (newApiKey) {
    payload.apiKey = newApiKey;
  }
  await apiRequest(`/api/custom-providers/${id}`, {
    method: 'PATCH',
    body: payload,
  });
  state.cpEditing = null;
  state.cpDiscovery.edit = { loading: false, message: '' };
  await refreshDashboard();
  setFlash('Proveedor actualizado. Pool recargado.');
}

async function discoverCustomProviderModels(scope, trigger) {
  const discoveryState = state.cpDiscovery[scope];
  if (!discoveryState) {
    throw new Error('Scope invalido para descubrir modelos.');
  }

  discoveryState.loading = true;
  discoveryState.message = 'Consultando /models del proveedor...';
  render();

  try {
    let body;

    if (scope === 'edit') {
      if (!state.cpEditing) {
        throw new Error('No hay proveedor en edicion.');
      }

      body = {
        providerId: state.cpEditing.id,
        protocol: state.cpEditing.protocol || 'openai',
        baseUrl: state.cpEditing.baseUrl.trim(),
        apiKey: state.cpEditing.newApiKey.trim() || undefined,
      };
    } else {
      body = {
        protocol: state.cpDraft.protocol || 'openai',
        baseUrl: state.cpDraft.baseUrl.trim(),
        apiKey: state.cpDraft.apiKey.trim() || undefined,
      };
    }

    if (!body.baseUrl) {
      throw new Error('Primero define la Base URL del proveedor.');
    }

    const response = await apiRequest('/api/custom-providers/discover-models', {
      method: 'POST',
      body,
    });

    const discoveredModels = Array.isArray(response.models) ? response.models : [];
    const currentModels = scope === 'edit'
      ? state.cpEditing?.models
      : state.cpDraft.models;

    if (!currentModels) {
      throw new Error('No se pudo acceder a la lista actual de modelos.');
    }

    const mergedModels = mergeDiscoveredCustomProviderModels(currentModels, discoveredModels);
    if (scope === 'edit' && state.cpEditing) {
      state.cpEditing.models = mergedModels;
    } else {
      state.cpDraft.models = mergedModels;
    }

    discoveryState.message = `Se detectaron ${discoveredModels.length} modelo${discoveredModels.length === 1 ? '' : 's'} y se fusionaron con la lista actual.`;
    setFlash('Modelos descubiertos desde /models. Revisa la lista antes de guardar.');
  } catch (error) {
    const flash = buildFlashFromError(error, 'No se pudieron descubrir modelos del proveedor.');
    discoveryState.message = flash.message;
    throw error;
  } finally {
    discoveryState.loading = false;
    render();
  }
}

async function submitCreateModelAlias(form) {
  const formData = new FormData(form);
  const alias = String(formData.get('alias') || '').trim().toLowerCase();
  const targetModel = String(formData.get('targetModel') || '').trim();
  const category = String(formData.get('category') || '').trim() || 'chat';

  if (!alias) {
    throw new Error('El alias es requerido.');
  }
  if (!targetModel) {
    throw new Error('El modelo target es requerido.');
  }
  if (!/^[a-zA-Z0-9\-_\.]+$/.test(alias)) {
    throw new Error('El alias solo puede contener letras, numeros, guiones, puntos y guiones bajos.');
  }

  await apiRequest('/api/model-aliases', {
    method: 'POST',
    body: { alias, targetModel, category },
  });
  state.modelAliasCategory = category;
  await refreshDashboard();
  setFlash(`Alias "${alias}" → "${targetModel}" (${category}) creado.`);
  form.reset();
}

async function submitUpdateProviderLimit(form) {
  const formData = new FormData(form);
  const provider = normalizeProviderId(formData.get('provider'));
  await apiRequest(`/api/rate-limits/provider/${provider}`, {
    method: 'PUT',
    body: getLimitPayloadFromFormData(formData),
  });
  await refreshDashboard();
  setFlash(`Limite guardado para ${formatProviderLabel(provider)}.`);
}

async function submitUpdateModelLimit(form) {
  const formData = new FormData(form);
  const modelId = String(formData.get('modelId') || '').trim();
  if (!modelId) {
    throw new Error('Selecciona un modelo.');
  }
  await apiRequest('/api/rate-limits/model', {
    method: 'PUT',
    body: {
      modelId,
      ...getLimitPayloadFromFormData(formData),
    },
  });
  await refreshDashboard();
  setFlash(`Limite guardado para ${modelId}.`);
}

async function toggleUser(id, active) {
  await apiRequest(`/api/users/${id}`, {
    method: 'PATCH',
    body: { isActive: !active },
  });
  await refreshDashboard();
  setFlash('Estado del usuario actualizado.');
}

async function toggleApiKey(id, active) {
  await apiRequest(`/api/api-keys/${id}`, {
    method: 'PATCH',
    body: { isActive: !active },
  });
  await refreshDashboard();
  setFlash('Estado de API key actualizado.');
}

async function toggleServiceKey(id, active) {
  await apiRequest(`/api/service-keys/${id}`, {
    method: 'PATCH',
    body: { isActive: !active },
  });
  await refreshDashboard();
  setFlash('Estado de service key actualizado.');
}

async function deleteServiceKey(id) {
  await apiRequest(`/api/service-keys/${id}`, {
    method: 'DELETE',
  });
  await refreshDashboard();
  setFlash('Service key eliminada y pool recargado.');
}

async function requestManagedPasswordReset(userId) {
  await apiRequest(`/api/users/${userId}/password-reset`, {
    method: 'POST',
  });
  setFlash('Link temporal generado. Revisa la terminal del servidor para copiarlo.');
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const formType = form.dataset.form;
  if (!formType) {
    return;
  }

  event.preventDefault();
  clearFlash();

  try {
    if (formType === 'bootstrap') await submitBootstrap(form);
    if (formType === 'login') await submitLogin(form);
    if (formType === 'accept-invite') await submitAcceptInvite(form);
    if (formType === 'password-reset-request') await submitPasswordResetRequest(form);
    if (formType === 'password-reset-confirm') await submitPasswordResetConfirm(form);
    if (formType === 'chat') await submitChat(form);
    if (formType === 'create-api-key') await submitCreateApiKey(form);
    if (formType === 'update-api-key') await submitUpdateApiKey(form);
    if (formType === 'update-settings') await submitSettings(form);
    if (formType === 'create-user') await submitCreateUser(form);
    if (formType === 'update-user-product') await submitUpdateUserProduct(form);
    if (formType === 'create-project') await submitCreateProject(form);
    if (formType === 'update-project') await submitUpdateProject(form);
    if (formType === 'create-invitation') await submitCreateInvitation(form);
    if (formType === 'create-service-key') await submitCreateServiceKey(form);
    if (formType === 'update-service-key') await submitUpdateServiceKey(form);
    if (formType === 'update-provider-limit') await submitUpdateProviderLimit(form);
    if (formType === 'update-model-limit') await submitUpdateModelLimit(form);
    if (formType === 'create-custom-provider') await submitCreateCustomProvider(form);
    if (formType === 'edit-custom-provider') await submitUpdateCustomProvider(form);
    if (formType === 'create-model-alias') await submitCreateModelAlias(form);
  } catch (error) {
    const flash = buildFlashFromError(error, 'No se pudo completar la accion.');
    setFlash(flash.message, 'error', flash.details);
  }
}

async function handleClick(event) {
  const element = event.target;
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const target = element.closest('[data-action]');
  if (!target) {
    return;
  }

  const action = target.dataset.action;

  try {
    if (action === 'dismiss-flash') {
      state.flash = null;
      state.lastCreatedApiKey = null;
      render();
      return;
    }

    if (action === 'copy-last-api-key') {
      if (state.lastCreatedApiKey) {
        await navigator.clipboard.writeText(state.lastCreatedApiKey);
        setFlash(
          state.sharedValueKind === 'invite-link'
            ? 'Link de invitacion copiado al portapapeles.'
            : state.sharedValueKind === 'reset-link'
              ? 'Link de recuperacion copiado al portapapeles.'
              : 'API key copiada al portapapeles.',
        );
      }
      return;
    }

    if (action === 'switch-auth-mode') {
      state.authMode = target.dataset.mode || 'login';
      if (state.authMode === 'login') {
        clearAuthParams();
        state.invitePreview = null;
      }
      render();
      return;
    }

    if (action === 'switch-view') {
      state.view = target.dataset.view || 'overview';
      if (state.view !== 'settings') {
        state.settingsGuide = null;
      } else {
        ensureValidSettingsPage();
      }
      render();
      return;
    }

    if (action === 'switch-metrics-tab') {
      state.metricsTab = target.dataset.tab || 'overview';
      render();
      return;
    }

    if (action === 'switch-settings-page') {
      state.settingsPage = target.dataset.page || 'general';
      state.settingsGuide = null;
      ensureValidSettingsPage();
      render();
      return;
    }

    if (action === 'open-settings-guide') {
      state.settingsGuide = target.dataset.page || state.settingsPage;
      render();
      return;
    }

    if (action === 'close-settings-guide') {
      if (target.classList.contains('modal-card')) {
        return;
      }
      state.settingsGuide = null;
      render();
      return;
    }

    if (action === 'pick-playground') {
      state.currentPlayground = target.dataset.playground || 'chat';
      state.currentPlaygroundTab = 'curl';
      state.playgroundResponse = null;
      getPlaygroundDraft(state.currentPlayground);
      render();
      return;
    }

    if (action === 'pick-playground-tab') {
      state.currentPlaygroundTab = target.dataset.tab || 'curl';
      render();
      return;
    }

    if (action === 'copy-playground-snippet') {
      const examples = getPlaygroundExamples();
      const active = examples[state.currentPlayground];
      const snippet = state.currentPlaygroundTab === 'javascript' ? active.javascript : active.curl;
      await navigator.clipboard.writeText(snippet);
      setFlash('Snippet del playground copiado.');
      return;
    }

    if (action === 'run-playground') {
      try {
        await executePlaygroundRequest();
        setFlash('Peticion ejecutada desde el playground.');
      } catch (error) {
        const details = error?.playgroundDetails || null;
        const message = details
          ? `${formatPlaygroundFailure(details)}. Revisa "Live response" y la consola del navegador.`
          : (error.message || 'No se pudo ejecutar la peticion desde el playground.');
        setFlash(message, 'error');
      }
      return;
    }

    if (action === 'reset-playground-body') {
      const example = getPlaygroundExample();
      setPlaygroundDraft(state.currentPlayground, example.body);
      state.playgroundResponse = null;
      render();
      return;
    }

    if (action === 'logout') {
      await apiRequest('/api/auth/logout', { method: 'POST', allow401: true });
      state.mode = state.needsSetup ? 'bootstrap' : 'login';
      state.dashboard = null;
      state.me = null;
      state.lastCreatedApiKey = null;
      render();
      return;
    }

    if (action === 'refresh-dashboard') {
      await refreshDashboard();
      setFlash('Dashboard actualizado.');
      return;
    }

    if (action === 'clear-chat') {
      state.chatMessages = [{
        role: 'assistant',
        content: 'Conversacion reiniciada. Lista para una nueva prueba.',
      }];
      render();
      return;
    }

    if (action === 'toggle-user') {
      await toggleUser(target.dataset.id, target.dataset.active === 'true');
      return;
    }

    if (action === 'toggle-api-key') {
      await toggleApiKey(target.dataset.id, target.dataset.active === 'true');
      return;
    }

    if (action === 'toggle-service-key') {
      await toggleServiceKey(target.dataset.id, target.dataset.active === 'true');
      return;
    }

    if (action === 'delete-service-key') {
      const id = target.dataset.id;
      if (!confirm('¿Eliminar esta service key guardada del panel?')) return;
      await deleteServiceKey(id);
      return;
    }

    if (action === 'request-user-reset') {
      await requestManagedPasswordReset(target.dataset.id);
      return;
    }

    if (action === 'reset-router') {
      await apiRequest('/api/admin/reset', { method: 'POST' });
      await refreshDashboard();
      setFlash('Estados del router reiniciados.');
    }

    if (action === 'cp-discover-models') {
      await discoverCustomProviderModels(target.dataset.scope || 'draft', target);
      return;
    }

    if (action === 'cp-add-model') {
      const scope = target.dataset.scope;
      const models = scope === 'edit' ? state.cpEditing?.models : state.cpDraft.models;
      if (models) {
        models.push(createEmptyCustomProviderModel());
        render();
      }
      return;
    }

    if (action === 'cp-remove-model') {
      const scope = target.dataset.scope;
      const index = Number(target.dataset.index);
      const models = scope === 'edit' ? state.cpEditing?.models : state.cpDraft.models;
      if (models) {
        models.splice(index, 1);
        render();
      }
      return;
    }

    if (action === 'edit-custom-provider') {
      const id = target.dataset.id;
      const providers = state.dashboard.customProviders || [];
      const provider = providers.find((p) => p.id === id);
      if (provider) {
        state.cpDiscovery.edit = { loading: false, message: '' };
        state.cpEditing = {
          id: provider.id,
          name: provider.name,
          slug: provider.slug,
          protocol: provider.protocol || 'openai',
          baseUrl: provider.baseUrl,
          hasApiKey: provider.hasApiKey,
          newApiKey: '',
          models: provider.models.map((m) => ({ ...m })),
        };
        render();
      }
      return;
    }

    if (action === 'cancel-edit-custom-provider') {
      state.cpEditing = null;
      state.cpDiscovery.edit = { loading: false, message: '' };
      render();
      return;
    }

    if (action === 'cp-clear-api-key') {
      if (!state.cpEditing) return;
      await apiRequest(`/api/custom-providers/${state.cpEditing.id}`, {
        method: 'PATCH',
        body: { apiKey: null },
      });
      state.cpEditing.hasApiKey = false;
      state.cpEditing.newApiKey = '';
      await refreshDashboard();
      setFlash('API key eliminada del proveedor.');
      return;
    }

    if (action === 'toggle-custom-provider') {
      const id = target.dataset.id;
      const active = target.dataset.active === 'true';
      await apiRequest(`/api/custom-providers/${id}`, {
        method: 'PATCH',
        body: { isActive: !active },
      });
      await refreshDashboard();
      setFlash(`Proveedor ${active ? 'desactivado' : 'activado'}.`);
      return;
    }

    if (action === 'delete-custom-provider') {
      const id = target.dataset.id;
      if (!confirm('¿Eliminar este proveedor y quitar sus modelos del pool?')) return;
      await apiRequest(`/api/custom-providers/${id}`, { method: 'DELETE' });
      if (state.cpEditing?.id === id) state.cpEditing = null;
      state.cpDiscovery.edit = { loading: false, message: '' };
      await refreshDashboard();
      setFlash('Proveedor eliminado del pool.');
      return;
    }

    if (action === 'set-model-tier') {
      const modelId = target.dataset.model;
      const tier = Number(target.dataset.tier);
      await apiRequest('/api/model-tiers', {
        method: 'PUT',
        body: { modelId, tier },
      });
      await refreshDashboard();
      setFlash(`Tier ${tier} aplicado a ${modelId}. Pool recargado.`);
      return;
    }

    if (action === 'reset-model-tier') {
      const modelId = target.dataset.model;
      await apiRequest(`/api/model-tiers/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
      await refreshDashboard();
      setFlash(`Tier de ${modelId} restaurado a automatico.`);
      return;
    }

    if (action === 'regenerate-api-key') {
      const id = target.dataset.id;
      const name = target.dataset.name || 'esta API key';
      if (!confirm(`¿Regenerar "${name}"? La key actual dejará de funcionar de inmediato.`)) return;
      try {
        const result = await apiRequest(`/api/api-keys/${id}/regenerate`, { method: 'POST' });
        state.lastCreatedApiKey = result.rawApiKey ?? null;
        await refreshDashboard();
        // Navigate to api-keys tab so the banner is visible
        state.view = 'settings';
        state.settingsPage = 'api-keys';
        render();
        setFlash('Key regenerada. Cópiala ahora — no se volverá a mostrar.');
      } catch (err) {
        setFlash(err?.message ?? 'No se pudo regenerar la key.', 'error');
      }
      return;
    }

    if (action === 'dismiss-revealed-key') {
      state.lastCreatedApiKey = null;
      render();
      return;
    }

    if (action === 'copy-revealed-key') {
      const key = state.lastCreatedApiKey || '';
      if (!key) return;
      try {
        await navigator.clipboard.writeText(key);
        state.qsCopied = 'revealedkey';
        render();
        setTimeout(() => {
          if (state.qsCopied === 'revealedkey') {
            state.qsCopied = null;
            render();
          }
        }, 2000);
      } catch {
        setFlash('No se pudo copiar al portapapeles.', 'error');
      }
      return;
    }

    if (action === 'qs-pick-agent') {
      state.qsAgent = target.dataset.agent || 'opencode';
      state.qsSelectedModels = [];
      state.qsCopied = null;
      render();
      return;
    }

    if (action === 'qs-copy') {
      const text = target.dataset.qsText || '';
      const copyId = target.dataset.qsId || text;
      try {
        await navigator.clipboard.writeText(text);
        state.qsCopied = copyId;
        render();
        // Reset after 2 seconds
        setTimeout(() => {
          if (state.qsCopied === copyId) {
            state.qsCopied = null;
            render();
          }
        }, 2000);
      } catch (err) {
        setFlash('No se pudo copiar al portapapeles.', 'error');
      }
      return;
    }

    if (action === 'qs-select-all') {
      state.qsSelectedModels = [];  // empty = all selected
      state.qsCopied = null;
      render();
      return;
    }

    if (action === 'qs-deselect-all') {
      // Keep at least one selected to avoid broken config output
      const allIds = getQuickStartModels().map((m) => m.id);
      state.qsSelectedModels = allIds.length > 0 ? [allIds[0]] : [];
      state.qsCopied = null;
      render();
      return;
    }

    if (action === 'qs-provider-filter') {
      state.qsProviderFilter = target.dataset.provider || '';
      // Do NOT reset selection — preserve cross-provider picks
      render();
      return;
    }

    // Legacy alias for backwards compat
    if (action === 'qs-clear-models') {
      state.qsSelectedModels = [];
      state.qsCopied = null;
      render();
      return;
    }

    if (action === 'delete-model-alias') {
      const alias = target.dataset.alias;
      const category = target.dataset.category || 'chat';
      if (!confirm(`¿Eliminar el alias "${alias}"?`)) return;
      await apiRequest(`/api/model-aliases/${encodeURIComponent(alias)}?category=${encodeURIComponent(category)}`, { method: 'DELETE' });
      await refreshDashboard();
      setFlash(`Alias "${alias}" eliminado.`);
      return;
    }
  } catch (error) {
    const flash = buildFlashFromError(error, 'No se pudo completar la accion.');
    setFlash(flash.message, 'error', flash.details);
  }
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  if (!action) {
    return;
  }

  if (action === 'playground-body' && target instanceof HTMLTextAreaElement) {
    setPlaygroundDraft(state.currentPlayground, target.value);
    if (event.type === 'change') {
      render();
    }
    return;
  }

  if (action === 'playground-model' && target instanceof HTMLSelectElement) {
    setPlaygroundModelValue(target.value, state.currentPlayground);
    state.playgroundResponse = null;
    render();
    return;
  }

  if (action === 'model-alias-category' && target instanceof HTMLSelectElement) {
    state.modelAliasCategory = target.value || 'chat';
    render();
    return;
  }

  if (action === 'playground-api-key' && target instanceof HTMLInputElement) {
    state.playgroundApiKey = target.value;
    return;
  }

  if (action === 'playground-audio-language' && target instanceof HTMLInputElement) {
    state.playgroundAudioLanguage = target.value;
    return;
  }

  if (action === 'playground-audio-provider' && target instanceof HTMLSelectElement) {
    state.playgroundAudioProvider = target.value;
    render();
    return;
  }

  if (action === 'playground-auth-mode' && target instanceof HTMLSelectElement) {
    state.playgroundAuthMode = target.value;
    render();
    return;
  }

  if (action === 'chat-model' && target instanceof HTMLSelectElement) {
    state.chatModel = target.value || 'auto';
    return;
  }

  if (action === 'chat-draft' && target instanceof HTMLTextAreaElement) {
    state.chatDraft = target.value;
    return;
  }

  if (action === 'cp-draft-name' && target instanceof HTMLInputElement) {
    state.cpDraft.name = target.value;
    return;
  }

  if (action === 'cp-draft-baseUrl' && target instanceof HTMLInputElement) {
    state.cpDraft.baseUrl = target.value;
    return;
  }

  if (action === 'cp-draft-protocol' && target instanceof HTMLSelectElement) {
    state.cpDraft.protocol = target.value || 'openai';
    render();
    return;
  }

  if (action === 'cp-draft-apiKey' && target instanceof HTMLInputElement) {
    state.cpDraft.apiKey = target.value;
    return;
  }

  if (action === 'cp-edit-name' && target instanceof HTMLInputElement && state.cpEditing) {
    state.cpEditing.name = target.value;
    return;
  }

  if (action === 'cp-edit-baseUrl' && target instanceof HTMLInputElement && state.cpEditing) {
    state.cpEditing.baseUrl = target.value;
    return;
  }

  if (action === 'cp-edit-protocol' && target instanceof HTMLSelectElement && state.cpEditing) {
    state.cpEditing.protocol = target.value || 'openai';
    render();
    return;
  }

  if (action === 'cp-edit-apiKey' && target instanceof HTMLInputElement && state.cpEditing) {
    state.cpEditing.newApiKey = target.value;
    return;
  }

  if (action === 'cp-model-field') {
    const scope = target.dataset.scope;
    const index = Number(target.dataset.index);
    const field = target.dataset.field;
    const models = scope === 'edit' ? state.cpEditing?.models : state.cpDraft.models;
    if (!models || !models[index] || !field) return;
    if (field === 'id' && target instanceof HTMLInputElement) {
      models[index].id = target.value;
    }
    if (field === 'supportsTools' && target instanceof HTMLInputElement) {
      models[index].supportsTools = target.checked;
    }
    if (field === 'supportsVision' && target instanceof HTMLInputElement) {
      models[index].supportsVision = target.checked;
    }
    if (field === 'supportsImageGeneration' && target instanceof HTMLInputElement) {
      models[index].supportsImageGeneration = target.checked;
    }
    if (field === 'supportsVideoGeneration' && target instanceof HTMLInputElement) {
      models[index].supportsVideoGeneration = target.checked;
    }
    return;
  }

  if (action === 'qs-toggle-model' && target instanceof HTMLInputElement) {
    const modelId = target.dataset.model || '';
    if (!modelId) return;
    const allModelObjects = getQuickStartModels();
    const allIds = allModelObjects.map((m) => m.id);
    // Preserve scroll before re-render
    const listEl = document.getElementById('qs-model-list-scroll');
    const savedListScroll = listEl ? listEl.scrollTop : 0;
    const contentEl = document.querySelector('.content');
    const savedContentScroll = contentEl ? contentEl.scrollTop : 0;
    // Update selection
    if (state.qsSelectedModels.length === 0) {
      // "all" => deselect means keep the rest explicit
      state.qsSelectedModels = allIds.filter((m) => m !== modelId);
    } else if (target.checked) {
      if (!state.qsSelectedModels.includes(modelId)) {
        state.qsSelectedModels = [...state.qsSelectedModels, modelId];
      }
      // If all are now selected, go back to "all" (empty)
      if (state.qsSelectedModels.length === allIds.length) {
        state.qsSelectedModels = [];
      }
    } else {
      state.qsSelectedModels = state.qsSelectedModels.filter((m) => m !== modelId);
    }
    state.qsCopied = null;
    render();
    // Restore scroll after render
    requestAnimationFrame(() => {
      const newList = document.getElementById('qs-model-list-scroll');
      if (newList) newList.scrollTop = savedListScroll;
      const newContent = document.querySelector('.content');
      if (newContent) newContent.scrollTop = savedContentScroll;
    });
    return;
  }

  if (action === 'qs-pick-single-model' && target instanceof HTMLInputElement) {
    const modelId = target.dataset.model || '';
    if (!modelId) return;
    const listEl = document.getElementById('qs-model-list-scroll');
    const savedListScroll = listEl ? listEl.scrollTop : 0;
    const contentEl = document.querySelector('.content');
    const savedContentScroll = contentEl ? contentEl.scrollTop : 0;
    state.qsSelectedModels = [modelId];
    state.qsCopied = null;
    render();
    requestAnimationFrame(() => {
      const newList = document.getElementById('qs-model-list-scroll');
      if (newList) newList.scrollTop = savedListScroll;
      const newContent = document.querySelector('.content');
      if (newContent) newContent.scrollTop = savedContentScroll;
    });
    return;
  }
}

async function handleKeydown(event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (event.key !== 'Enter' || !event.ctrlKey) {
    return;
  }

  const form = target.closest('form[data-form="chat"]');
  if (!(form instanceof HTMLFormElement) || state.busy) {
    return;
  }

  event.preventDefault();
  clearFlash();

  try {
    await submitChat(form);
  } catch (error) {
    const flash = buildFlashFromError(error, 'No se pudo completar la accion.');
    setFlash(flash.message, 'error', flash.details);
  }
}

app.addEventListener('submit', handleSubmit);
app.addEventListener('click', handleClick);
app.addEventListener('input', handleInput);
app.addEventListener('change', handleInput);
app.addEventListener('keydown', handleKeydown);

render();
bootstrapFlow().catch((error) => {
  const flash = buildFlashFromError(error, 'No se pudo iniciar el panel.');
  setFlash(flash.message, 'error', flash.details);
});
