import mongoose, { Schema, Document, Types } from "mongoose";
import { getDb } from "../db/sqlite";

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

const asAccountId = (accountId: any): string => {
  if (!accountId) return "";
  if (typeof accountId === "string") return accountId;
  if (accountId instanceof Types.ObjectId) return accountId.toString();
  return String(accountId);
};

const parseJsonArray = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((i) => typeof i === "string") : [];
  } catch {
    return [];
  }
};

const toServiceEmail = (row: any) => ({
  id: row.id,
  _id: row.id,
  userId: row.user_id,
  accountId: row.account_id,
  messageId: row.message_id,
  threadId: row.thread_id,
  from: row.from,
  subject: row.subject || "",
  snippet: row.snippet || "",
  internalDate: new Date(row.internal_date),
  hasAttachments: Boolean(row.has_attachments),
  extractedFeatures: parseJsonArray(row.extracted_features),
  score: typeof row.score === "number" ? row.score : null,
  aiProcessed: Boolean(row.ai_processed),
  priorityState: row.priority_state || "pending",
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const EmailMessage = {
  async findMany(args: { where?: Record<string, any>; orderBy?: any; take?: number; select?: Record<string, boolean> } = {}) {
    const db = getDb();
    const where = args.where || {};
    const filters: string[] = [];
    const values: any[] = [];

    if (where.accountId !== undefined) {
      filters.push("account_id = ?");
      values.push(asAccountId(where.accountId));
    }
    if (where.userId !== undefined) {
      filters.push("user_id = ?");
      values.push(where.userId);
    }
    if (where.aiProcessed !== undefined) {
      filters.push("ai_processed = ?");
      values.push(where.aiProcessed ? 1 : 0);
    }
    if (where.score && typeof where.score === "object") {
      if (where.score.not === null) filters.push("score IS NOT NULL");
      if (typeof where.score.lt === "number") {
        filters.push("score < ?");
        values.push(where.score.lt);
      }
    }
    if (where.messageId && typeof where.messageId === "object" && Array.isArray(where.messageId.in)) {
      const placeholders = where.messageId.in.map(() => "?").join(", ");
      filters.push(`message_id IN (${placeholders})`);
      values.push(...where.messageId.in);
    }

    let orderClause = "";
    if (Array.isArray(args.orderBy)) {
      const parts = args.orderBy.map((item: Record<string, string>) => {
        const [k, v] = Object.entries(item)[0];
        const col = k === "internalDate" ? "internal_date" : k === "score" ? "score" : k;
        return `${col} ${v === "asc" ? "ASC" : "DESC"}`;
      });
      orderClause = ` ORDER BY ${parts.join(", ")}`;
    } else if (args.orderBy && typeof args.orderBy === "object") {
      const [k, v] = Object.entries(args.orderBy)[0];
      const col = k === "internalDate" ? "internal_date" : k;
      orderClause = ` ORDER BY ${col} ${v === "asc" ? "ASC" : "DESC"}`;
    }

    const limitClause = typeof args.take === "number" ? ` LIMIT ${args.take}` : "";
    const whereClause = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM email_messages${whereClause}${orderClause}${limitClause}`)
      .all(...values);
    return rows.map(toServiceEmail);
  },

  async upsert(args: {
    where: { accountId_messageId: { accountId: string; messageId: string } };
    update: Record<string, any>;
    create: Record<string, any>;
  }) {
    const db = getDb();
    const accountId = asAccountId(args.where.accountId_messageId.accountId);
    const messageId = args.where.accountId_messageId.messageId;
    const existing = db
      .prepare("SELECT * FROM email_messages WHERE account_id = ? AND message_id = ? LIMIT 1")
      .get(accountId, messageId) as any;

    const toRow = (input: Record<string, any>, baseId?: string) => ({
      id: baseId || new Types.ObjectId().toString(),
      user_id: input.userId || "",
      account_id: asAccountId(input.accountId || accountId),
      message_id: input.messageId || messageId,
      thread_id: input.threadId || "",
      from: input.from || "",
      subject: input.subject || "",
      snippet: input.snippet || "",
      internal_date: input.internalDate ? new Date(input.internalDate).getTime() : Date.now(),
      has_attachments: input.hasAttachments ? 1 : 0,
      extracted_features: JSON.stringify(input.extractedFeatures || []),
      score: typeof input.score === "number" ? input.score : null,
      ai_processed: input.aiProcessed ? 1 : 0,
      priority_state: input.priorityState || "pending",
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    if (!existing) {
      const row = toRow(args.create);
      db.prepare(
        `
        INSERT INTO email_messages (
          id, user_id, account_id, message_id, thread_id, "from", subject, snippet,
          internal_date, has_attachments, extracted_features, score, ai_processed, priority_state,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(
        row.id,
        row.user_id,
        row.account_id,
        row.message_id,
        row.thread_id,
        row.from,
        row.subject,
        row.snippet,
        row.internal_date,
        row.has_attachments,
        row.extracted_features,
        row.score,
        row.ai_processed,
        row.priority_state,
        row.created_at,
        row.updated_at
      );
      return toServiceEmail(row);
    }

    const merged = { ...toServiceEmail(existing), ...args.update, id: existing.id };
    db.prepare(
      `
      UPDATE email_messages
      SET user_id = ?, thread_id = ?, "from" = ?, subject = ?, snippet = ?, internal_date = ?,
          has_attachments = ?, extracted_features = ?, score = ?, ai_processed = ?, priority_state = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(
      merged.userId,
      merged.threadId,
      merged.from,
      merged.subject || "",
      merged.snippet || "",
      merged.internalDate ? new Date(merged.internalDate).getTime() : Date.now(),
      merged.hasAttachments ? 1 : 0,
      JSON.stringify(merged.extractedFeatures || []),
      typeof merged.score === "number" ? merged.score : null,
      merged.aiProcessed ? 1 : 0,
      merged.priorityState || "pending",
      Date.now(),
      existing.id
    );
    const updated = db.prepare("SELECT * FROM email_messages WHERE id = ? LIMIT 1").get(existing.id);
    return toServiceEmail(updated);
  },

  async update(
    argsOrWhere: { where: { id: string }; data?: Record<string, any> } | { where: { id: string } },
    maybeData?: Record<string, any>
  ) {
    const args: { where: { id: string }; data: Record<string, any> } =
      maybeData !== undefined
        ? { where: (argsOrWhere as any).where, data: maybeData }
        : { where: (argsOrWhere as any).where, data: (argsOrWhere as any).data || {} };
    const db = getDb();
    const existing = db.prepare("SELECT * FROM email_messages WHERE id = ? LIMIT 1").get(args.where.id) as any;
    if (!existing) return null;
    const merged = { ...toServiceEmail(existing), ...args.data };
    db.prepare(
      `
      UPDATE email_messages
      SET score = ?, priority_state = ?, ai_processed = ?, updated_at = ?
      WHERE id = ?
      `
    ).run(
      typeof merged.score === "number" ? merged.score : null,
      merged.priorityState || "pending",
      merged.aiProcessed ? 1 : 0,
      Date.now(),
      args.where.id
    );
    const updated = db.prepare("SELECT * FROM email_messages WHERE id = ? LIMIT 1").get(args.where.id);
    return toServiceEmail(updated);
  },
};
