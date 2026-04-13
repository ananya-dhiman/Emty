import mongoose, { Schema, Document, Types } from "mongoose";
import { getDb } from "../db/sqlite";

/**
 * SyncCheckpoint Model
 * Tracks incremental sync state per Gmail account
 * - Stores historyId for Gmail History API deltas
 * - Stores lastSyncTimestamp as fallback for timestamp-based queries
 * - Manages sync state (idle/syncing) with atomic locking
 */

export type SyncState = "idle" | "syncing" | "error";
export type SyncProgressStage =
  | "initializing"
  | "auth_setup"
  | "fetch_candidates"
  | "metadata_filtering"
  | "scoring_emails"
  | "processing_emails"
  | "finalizing"
  | "completed"
  | "error";

export interface ISyncCheckpoint extends Document {
  accountId: Types.ObjectId; // Reference to GmailAccount
  lastHistoryId?: string; // Gmail's historyId for delta fetching (can be null after fallback)
  lastSyncTimestamp?: Date; // Fallback: timestamp of last sync
  syncState: SyncState; // "idle" | "syncing" | "error"
  syncStartedAt?: Date; // When the current sync started (for timeout recovery)
  lastSyncError?: string; // Last error message (if syncState === "error")
  processedCount: number; // Total emails processed in last sync
  succeededCount: number; // Emails successfully processed
  failedCount: number; // Emails that failed processing
  progressPercent: number;
  progressStage: SyncProgressStage;
  progressMessage?: string;
  totalCandidates: number;
  processedCandidates: number;
  lastProgressAt?: Date;
  aiFallbackCount?: number;
  aiFallbackMessage?: string;
  aiFallbackAt?: Date;
  quotaDateUtc?: string;
  dailyQuotaLimit?: number;
  dailyQuotaUsed?: number;
  dailyQuotaRemaining?: number;
  createdAt: Date;
  updatedAt: Date;
}

const SyncCheckpointSchema = new Schema<ISyncCheckpoint>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "GmailAccount",
      required: true,
      unique: true,
    },
    lastHistoryId: { type: String, default: null },
    lastSyncTimestamp: { type: Date, default: null },
    syncState: {
      type: String,
      enum: ["idle", "syncing", "error"],
      default: "idle",
    },
    syncStartedAt: { type: Date, default: null },
    lastSyncError: { type: String, default: null },
    processedCount: { type: Number, default: 0 },
    succeededCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    progressStage: {
      type: String,
      enum: [
        "initializing",
        "auth_setup",
        "fetch_candidates",
        "metadata_filtering",
        "scoring_emails",
        "processing_emails",
        "finalizing",
        "completed",
        "error",
      ],
      default: "initializing",
    },
    progressMessage: { type: String, default: null },
    totalCandidates: { type: Number, default: 0 },
    processedCandidates: { type: Number, default: 0 },
    lastProgressAt: { type: Date, default: null },
    aiFallbackCount: { type: Number, default: 0 },
    aiFallbackMessage: { type: String, default: null },
    aiFallbackAt: { type: Date, default: null },
    quotaDateUtc: { type: String, default: null },
    dailyQuotaLimit: { type: Number, default: 0 },
    dailyQuotaUsed: { type: Number, default: 0 },
    dailyQuotaRemaining: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Index for fast lookups
SyncCheckpointSchema.index({ accountId: 1 });
// Index to find stale locks (older than 10 minutes)
SyncCheckpointSchema.index({
  syncState: 1,
  syncStartedAt: 1,
});

export const SyncCheckpointModel = mongoose.model<ISyncCheckpoint>(
  "SyncCheckpoint",
  SyncCheckpointSchema
);

