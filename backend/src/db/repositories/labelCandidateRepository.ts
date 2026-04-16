import { getDb } from "../sqlite";
import { randomUUID } from "crypto";

export interface LabelCandidateRow {
  id: string;
  email_id: string;
  label_id: string;
  label_name: string;
  similarity_score: number;
  label_mode: string;
  stage2_processed_at: number | null;
  created_at: number;
  updated_at: number;
}

export function create(data: Omit<LabelCandidateRow, "id" | "created_at" | "updated_at">): LabelCandidateRow {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO label_candidates (
      id, email_id, label_id, label_name, similarity_score, label_mode, stage2_processed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.email_id,
    data.label_id,
    data.label_name,
    data.similarity_score,
    data.label_mode,
    data.stage2_processed_at,
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

export function findByEmailId(emailId: string): LabelCandidateRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM label_candidates
    WHERE email_id = ?
    ORDER BY similarity_score DESC
  `);
  return stmt.all(emailId) as LabelCandidateRow[];
}

export function findTopByEmailId(emailId: string, limit: number): LabelCandidateRow[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM label_candidates
    WHERE email_id = ?
    ORDER BY similarity_score DESC
    LIMIT ?
  `);
  return stmt.all(emailId, limit) as LabelCandidateRow[];
}

export function deleteByEmailId(emailId: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    DELETE FROM label_candidates WHERE email_id = ?
  `);
  stmt.run(emailId);
}
