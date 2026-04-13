import { getDb } from "../sqlite";

export interface LocalAccountRow {
  id: string;
  user_id: string;
  email_address: string;
  config_json: string;
  created_at: number;
  updated_at: number;
}

export function upsert(params: {
  id: string;
  user_id: string;
  email_address: string;
  config_json?: string;
}): LocalAccountRow {
  const db = getDb();
  const now = Date.now();

  db.prepare(
    `
    INSERT INTO accounts (id, user_id, email_address, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      email_address = excluded.email_address,
      config_json = excluded.config_json,
      updated_at = excluded.updated_at
    `
  ).run(
    params.id,
    params.user_id,
    params.email_address,
    params.config_json || "{}",
    now,
    now
  );

  return db
    .prepare("SELECT * FROM accounts WHERE id = ? LIMIT 1")
    .get(params.id) as LocalAccountRow;
}

export function findById(id: string): LocalAccountRow | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM accounts WHERE id = ? LIMIT 1").get(id) as
      | LocalAccountRow
      | undefined) || null
  );
}
