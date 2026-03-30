import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * EmailMessage Model
 * Staging model for parsed but un-processed emails.
 * Emails are fetched, their generic features extracted via RulesEngine,
 * and saved here before heavy async scoring and AI processing.
 */

export interface IEmailMessage extends Document {
  userId: string;
  accountId: Types.ObjectId;
  messageId: string;
  threadId: string;
  from: string; // The raw 'from' string
  subject: string;
  snippet: string;
  internalDate: Date;
  hasAttachments: boolean;
  extractedFeatures: string[]; // Generic features (e.g. from domains, fast heuristic labels)
  score: number | null; // Set asynchronously later
  aiProcessed: boolean; // Flag to indicate if email was passed to open loop ai worker
  priorityState: 'top' | 'low' | 'pending'; // Reflects if it's placed in the top K queue
  createdAt: Date;
  updatedAt: Date;
}

const EmailMessageSchema = new Schema<IEmailMessage>(
  {
    userId: { type: String, required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true, index: true },
    messageId: { type: String, required: true },
    threadId: { type: String, required: true },
    from: { type: String, required: true },
    subject: { type: String, required: false, default: '' },
    snippet: { type: String, required: false, default: '' },
    internalDate: { type: Date, required: true },
    hasAttachments: { type: Boolean, default: false },
    extractedFeatures: { type: [String], default: [] },
    score: { type: Number, default: null, index: true },
    aiProcessed: { type: Boolean, default: false, index: true },
    priorityState: { type: String, enum: ['top', 'low', 'pending'], default: 'pending', index: true },
  },
  { timestamps: true }
);

// Compound index to ensure uniqueness per account and to query efficiently
EmailMessageSchema.index({ accountId: 1, messageId: 1 }, { unique: true });
// Index to quickly fetch unprocessed emails
EmailMessageSchema.index({ accountId: 1, priorityState: 1, aiProcessed: 1 });

export const EmailMessageModel = mongoose.model<IEmailMessage>("EmailMessage", EmailMessageSchema);
