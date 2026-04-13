import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface TrainingDatasetRow {
  id: string;
  user_id: string;
  message_id: string;
  subject: string;
  snippet: string;
  from_domain: string;
  has_attachment: number;
  hour_received: number | null;
  is_weekend: number;
  thread_size: number;
  embedding: string | null;
  final_label: string | null;
  final_intent: string | null;
  label_source: string;
  training_weight: number;
  confirmed_at: number | null;
  created_at: number;
  updated_at: number;
}

export function create(data: Omit<TrainingDatasetRow, "id" | "created_at" | "updated_at">): TrainingDatasetRow {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO training_dataset (
      id, user_id, message_id, subject, snippet, from_domain, has_attachment,
      hour_received, is_weekend, thread_size, embedding, final_label, final_intent,
      label_source, training_weight, confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.user_id,
    data.message_id,
    data.subject,
    data.snippet,
    data.from_domain,
    data.has_attachment,
    data.hour_received,
    data.is_weekend,
    data.thread_size,
    data.embedding,
    data.final_label,
    data.final_intent,
    data.label_source,
    data.training_weight,
    data.confirmed_at,
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

export function findByLabelSource(userId: string, labelSource: string): TrainingDatasetRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM training_dataset
    WHERE user_id = ? AND label_source = ?
  `);
  return stmt.all(userId, labelSource) as TrainingDatasetRow[];
}

export function countBySource(userId: string): Record<string, number> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT label_source, COUNT(*) as count
    FROM training_dataset
    WHERE user_id = ?
    GROUP BY label_source
  `);
  
  const rows = stmt.all(userId) as { label_source: string; count: number }[];
  const result: Record<string, number> = {};
  
  rows.forEach(row => {
    result[row.label_source] = row.count;
  });
  
  return result;
}

export function markConfirmed(trainingDatasetId: string): void {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    UPDATE training_dataset
    SET confirmed_at = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(now, now, trainingDatasetId);
}

export function findById(id: string): TrainingDatasetRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM training_dataset WHERE id = ? LIMIT 1
  `);
  return (stmt.get(id) as TrainingDatasetRow | undefined) || null;
}
