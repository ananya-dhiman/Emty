import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface EmailMessageRow {
  id: string;
  user_id: string;
  account_id: string;
  message_id: string;
  thread_id: string;
  from: string;
  subject: string;
  snippet: string;
  internal_date: number;
  has_attachments: number;
  extracted_features: string;
  score: number | null;
  ai_processed: number;
  priority_state: string;
  embedding: string | null;
  embedding_model: string | null;
  created_at: number;
  updated_at: number;
}

export function create(data: Omit<EmailMessageRow, "id" | "created_at" | "updated_at">): EmailMessageRow {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO email_messages (
      id, user_id, account_id, message_id, thread_id, "from", subject, snippet,
      internal_date, has_attachments, extracted_features, score, ai_processed,
      priority_state, embedding, embedding_model, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.user_id,
    data.account_id,
    data.message_id,
    data.thread_id,
    data.from,
    data.subject,
    data.snippet,
    data.internal_date,
    data.has_attachments,
    data.extracted_features,
    data.score,
    data.ai_processed,
    data.priority_state,
    data.embedding,
    data.embedding_model,
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

export function findUnprocessed(accountId: string, limit: number = 50): EmailMessageRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM email_messages
    WHERE account_id = ? AND priority_state = 'top' AND ai_processed = 0
    ORDER BY score DESC, internal_date DESC
    LIMIT ?
  `);

  return stmt.all(accountId, limit) as EmailMessageRow[];
}

export function findByMessageId(accountId: string, messageId: string): EmailMessageRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM email_messages
    WHERE account_id = ? AND message_id = ?
    LIMIT 1
  `);

  return (stmt.get(accountId, messageId) as EmailMessageRow | undefined) || null;
}

export function findById(id: string): EmailMessageRow | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM email_messages WHERE id = ? LIMIT 1`);
  return (stmt.get(id) as EmailMessageRow | undefined) || null;
}

export function updateScore(messageId: string, score: number, priorityState: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE email_messages
    SET score = ?, priority_state = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(score, priorityState, Date.now(), messageId);
}

export function markProcessed(messageId: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE email_messages
    SET ai_processed = 1, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(Date.now(), messageId);
}

export function updateEmbedding(messageId: string, embedding: string, embeddingModel: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE email_messages
    SET embedding = ?, embedding_model = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(embedding, embeddingModel, Date.now(), messageId);
}

export function findByAccountId(accountId: string): EmailMessageRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM email_messages
    WHERE account_id = ?
  `);
  return stmt.all(accountId) as EmailMessageRow[];
}

export function findTopScoredByAccountId(accountId: string): EmailMessageRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM email_messages
    WHERE account_id = ?
    ORDER BY score DESC, internal_date DESC
  `);
  return stmt.all(accountId) as EmailMessageRow[];
}

export function updatePriorityStateAndScore(id: string, score: number | null, priorityState: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE email_messages
    SET score = ?, priority_state = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(score, priorityState, Date.now(), id);
}

export function updatePriorityState(id: string, priorityState: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE email_messages
    SET priority_state = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(priorityState, Date.now(), id);
}

export function upsertMessage(data: Omit<EmailMessageRow, "id" | "created_at" | "updated_at">): void {
  const db = getDb();
  const now = Date.now();
  
  // Try to find if it exists
  const existing = findByMessageId(data.account_id, data.message_id);
  
  if (existing) {
    const stmt = db.prepare(`
      UPDATE email_messages
      SET thread_id = ?, "from" = ?, subject = ?, snippet = ?, 
          internal_date = ?, has_attachments = ?, extracted_features = ?, updated_at = ?
      WHERE id = ?
    `);
    
    stmt.run(
      data.thread_id,
      data.from,
      data.subject,
      data.snippet,
      data.internal_date,
      data.has_attachments,
      data.extracted_features,
      now,
      existing.id
    );
  } else {
    create(data);
  }
}
