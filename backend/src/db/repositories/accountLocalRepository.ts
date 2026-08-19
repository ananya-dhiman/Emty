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

  // Remove any old account with the same email address but different ID
  // to avoid UNIQUE constraint failures when inserting the new ID.
  db.prepare(`DELETE FROM accounts WHERE email_address = ? AND id != ?`).run(params.email_address, params.id);

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

export function setActive(id: string, userId?: string): void {
  const db = getDb();
  const now = Date.now();

  // Reset within the user's accounts when a userId is known; the unscoped
  // path remains for the sidecar, which has no user context.
  if (userId) {
    db.prepare("UPDATE accounts SET is_active = 0, updated_at = ? WHERE user_id = ?").run(now, userId);
  } else {
    db.prepare("UPDATE accounts SET is_active = 0, updated_at = ?").run(now);
  }

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
    const allMongoAccounts = await GmailAccountModel.find().lean();
    const db = getDb();
    const localUserIds = new Set(
      (db.prepare("SELECT id FROM users").all() as Array<{ id: string }>).map((u) => u.id)
    );

    // Bail before pruning when the primary DB returns nothing. "Zero accounts"
    // is indistinguishable from "Mongo is unhealthy or pointed at the wrong DB",
    // and pruning on that signal would delete every local account row. Ghost
    // cleanup below still runs whenever Mongo returns a non-empty set, which is
    // the case it was written for.
    if (allMongoAccounts.length === 0) return;

    // Nothing to mirror, and nothing safe to prune, until somebody has signed
    // in on this machine.
    //
    // This used to fall back to mirroring EVERY account in Mongo when the users
    // table was empty — "fall back to all on a fresh DB". Mongo is shared by all
    // Emty users, so on a fresh install that copied every other user's connected
    // email address onto this device, and the auto-select below could then mark
    // a stranger's account as active. Returning early is the only correct
    // behaviour: with no local user there is nobody to mirror accounts *for*.
    if (localUserIds.size === 0) {
      logger.info("No local users yet — skipping account mirror until someone signs in");
      return;
    }

    // Reconcile: prune local rows whose account no longer exists in the primary
    // DB. Without this, a wiped or reconnected primary DB leaves ghost accounts
    // locally — which then show up in the switcher and 403 every request made
    // against them.
    //
    // Accounts whose owner is not a user of this install are pruned too. They
    // were previously skipped, which is why a different person's account copied
    // here by the old fresh-install behaviour could never be cleaned up.
    const mongoIds = new Set(allMongoAccounts.map((acc) => String(acc._id)));
    const localRows = db
      .prepare("SELECT id, user_id, email_address FROM accounts")
      .all() as Array<{ id: string; user_id: string; email_address: string }>;
    for (const row of localRows) {
      if (!localUserIds.has(row.user_id) || !mongoIds.has(row.id)) {
        // Purge every table keyed to the account, not just the accounts row.
        // Deleting the row alone orphaned its insights, emails, checkpoints and
        // feedback, which kept driving notifications for accounts the user had
        // already removed — and left checkpoints pointing at an account the AI
        // worker could no longer resolve ("Gmail account not found").
        purgeAccountData(row.id);
        logger.info(`Pruned stale local account ${row.email_address} and its data (no longer in primary DB)`);
      }
    }

    // Mongo is shared across users, so only ever mirror accounts belonging to a
    // user of this install. There is no fallback branch by design — see above.
    const mongoAccounts = allMongoAccounts.filter((acc) => localUserIds.has(acc.userId));
    if (mongoAccounts.length === 0) return;

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

/**
 * Deletes rows whose account_id no longer matches any account.
 *
 * purgeAccountData only reaches data for accounts that still have a row in
 * `accounts`; once that row is gone by any path, everything keyed to it is
 * stranded. Reconnecting the same mailbox mints a fresh account id, so this
 * happens routinely and strands the previous id's insights — which keep
 * driving notifications for a mailbox the user thinks they removed.
 *
 * Migration v7 cleared the backlog once. This runs every boot so it cannot
 * build up again.
 */
export function purgeOrphanedData(): number {
  const db = getDb();
  const tables = [
    "insights",
    "email_messages",
    "processed_email_log",
    "feedback",
    "sync_checkpoints",
  ];

  // Guard for the same reason autoPopulateFromMongo guards: an empty accounts
  // table means "not populated yet", not "everything is orphaned".
  const accountCount = (
    db.prepare("SELECT COUNT(*) AS c FROM accounts").get() as { c: number }
  ).c;
  if (accountCount === 0) return 0;

  let total = 0;
  const tx = db.transaction(() => {
    for (const table of tables) {
      const { changes } = db
        .prepare(
          `DELETE FROM ${table}
            WHERE account_id IS NOT NULL
              AND account_id NOT IN (SELECT id FROM accounts)`
        )
        .run();
      total += changes;
    }
  });
  tx();
  return total;
}

/**
 * Removes an account and ALL its locally stored data (emails, insights,
 * sync state, retry logs, feedback) in one transaction.
 */
export function purgeAccountData(accountId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM insights WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM email_messages WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM processed_email_log WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM feedback WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM sync_checkpoints WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
  });
  tx();
}

export function findAllByUser(userId: string): LocalAccountRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as LocalAccountRow[];
}
