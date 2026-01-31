import mongoose, { Schema, Document, Types } from "mongoose";

// ================================
// Insight Model (Context-level understanding)
// ================================
export type ThreadIntent =
  | "action_required"
  | "event"
  | "opportunity"
  | "information"
  | "waiting"
  | "noise";

export interface IInsight extends Document {
    userId: Types.ObjectId;
    accountId: Types.ObjectId;
    gmailThreadId: string;
  emailIds: string[];
  threadId: Types.ObjectId;
  from: {
    email: string;
    name?: string;
    domain?: string;
  };
  labels: Array<{
    name: string;
  }>;
  importanceScore: number;
  summary: {
    shortSnippet: string;
    intent: ThreadIntent;
  };
  dates: Array<{
    type: "deadline" | "event" | "followup";
    date: Date;
    sourceEmailId: string;
  }>;
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    sourceEmailId: string;
  }>;
  state: {
    relevance: "active" | "expired" | "ignored";
    firstSeenAt: Date;
    lastSignalAt: Date;
    lastVerifiedAt: Date;
  };
  extractedFacts?: Record<string, any>;
  embedding?: number[];
  // timestamps added by mongoose
  createdAt?: Date;
  updatedAt?: Date;
}

const InsightSchema = new Schema<IInsight>(
    {
        userId: {
        type: Types.ObjectId,
        required: true,
        index: true,
        },
        accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true },
        gmailThreadId: { type: String, required: true },
        emailIds: [{ type: String }],
        threadId: { type: Schema.Types.ObjectId, ref: "Thread", unique: true },
        from:{
            email: { type: String, required: true },
            name: { type: String },
            domain: { type: String }, // derived for cheap filtering (.edu, company)
        },
        labels: [
      {
        name: {
          type: String,
          required: true,
        },
      },
    ],
       importanceScore: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
      index: true,
    },

    summary: {
      shortSnippet: {
        type: String,
        required: true,
      },
      intent: {
        type: String,
        enum: [
          "action_required",
          "event",
          "opportunity",
          "information",
          "waiting",
          "noise",
        ],
        required: true,
        index: true,
      },
    },
       dates: [
      {
        type: {
          type: String,
          enum: ["deadline", "event", "followup"],
          required: true,
        },
        date: {
          type: Date,
          required: true,
        },
        sourceEmailId: { type: String, required: true },
      },
    ],

     attachments: [
      {
        filename: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
        sourceEmailId: { type: String, required: true },
      },
    ],

    state: {
      relevance: {
        type: String,
        enum: ["active", "expired", "ignored"],
        required: true,
        index: true,
      },
      firstSeenAt: {
        type: Date,
        required: true,
      },
      lastSignalAt: {
        type: Date,
        required: true,
        index: true,
      },
      lastVerifiedAt: {
        type: Date,
        required: true,
      },
    },

    


    },

    { timestamps: true }
);

export const InsightModel = mongoose.model<IInsight>("Insight", InsightSchema);