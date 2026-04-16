import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface InsightRow {
  id: string;
  user_id: string;
  account_id: string;
  gmail_thread_id: string;
  email_ids: string;
  emails: string;
  from_email: string;
  from_name: string | null;
  from_domain: string | null;
  labels: string;
  label_suggestions: string;
  importance_score: number | null;
  base_score: number | null;
  base_score_breakdown: string | null;
  base_score_computed_at: number | null;
  summary_snippet: string;
  summary_intent: string;
  dates: string;
  attachments: string;
  checklist: string;
  state_relevance: string;
  state_first_seen_at: number | null;
  state_last_signal_at: number | null;
  state_last_verified_at: number | null;
  extracted_facts: string | null;
  embedding: string | null;
  needs_review: number;
  ai_confidence: number | null;
  ai_uncertainty_source: string | null;
  pipeline_stage_reached: string | null;
  verification_status: string;
  failed_verification_groups: string;
  source: string | null;
  created_at: number;
  updated_at: number;
}

export function create(data: Omit<InsightRow, "id" | "created_at" | "updated_at">): InsightRow {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO insights (
      id, user_id, account_id, gmail_thread_id, email_ids, emails, from_email, from_name, from_domain,
      labels, label_suggestions, importance_score, base_score, base_score_breakdown, base_score_computed_at,
      summary_snippet, summary_intent, dates, attachments, checklist, state_relevance, state_first_seen_at,
      state_last_signal_at, state_last_verified_at, extracted_facts, embedding, needs_review, ai_confidence,
      ai_uncertainty_source, pipeline_stage_reached, verification_status, failed_verification_groups, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.user_id,
    data.account_id,
    data.gmail_thread_id,
    data.email_ids,
    data.emails,
    data.from_email,
    data.from_name,
    data.from_domain,
    data.labels,
    data.label_suggestions,
    data.importance_score,
    data.base_score,
    data.base_score_breakdown,
    data.base_score_computed_at,
    data.summary_snippet,
    data.summary_intent,
    data.dates,
    data.attachments,
    data.checklist,
    data.state_relevance,
    data.state_first_seen_at,
    data.state_last_signal_at,
    data.state_last_verified_at,
    data.extracted_facts,
    data.embedding,
    data.needs_review,
    data.ai_confidence,
    data.ai_uncertainty_source,
    data.pipeline_stage_reached,
    data.verification_status || 'pending',
    data.failed_verification_groups || '[]',
    data.source,
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

export function findById(id: string): InsightRow | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM insights WHERE id = ? LIMIT 1`);
  return (stmt.get(id) as InsightRow | undefined) || null;
}

export function findByThreadId(accountId: string, threadId: string): InsightRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM insights
    WHERE account_id = ? AND gmail_thread_id = ?
    LIMIT 1
  `);
  return (stmt.get(accountId, threadId) as InsightRow | undefined) || null;
}

export function updateLabels(insightId: string, labels: string, labelSuggestions: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE insights
    SET labels = ?, label_suggestions = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(labels, labelSuggestions, Date.now(), insightId);
}

export function updateState(insightId: string, stateUpdate: {
  state_relevance?: string;
  state_first_seen_at?: number | null;
  state_last_signal_at?: number | null;
  state_last_verified_at?: number | null;
}): void {
  const db = getDb();
  const updates: string[] = [];
  const values: any[] = [];

  if (stateUpdate.state_relevance !== undefined) {
    updates.push("state_relevance = ?");
    values.push(stateUpdate.state_relevance);
  }
  if (stateUpdate.state_first_seen_at !== undefined) {
    updates.push("state_first_seen_at = ?");
    values.push(stateUpdate.state_first_seen_at);
  }
  if (stateUpdate.state_last_signal_at !== undefined) {
    updates.push("state_last_signal_at = ?");
    values.push(stateUpdate.state_last_signal_at);
  }
  if (stateUpdate.state_last_verified_at !== undefined) {
    updates.push("state_last_verified_at = ?");
    values.push(stateUpdate.state_last_verified_at);
  }

  if (updates.length === 0) return;

  updates.push("updated_at = ?");
  values.push(Date.now());
  values.push(insightId);

  const stmt = db.prepare(`
    UPDATE insights
    SET ${updates.join(", ")}
    WHERE id = ?
  `);
  stmt.run(...values);
}

export function findNeedingReview(accountId: string): InsightRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM insights
    WHERE account_id = ? AND needs_review = 1
  `);
  return stmt.all(accountId) as InsightRow[];
}

export function markNeedsReview(insightId: string, reason: string | null = null): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE insights
    SET needs_review = 1, ai_uncertainty_source = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(reason, Date.now(), insightId);
}

export function getByIntent(accountId: string, intent: string): InsightRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM insights
    WHERE account_id = ? AND summary_intent = ?
  `);
  return stmt.all(accountId, intent) as InsightRow[];
}

export function updateVerificationStatus(
  insightId: string,
  verificationStatus: string,
  failedGroups: string,
  source: string | null
): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE insights
    SET verification_status = ?, failed_verification_groups = ?, source = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(verificationStatus, failedGroups, source, Date.now(), insightId);
}

export function updateSource(insightId: string, source: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE insights
    SET source = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(source, Date.now(), insightId);
}
