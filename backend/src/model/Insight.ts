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
    userId: string;
    accountId: Types.ObjectId;
  docType?: "thread_insight";
  gmailThreadId: string;
  emailIds: string[];
  emails?: Array<{
    messageId: string;
    internalDate: Date;
    from: {
      email: string;
      name?: string;
      domain?: string;
    };
    subject: string;
    snippet?: string;
    labels: Array<{
      labelId?: Types.ObjectId;
      name: string;
    }>;
    dates: Array<{
      type: "deadline" | "event" | "followup";
      date: Date;
    }>;
    attachments: Array<{
      filename: string;
      mimeType: string;
      size: number;
    }>;
    importantLinks?: Array<{
      url: string;
      label?: string;
      reason?: string;
      inferred?: boolean;
    }>;
    checklist?: Array<{
      task: string;
      status: "pending";
      dueDate?: Date;
      reason?: string;
      inferred?: boolean;
    }>;
    extractedFacts?: Record<string, any>;
    ai: {
      intent: ThreadIntent;
      shortSnippet: string;
      importanceScore?: number;
      processedAt: Date;
    };
  }>;
  threadId?: Types.ObjectId;
  from: {
    email: string;
    name?: string;
    domain?: string;
  };
  labels: Array<{
    labelId?: Types.ObjectId;
    name: string;
    source: "system" | "user" | "ai";
    statusSnapshot: "active" | "suggested" | "rejected";
    matchScore?: number;
  }>;
  labelSuggestions?: Array<{
    labelId?: Types.ObjectId;
    name: string;
    source: "ai";
    status: "suggested" | "rejected";
    confidence?: number;
    generatedAt: Date;
  }>;
  importanceScore?: number;
  baseScore?: number;
  baseScoreBreakdown?: {
    importanceNorm: number;
    labelNorm: number;
    matchedLabelRank: number;
  };
  baseScoreComputedAt?: Date;
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
  checklist?: Array<{
    task: string;
    status: "pending";
    dueDate?: Date;
    reason?: string;
    inferred?: boolean;
    sourceEmailId: string;
  }>;
  state?: {
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
        type: String,
        required: true,
        index: true,
        },
        docType: {
          type: String,
          enum: ["thread_insight"],
          default: "thread_insight",
          index: true,
        },
        accountId: { type: Schema.Types.ObjectId, ref: "GmailAccount", required: true },
        gmailThreadId: { type: String, required: true },
        emailIds: [{ type: String }],
        emails: [
          {
            messageId: { type: String, required: true },
            internalDate: { type: Date, required: true },
            from: {
              email: { type: String, required: true },
              name: { type: String },
              domain: { type: String },
            },
            subject: { type: String, required: true },
            snippet: { type: String },
            labels: [
              {
                labelId: {
                  type: Schema.Types.ObjectId,
                  ref: "Label",
                  required: false,
                },
                name: { type: String, required: true },
              },
            ],
            dates: [
              {
                type: {
                  type: String,
                  enum: ["deadline", "event", "followup"],
                  required: true,
                },
                date: { type: Date, required: true },
              },
            ],
            attachments: [
              {
                filename: { type: String, required: true },
                mimeType: { type: String, required: true },
                size: { type: Number, required: true },
              },
            ],
            importantLinks: [
              {
                url: { type: String, required: true },
                label: { type: String },
                reason: { type: String },
                inferred: { type: Boolean, default: false },
              },
            ],
            checklist: [
              {
                task: { type: String, required: true },
                status: { type: String, enum: ["pending"], default: "pending" },
                dueDate: { type: Date },
                reason: { type: String },
                inferred: { type: Boolean, default: false },
              },
            ],
            extractedFacts: { type: Schema.Types.Mixed },
            ai: {
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
              },
              shortSnippet: { type: String, required: true },
              importanceScore: {
                type: Number,
                min: 0,
                max: 1,
                required: false,
              },
              processedAt: { type: Date, required: true },
            },
          },
        ],
        threadId: { type: Schema.Types.ObjectId, ref: "Thread", unique: false },
        from: {
            email: { type: String, required: true },
            name: { type: String },
            domain: { type: String }, // derived for cheap filtering (.edu, company)
        },
        labels: [
          {
            labelId: {
              type: Schema.Types.ObjectId,
              ref: "Label",
              required: false,
            },
            name: {
              type: String,
              required: true,
            },
            source: {
              type: String,
              enum: ["system", "user", "ai"],
              required: true,
            },
            statusSnapshot: {
              type: String,
              enum: ["active", "suggested", "rejected"],
              required: true,
            },
            matchScore: {
              type: Number,
              min: 0,
            },
          },
        ],
       labelSuggestions: [
        {
          labelId: {
            type: Schema.Types.ObjectId,
            ref: "Label",
            required: false,
          },
          name: {
            type: String,
            required: true,
          },
          source: {
            type: String,
            enum: ["ai"],
            required: true,
          },
          status: {
            type: String,
            enum: ["suggested", "rejected"],
            required: true,
          },
          confidence: {
            type: Number,
            min: 0,
            max: 1,
            required: false,
          },
          generatedAt: {
            type: Date,
            required: true,
          },
        },
       ],
       importanceScore: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
      index: true,
    },
    baseScore: {
      type: Number,
      required: false,
      index: true,
    },
    baseScoreBreakdown: {
      importanceNorm: {
        type: Number,
        min: 0,
        max: 1,
        required: false,
      },
      labelNorm: {
        type: Number,
        min: 0,
        max: 1,
        required: false,
      },
      matchedLabelRank: {
        type: Number,
        min: 1,
        required: false,
      },
    },
    baseScoreComputedAt: {
      type: Date,
      required: false,
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
    checklist: [
      {
        task: { type: String, required: true },
        status: { type: String, enum: ["pending"], default: "pending" },
        dueDate: { type: Date },
        reason: { type: String },
        inferred: { type: Boolean, default: false },
        sourceEmailId: { type: String, required: true },
      },
    ],

    state: {
      relevance: {
        type: String,
        enum: ["active", "expired", "ignored"],
        required: false,
        index: true,
      },
      firstSeenAt: {
        type: Date,
        required: false,
      },
      lastSignalAt: {
        type: Date,
        required: false,
        index: true,
      },
      lastVerifiedAt: {
        type: Date,
        required: false,
      },
    },

    


    },

    { timestamps: true }
);
InsightSchema.index({ accountId: 1, gmailThreadId: 1 });

export const InsightModel = mongoose.model<IInsight>("Insight", InsightSchema);
