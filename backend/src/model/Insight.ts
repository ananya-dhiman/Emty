import mongoose, { Schema, Document, Types } from "mongoose";
import { getDb } from "../db/sqlite";

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

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const toDateOrUndefined = (val: number | null | undefined): Date | undefined => {
  if (typeof val !== "number") return undefined;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const toInsightShape = (row: any) => {
  const labels = parseJson<any[]>(row.labels, []);
  const dates = parseJson<any[]>(row.dates, []).map((d: any) => ({
    ...d,
    date: d?.date ? new Date(d.date) : undefined,
  }));
  const checklist = parseJson<any[]>(row.checklist, []).map((c: any) => ({
    ...c,
    dueDate: c?.dueDate ? new Date(c.dueDate) : undefined,
  }));
  const emails = parseJson<any[]>(row.emails, []).map((email: any) => ({
    ...email,
    internalDate: email?.internalDate ? new Date(email.internalDate) : undefined,
  }));

  return {
    id: row.id,
    _id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    gmailThreadId: row.gmail_thread_id,
    from: {
      email: row.from_email || "",
      name: row.from_name || undefined,
      domain: row.from_domain || undefined,
    },
    labels,
    summary: {
      shortSnippet: row.summary_snippet || "",
      intent: row.summary_intent || "information",
    },
    importanceScore: typeof row.importance_score === "number" ? row.importance_score : undefined,
    baseScore: typeof row.base_score === "number" ? row.base_score : undefined,
    baseScoreBreakdown: parseJson(row.base_score_breakdown, null),
    state: {
      relevance: row.state_relevance || undefined,
      firstSeenAt: toDateOrUndefined(row.state_first_seen_at),
      lastSignalAt: toDateOrUndefined(row.state_last_signal_at),
      lastVerifiedAt: toDateOrUndefined(row.state_last_verified_at),
    },
    dates,
    attachments: parseJson<any[]>(row.attachments, []),
    checklist,
    emails,
    createdAt: toDateOrUndefined(row.created_at),
    updatedAt: toDateOrUndefined(row.updated_at),
  };
};

export const Insight = {
  async findMany(args: { where?: Record<string, any>; select?: Record<string, boolean> } = {}) {
    const db = getDb();
    const where = args.where || {};
    const filters: string[] = [];
    const values: any[] = [];
    if (where.userId) {
      filters.push("user_id = ?");
      values.push(where.userId);
    }
    if (where.accountId) {
      filters.push("account_id = ?");
      values.push(String(where.accountId));
    }
    if (Array.isArray(where.OR) && where.OR.length > 0) {
      filters.push("(state_relevance = 'active' OR state_relevance IS NULL OR state_relevance = '')");
    }
    const whereClause = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT * FROM insights${whereClause}`).all(...values);
    return rows.map(toInsightShape);
  },
};
