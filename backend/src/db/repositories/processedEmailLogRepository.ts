import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface ProcessedEmailLogRow {
  id: string;
  account_id: string;
  message_id: string;
  insight_id: string;
  thread_id: string;
  previous_state_hash: string;
  previous_labels: string;
  internal_date: number;
  processed_at: number;
  retry_count: number;
  last_retry_at: number | null;
  last_error_message: string | null;
  error_type: string;
  created_at: number;
  updated_at: number;
}

export function findByMessageId(accountId: string, messageId: string): ProcessedEmailLogRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM processed_email_log
    WHERE account_id = ? AND message_id = ?
    LIMIT 1
  `);
  return (stmt.get(accountId, messageId) as ProcessedEmailLogRow | undefined) || null;
}

export function createOrUpdate(data: Omit<ProcessedEmailLogRow, "id" | "created_at" | "updated_at">): ProcessedEmailLogRow {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  // Use INSERT OR REPLACE for upsert behavior
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO processed_email_log (
      id, account_id, message_id, insight_id, thread_id, previous_state_hash,
      previous_labels, internal_date, processed_at, retry_count, last_retry_at,
      last_error_message, error_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.account_id,
    data.message_id,
    data.insight_id,
    data.thread_id,
    data.previous_state_hash,
    data.previous_labels,
    data.internal_date,
    data.processed_at,
    data.retry_count,
    data.last_retry_at,
    data.last_error_message,
    data.error_type,
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

export function incrementRetry(accountId: string, messageId: string, errorMessage: string, errorType: string): void {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE processed_email_log
    SET retry_count = retry_count + 1, last_retry_at = ?, 
        last_error_message = ?, error_type = ?, updated_at = ?
    WHERE account_id = ? AND message_id = ?
  `);
  stmt.run(now, errorMessage, errorType, now, accountId, messageId);
}

export function markSuccess(accountId: string, messageId: string): void {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE processed_email_log
    SET error_type = 'none', last_error_message = NULL, updated_at = ?
    WHERE account_id = ? AND message_id = ?
  `);
  stmt.run(now, accountId, messageId);
}

export function findById(id: string): ProcessedEmailLogRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM processed_email_log WHERE id = ? LIMIT 1
  `);
  return (stmt.get(id) as ProcessedEmailLogRow | undefined) || null;
}
