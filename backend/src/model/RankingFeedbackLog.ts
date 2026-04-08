import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRankingFeedbackLog extends Document {
  userId: string;
  insightId?: Types.ObjectId; // For top/action emails (AI processed)
  messageId?: string; // For low priority emails (Pre-filter processed)
  signal: "boost" | "suppress" | "none";
  predictedScore: number;
  source: "ai_insight" | "pre_filter";
  createdAt?: Date;
  updatedAt?: Date;
}

const RankingFeedbackLogSchema = new Schema<IRankingFeedbackLog>(
  {
    userId: { type: String, required: true, index: true },
    insightId: { type: Schema.Types.ObjectId, ref: "Insight", required: false, index: true },
    messageId: { type: String, required: false, index: true },
    signal: {
      type: String,
      enum: ["boost", "suppress", "none"],
      required: true,
    },
    predictedScore: { type: Number, required: true },
    source: {
      type: String,
      enum: ["ai_insight", "pre_filter"],
      required: true,
    },
  },
  { timestamps: true }
);

RankingFeedbackLogSchema.index({ userId: 1, insightId: 1 });
RankingFeedbackLogSchema.index({ userId: 1, messageId: 1 });

export const RankingFeedbackLogModel = mongoose.model<IRankingFeedbackLog>(
  "RankingFeedbackLog",
  RankingFeedbackLogSchema
);