const toMillis = (val: any): number | null => {
  if (val === null || val === undefined) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

const toCheckpointShape = (row: any) => ({
  id: row.id,
  accountId: row.account_id,
  lastHistoryId: row.last_history_id || undefined,
  lastSyncTimestamp:
    typeof row.last_sync_timestamp === "number" ? new Date(row.last_sync_timestamp) : undefined,
  syncState: row.sync_state as SyncState,
  syncStartedAt: typeof row.sync_started_at === "number" ? new Date(row.sync_started_at) : undefined,
  lastSyncError: row.last_sync_error || undefined,
  processedCount: row.processed_count || 0,
  succeededCount: row.succeeded_count || 0,
  failedCount: row.failed_count || 0,
  progressPercent: row.progress_percent || 0,
  progressStage: row.progress_stage as SyncProgressStage,
  progressMessage: row.progress_message || undefined,
  totalCandidates: row.total_candidates || 0,
  processedCandidates: row.processed_candidates || 0,
  lastProgressAt: typeof row.last_progress_at === "number" ? new Date(row.last_progress_at) : undefined,
});

const mapDataKeys = (data: Record<string, any>): { keys: string[]; values: any[] } => {
  const pairs: Array<[string, any]> = [];
  const keyMap: Record<string, string> = {
    accountId: "account_id",
    lastHistoryId: "last_history_id",
    lastSyncTimestamp: "last_sync_timestamp",
    syncState: "sync_state",
    syncStartedAt: "sync_started_at",
    lastSyncError: "last_sync_error",
    processedCount: "processed_count",
    succeededCount: "succeeded_count",
    failedCount: "failed_count",
    progressPercent: "progress_percent",
    progressStage: "progress_stage",
    progressMessage: "progress_message",
    totalCandidates: "total_candidates",
    processedCandidates: "processed_candidates",
    lastProgressAt: "last_progress_at",
  };

  for (const [k, v] of Object.entries(data || {})) {
    const mapped = keyMap[k] || k;
    const value = mapped.endsWith("_at") || mapped.includes("timestamp") ? toMillis(v) : v;
    pairs.push([mapped, value]);
  }
  return { keys: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]) };
};

export const SyncCheckpoint = {
  async findUnique(args: { where: { accountId: string } }) {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM sync_checkpoints WHERE account_id = ? LIMIT 1")
      .get(String(args.where.accountId));
    return row ? toCheckpointShape(row) : null;
  },
  async create(args: { data: Record<string, any> }) {
    const db = getDb();
    const id = new Types.ObjectId().toString();
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO sync_checkpoints (id, account_id, sync_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(id, String(args.data.accountId), args.data.syncState || "idle", now, now);
    const row = db.prepare("SELECT * FROM sync_checkpoints WHERE id = ?").get(id);
    return row ? toCheckpointShape(row) : null;
  },
  async update(
    argsOrWhere: { where: { accountId: string }; data?: Record<string, any> } | { where: { accountId: string } },
    maybeData?: Record<string, any>
  ) {
    const args: { where: { accountId: string }; data: Record<string, any> } =
      maybeData !== undefined
        ? { where: (argsOrWhere as any).where, data: maybeData }
        : { where: (argsOrWhere as any).where, data: (argsOrWhere as any).data || {} };
    const db = getDb();
    const data = args.data || {};
    const { keys, values } = mapDataKeys(data);
    if (!keys.length) return this.findUnique({ where: { accountId: args.where.accountId } });
    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE sync_checkpoints SET ${setClause}, updated_at = ? WHERE account_id = ?`).run(
      ...values,
      Date.now(),
      String(args.where.accountId)
    );
    return this.findUnique({ where: { accountId: args.where.accountId } });
  },
  async updateMany(
    argsOrWhere: { where: Record<string, any>; data?: Record<string, any> } | { where: Record<string, any> },
    maybeData?: Record<string, any>
  ) {
    const args: { where: Record<string, any>; data: Record<string, any> } =
      maybeData !== undefined
        ? { where: (argsOrWhere as any).where, data: maybeData }
        : { where: (argsOrWhere as any).where, data: (argsOrWhere as any).data || {} };
    const db = getDb();
    const where = args.where || {};
    const filters: string[] = [];
    const whereVals: any[] = [];
    if (where.accountId !== undefined) {
      filters.push("account_id = ?");
      whereVals.push(String(where.accountId));
    }
    if (where.syncState !== undefined) {
      filters.push("sync_state = ?");
      whereVals.push(where.syncState);
    }
    if (where.syncStartedAt && typeof where.syncStartedAt === "object" && where.syncStartedAt.lt) {
      filters.push("sync_started_at < ?");
      whereVals.push(toMillis(where.syncStartedAt.lt));
    }
    const whereClause = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const before = db.prepare(`SELECT COUNT(*) as c FROM sync_checkpoints${whereClause}`).get(...whereVals) as any;
    const { keys, values } = mapDataKeys(args.data || {});
    if (!keys.length) return { count: before.c || 0 };
    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE sync_checkpoints SET ${setClause}, updated_at = ?${whereClause}`).run(
      ...values,
      Date.now(),
      ...whereVals
    );
    return { count: before.c || 0 };
  },
};
