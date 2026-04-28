import { getDb } from "../sqlite";
import { GmailAccountModel } from "../../model/GmailAccount";
import logger from "../../utils/logger";

export interface LocalAccountRow {
  id: string;
  user_id: string;
  email_address: string;
  config_json: string;
  is_active: number;
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

export function setActive(id: string): void {
  const db = getDb();
  const now = Date.now();
  
  // Reset all to 0
  db.prepare("UPDATE accounts SET is_active = 0, updated_at = ?").run(now);
  
  // Set target to 1
  db.prepare("UPDATE accounts SET is_active = 1, updated_at = ? WHERE id = ?").run(now, id);
}

export function getActiveAccount(): LocalAccountRow | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM accounts WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1").get() as
      | LocalAccountRow
      | undefined) || null
  );
}

export async function autoPopulateFromMongo(): Promise<void> {
  try {
    const mongoAccounts = await GmailAccountModel.find().lean();
    if (!mongoAccounts || mongoAccounts.length === 0) return;

    for (const acc of mongoAccounts) {
      upsert({
        id: String(acc._id),
        user_id: acc.userId,
        email_address: acc.emailAddress,
        config_json: "{}"
      });
    }

    // Auto-set the active account if none is active
    const active = getActiveAccount();
    if (!active && mongoAccounts.length > 0) {
      // Pick the most recently created or just the first one
      setActive(String(mongoAccounts[0]._id));
      logger.info(`Auto-populated and set active account: ${mongoAccounts[0].emailAddress}`);
    } else {
      logger.info(`Auto-populated local accounts from MongoDB.`);
    }
  } catch (error) {
    logger.info("Failed to auto-populate local accounts from MongoDB:", error);
  }
}
