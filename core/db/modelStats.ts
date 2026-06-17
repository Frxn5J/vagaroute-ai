import { db } from '../db';

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
