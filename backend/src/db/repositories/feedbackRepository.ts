import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface FeedbackRow {
  id: string;
  user_id: string;
  account_id: string;
  message_id: string | null;
  insight_id: string | null;
  thread_id: string | null;
  feedback_type: string;
  original_label: string | null;
  original_intent: string | null;
  original_score: number | null;
  corrected_label: string | null;
  corrected_intent: string | null;
  signal: string;
  source: string;
  used_in_training: number;
  training_weight: number | null;
  created_at: number;
  updated_at: number;
}

export function create(data: Omit<FeedbackRow, "id" | "created_at" | "updated_at">): FeedbackRow {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO feedback (
      id, user_id, account_id, message_id, insight_id, thread_id, feedback_type,
      original_label, original_intent, original_score, corrected_label, corrected_intent,
      signal, source, used_in_training, training_weight, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.user_id,
    data.account_id,
    data.message_id,
    data.insight_id,
    data.thread_id,
    data.feedback_type,
    data.original_label,
    data.original_intent,
    data.original_score,
    data.corrected_label,
    data.corrected_intent,
    data.signal,
    data.source,
    data.used_in_training,
    data.training_weight,
    now,
    now
  );

  return {
    id,
    ...data,
    created_at: now,
    updated_at: now,
  };
}

export function findByInsightId(insightId: string): FeedbackRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM feedback
    WHERE insight_id = ?
  `);
  return stmt.all(insightId) as FeedbackRow[];
}

export function findByMessageId(messageId: string): FeedbackRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM feedback
    WHERE message_id = ?
  `);
  return stmt.all(messageId) as FeedbackRow[];
}

export function findBoosted(userId: string, accountId: string): FeedbackRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM feedback
    WHERE user_id = ? AND account_id = ? AND feedback_type = 'boosted'
  `);
  return stmt.all(userId, accountId) as FeedbackRow[];
}

export function findSuppressed(userId: string, accountId: string): FeedbackRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM feedback
    WHERE user_id = ? AND account_id = ? AND feedback_type = 'suppressed'
  `);
  return stmt.all(userId, accountId) as FeedbackRow[];
}

export function markUsedInTraining(feedbackId: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE feedback
    SET used_in_training = 1, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(Date.now(), feedbackId);
}

export function findById(id: string): FeedbackRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM feedback WHERE id = ? LIMIT 1
  `);
  return (stmt.get(id) as FeedbackRow | undefined) || null;
}
