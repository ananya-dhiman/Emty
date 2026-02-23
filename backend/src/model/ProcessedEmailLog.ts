import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * ProcessedEmailLog Model
 * Deduplication registry: tracks which emails have been processed
 * - Stores messageId → insightId mapping
 * - Stores stateHash to detect metadata changes (labels, attachments, etc.)
 * - Tracks retry count for failed emails
 * - Prevents re-processing same email across syncs
 */

export interface IProcessedEmailLog extends Document {
  accountId: Types.ObjectId; // Reference to GmailAccount
  messageId: string; // Gmail's unique message ID
  insightId: Types.ObjectId; // Reference to Insight (the extracted insight for this email)
  threadId: string; // Gmail's thread ID
  previousStateHash: string; // SHA256 hash of metadata (labels, hasAttachments, from)
  previousLabels?: string[]; // Optional: previous labels for debugging
  internalDate: Date; // Gmail's email date
  processedAt: Date; // When this email was first processed
  retryCount: number; // Number of failed attempts (for retry strategy)
  lastRetryAt?: Date; // Timestamp of last retry attempt
  lastErrorMessage?: string; // Last error encountered during processing
  createdAt: Date;
  updatedAt: Date;
}

const ProcessedEmailLogSchema = new Schema<IProcessedEmailLog>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "GmailAccount",
      required: true,
    },
    messageId: { type: String, required: true },
    insightId: {
      type: Schema.Types.ObjectId,
      ref: "Insight",
      required: true,
    },
    threadId: { type: String, required: true },
    previousStateHash: { type: String, required: true },
    previousLabels: { type: [String], default: [] },
    internalDate: { type: Date, required: true },
    processedAt: { type: Date, default: () => new Date() },
    retryCount: { type: Number, default: 0 },
    lastRetryAt: { type: Date, default: null },
    lastErrorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

// Compound index: fast lookup by (accountId, messageId)
ProcessedEmailLogSchema.index({ accountId: 1, messageId: 1 }, { unique: true });
// Index to find emails by account (for cleanup or debugging)
ProcessedEmailLogSchema.index({ accountId: 1 });
// Index to find retry candidates (retryCount > 0)
ProcessedEmailLogSchema.index({ accountId: 1, retryCount: 1 });

export const ProcessedEmailLogModel = mongoose.model<IProcessedEmailLog>(
  "ProcessedEmailLog",
  ProcessedEmailLogSchema
);
