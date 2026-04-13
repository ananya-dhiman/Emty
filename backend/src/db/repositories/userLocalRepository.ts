import { getDb } from "../sqlite";

export interface LocalUserRow {
  id: string;
  created_at: number;
  updated_at: number;
}

export function upsert(userId: string): LocalUserRow {
  const db = getDb();
  const now = Date.now();

  db.prepare(
    `
    INSERT INTO users (id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at
    `
  ).run(userId, now, now);

  return db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .get(userId) as LocalUserRow;
}

export function findById(userId: string): LocalUserRow | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(userId) as
      | LocalUserRow
      | undefined) || null
  );
}
