import { db } from '../db';

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
