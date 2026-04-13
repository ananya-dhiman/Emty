import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface SyncCheckpointRow {
  id: string;
  account_id: string;
  last_history_id: string | null;
  last_sync_timestamp: number | null;
  sync_state: string;
  sync_started_at: number | null;
  last_sync_error: string | null;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  progress_percent: number;
  progress_stage: string;
  progress_message: string | null;
  total_candidates: number;
  processed_candidates: number;
  last_progress_at: number | null;
  created_at: number;
  updated_at: number;
}

export function findOrCreate(accountId: string): SyncCheckpointRow {
  const db = getDb();
  
  // Try to find existing
  const existing = db.prepare(`
    SELECT * FROM sync_checkpoints WHERE account_id = ? LIMIT 1
  `).get(accountId) as SyncCheckpointRow | undefined;

  if (existing) {
    return existing;
  }

  // Create new
  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO sync_checkpoints (
      id, account_id, sync_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(id, accountId, "idle", now, now);

  return db.prepare(`
    SELECT * FROM sync_checkpoints WHERE id = ?
  `).get(id) as SyncCheckpointRow;
}

export function updateSyncState(accountId: string, syncState: string, syncStartedAt?: number): void {
  const db = getDb();
  const now = Date.now();
  
  const stmt = db.prepare(`
    UPDATE sync_checkpoints
    SET sync_state = ?, sync_started_at = ?, updated_at = ?
    WHERE account_id = ?
  `);
  stmt.run(syncState, syncStartedAt || now, now, accountId);
}

export function updateProgress(accountId: string, progressData: {
  progress_percent?: number;
  progress_stage?: string;
  progress_message?: string | null;
  processed_candidates?: number;
  total_candidates?: number;
  last_progress_at?: number;
}): void {
  const db = getDb();
  const updates: string[] = [];
  const values: any[] = [];

  if (progressData.progress_percent !== undefined) {
    updates.push("progress_percent = ?");
    values.push(progressData.progress_percent);
  }
  if (progressData.progress_stage !== undefined) {
    updates.push("progress_stage = ?");
    values.push(progressData.progress_stage);
  }
  if (progressData.progress_message !== undefined) {
    updates.push("progress_message = ?");
    values.push(progressData.progress_message);
  }
  if (progressData.processed_candidates !== undefined) {
    updates.push("processed_candidates = ?");
    values.push(progressData.processed_candidates);
  }
  if (progressData.total_candidates !== undefined) {
    updates.push("total_candidates = ?");
    values.push(progressData.total_candidates);
  }
  if (progressData.last_progress_at !== undefined) {
    updates.push("last_progress_at = ?");
    values.push(progressData.last_progress_at);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = ?");
  values.push(Date.now());
  values.push(accountId);

  const stmt = db.prepare(`
    UPDATE sync_checkpoints
    SET ${updates.join(", ")}
    WHERE account_id = ?
  `);
  stmt.run(...values);
}

export function markSyncError(accountId: string, errorMessage: string): void {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE sync_checkpoints
    SET sync_state = ?, last_sync_error = ?, updated_at = ?
    WHERE account_id = ?
  `);
  stmt.run("error", errorMessage, now, accountId);
}

export function recordSync(accountId: string, succeededCount: number, failedCount: number): void {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE sync_checkpoints
    SET succeeded_count = ?, failed_count = ?, processed_count = ?, 
        sync_state = 'idle', last_sync_timestamp = ?, updated_at = ?
    WHERE account_id = ?
  `);
  stmt.run(succeededCount, failedCount, succeededCount + failedCount, now, now, accountId);
}

export function getByAccountId(accountId: string): SyncCheckpointRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM sync_checkpoints WHERE account_id = ? LIMIT 1
  `);
  return (stmt.get(accountId) as SyncCheckpointRow | undefined) || null;
}
