import mongoose, { Schema, Document, Types } from "mongoose";

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
