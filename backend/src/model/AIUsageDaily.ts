import mongoose, { Document, Schema } from "mongoose";

export interface IAIUsageDaily extends Document {
  userId: string;
  dateKey: string; // UTC date key: YYYY-MM-DD
  processedCount: number;
  quotaLimit: number;
  lastUpdatedAt: Date;
}

const AIUsageDailySchema = new Schema<IAIUsageDaily>(
  {
    userId: { type: String, required: true, index: true },
    dateKey: { type: String, required: true, index: true },
    processedCount: { type: Number, default: 0, min: 0 },
    quotaLimit: { type: Number, required: true },
    lastUpdatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

AIUsageDailySchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export const AIUsageDailyModel = mongoose.model<IAIUsageDaily>(
  "AIUsageDaily",
  AIUsageDailySchema
);

