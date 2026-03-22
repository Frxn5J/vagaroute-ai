import { Database } from "bun:sqlite";
import path from "path";

// Initialize SQLite Database in the root directory
const dbPath = path.join(process.cwd(), "router.sqlite");
const db = new Database(dbPath, { create: true });

// Enable Write-Ahead Logging for better concurrent performance
db.exec("PRAGMA journal_mode = WAL;");

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS model_stats (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    rate_limited_until INTEGER DEFAULT 0,
    requests_served INTEGER DEFAULT 0
  );
`);

/**
 * Syncs the in-memory detected models with the database.
 * Does not overwrite existing rate limits for currently active models.
 */
export function syncModelsToDb(models: { id: string, provider: string }[]) {
    const insertOrIgnore = db.prepare(`
        INSERT INTO model_stats (id, provider, status, rate_limited_until, requests_served) 
        VALUES ($id, $provider, 'active', 0, 0)
        ON CONFLICT(id) DO NOTHING;
    `);

    db.transaction(() => {
        for (const model of models) {
            insertOrIgnore.run({ $id: model.id, $provider: model.provider });
        }
    })();
}

/**
 * Retrieves all model statuses from the database.
 */
export function getAllModelStats() {
    return db.query(`SELECT * FROM model_stats`).all() as {
        id: string;
        provider: string;
        status: string;
        rate_limited_until: number;
        requests_served: number;
    }[];
}

/**
 * Marks a model as rate-limited until a specific timestamp.
 */
export function setModelRateLimited(id: string, untilMs: number) {
    db.query(`
        UPDATE model_stats 
        SET status = 'cooldown', rate_limited_until = $until 
        WHERE id = $id
    `).run({ $until: untilMs, $id: id });
}

/**
 * Clears the rate limit for a specific model.
 */
export function clearModelRateLimit(id: string) {
    db.query(`
        UPDATE model_stats 
        SET status = 'active', rate_limited_until = 0 
        WHERE id = $id
    `).run({ $id: id });
}

/**
 * Auto-cleans expired rate limits dynamically returning the fresh valid models.
 */
export function getAvailableModels() {
    const now = Date.now();
    // Auto-reset models whose rate limit has expired
    db.query(`
        UPDATE model_stats 
        SET status = 'active', rate_limited_until = 0 
        WHERE status = 'cooldown' AND rate_limited_until <= $now
    `).run({ $now: now });

    // Return active models
    return db.query(`SELECT * FROM model_stats WHERE status = 'active'`).all() as {
        id: string;
        provider: string;
        status: string;
        rate_limited_until: number;
        requests_served: number;
    }[];
}

/**
 * Increments the successfully served requests counter for analytics.
 */
export function incrementModelUsage(id: string) {
    db.query(`
        UPDATE model_stats 
        SET requests_served = requests_served + 1 
        WHERE id = $id
    `).run({ $id: id });
}
