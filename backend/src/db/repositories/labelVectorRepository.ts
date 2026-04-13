import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface LabelVectorRow {
  id: string;
  label_id: string;
  embedding: string;
  updated_at: number;
}

export function upsert(labelId: string, embedding: string): LabelVectorRow {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  // Use INSERT OR REPLACE for upsert
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO label_vectors (
      id, label_id, embedding, updated_at
    ) VALUES (?, ?, ?, ?)
  `);

  stmt.run(id, labelId, embedding, now);

  return {
    id,
    label_id: labelId,
    embedding,
    updated_at: now,
  };
}

export function findByLabelId(labelId: string): LabelVectorRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM label_vectors
    WHERE label_id = ?
    LIMIT 1
  `);
  return (stmt.get(labelId) as LabelVectorRow | undefined) || null;
}

export function deleteByLabelId(labelId: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    DELETE FROM label_vectors WHERE label_id = ?
  `);
  stmt.run(labelId);
}

export function findById(id: string): LabelVectorRow | null {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM label_vectors WHERE id = ? LIMIT 1
  `);
  return (stmt.get(id) as LabelVectorRow | undefined) || null;
}
