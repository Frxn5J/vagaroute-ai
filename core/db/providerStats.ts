import { db } from '../db';
import { normalizeProviderId } from '../usageLimits';

interface ProviderStatRow {
  id: string;
  status: string;
  cooldown_until: number;
  last_reason: string | null;
}

export interface ProviderStatRecord {
  id: string;
  status: string;
  cooldownUntil: number;
  lastReason: string | null;
}

function toProviderStatRecord(row: ProviderStatRow): ProviderStatRecord {
  return {
    id: row.id,
    status: row.status,
    cooldownUntil: row.cooldown_until,
    lastReason: row.last_reason,
  };
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
