import Database from "better-sqlite3";
import logger from "../utils/logger";

/**
 * Check schema version and run pending migrations
 */
export function runMigrations(db: Database.Database): void {
  try {
    // Create schema_version table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at INTEGER DEFAULT (unixepoch('now') * 1000)
      );
    `);
    // Get current schema version
    const versionRow = db
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version: number | null };
    const currentVersion = versionRow?.version || 0;

    if (currentVersion < 1) {
      migration_v1(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();
      logger.info("Applied migration v1: Create core tables");
    }

    if (currentVersion < 2) {
      migration_v2(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (2)").run();
      logger.info("Applied migration v2: Add label_name to label_vectors");
    }

    if (currentVersion < 3) {
      migration_v3(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (3)").run();
      logger.info("Applied migration v3: Add background sync fields to sync_checkpoints");
    }

    if (currentVersion < 4) {
      migration_v4(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (4)").run();
      logger.info("Applied migration v4: Add is_active to accounts");
    }

    if (currentVersion < 5) {
      migration_v5(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (5)").run();
      logger.info("Applied migration v5: Add is_completed to insights");
    }

    if (currentVersion < 6) {
      migration_v6(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (6)").run();
      logger.info("Applied migration v6: Add track folder fields to insights");
    }

    if (currentVersion < 7) {
      migration_v7(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (7)").run();
      logger.info("Applied migration v7: Purge data orphaned by removed accounts");
    }

    const finalVersion = db
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version: number | null };

    logger.info(`Database schema version: ${finalVersion?.version || 0}`);
  } catch (error) {
    logger.info("Migration failed:", error);
    throw error;
  }
}

/**
 * Migration v1: Create all core tables
 */
function migration_v1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email_address TEXT NOT NULL,
      config_json TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000),
      UNIQUE(email_address)
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

    CREATE TABLE IF NOT EXISTS email_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      "from" TEXT NOT NULL,
      subject TEXT DEFAULT '',
      snippet TEXT DEFAULT '',
      internal_date INTEGER NOT NULL,
      has_attachments INTEGER DEFAULT 0,
      extracted_features TEXT DEFAULT '[]',
      score REAL DEFAULT NULL,
      ai_processed INTEGER DEFAULT 0,
      priority_state TEXT DEFAULT 'pending',
      embedding TEXT DEFAULT NULL,
      embedding_model TEXT DEFAULT NULL,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000),
      UNIQUE(account_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_email_messages_user ON email_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_messages_account ON email_messages(account_id);
    CREATE INDEX IF NOT EXISTS idx_email_messages_priority ON email_messages(account_id, priority_state, ai_processed);
    CREATE INDEX IF NOT EXISTS idx_email_messages_score ON email_messages(score);

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      gmail_thread_id TEXT NOT NULL,
      email_ids TEXT DEFAULT '[]',
      emails TEXT DEFAULT '[]',
      from_email TEXT NOT NULL,
      from_name TEXT DEFAULT NULL,
      from_domain TEXT DEFAULT NULL,
      labels TEXT DEFAULT '[]',
      label_suggestions TEXT DEFAULT '[]',
      importance_score REAL DEFAULT NULL,
      base_score REAL DEFAULT NULL,
      base_score_breakdown TEXT DEFAULT NULL,
      base_score_computed_at INTEGER DEFAULT NULL,
      summary_snippet TEXT NOT NULL,
      summary_intent TEXT NOT NULL,
      dates TEXT DEFAULT '[]',
      attachments TEXT DEFAULT '[]',
      checklist TEXT DEFAULT '[]',
      state_relevance TEXT DEFAULT 'active',
      state_first_seen_at INTEGER DEFAULT NULL,
      state_last_signal_at INTEGER DEFAULT NULL,
      state_last_verified_at INTEGER DEFAULT NULL,
      extracted_facts TEXT DEFAULT NULL,
      embedding TEXT DEFAULT NULL,
      needs_review INTEGER DEFAULT 0,
      ai_confidence REAL DEFAULT NULL,
      ai_uncertainty_source TEXT DEFAULT NULL,
      pipeline_stage_reached TEXT DEFAULT NULL,
      verification_status TEXT DEFAULT 'pending',
      failed_verification_groups TEXT DEFAULT '[]',
      source TEXT DEFAULT NULL,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id);
    CREATE INDEX IF NOT EXISTS idx_insights_account_thread ON insights(account_id, gmail_thread_id);
    CREATE INDEX IF NOT EXISTS idx_insights_intent ON insights(summary_intent);
    CREATE INDEX IF NOT EXISTS idx_insights_needs_review ON insights(needs_review);
    CREATE INDEX IF NOT EXISTS idx_insights_signal ON insights(state_last_signal_at);

    CREATE TABLE IF NOT EXISTS sync_checkpoints (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE,
      last_history_id TEXT DEFAULT NULL,
      last_sync_timestamp INTEGER DEFAULT NULL,
      sync_state TEXT DEFAULT 'idle',
      sync_started_at INTEGER DEFAULT NULL,
      last_sync_error TEXT DEFAULT NULL,
      processed_count INTEGER DEFAULT 0,
      succeeded_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      progress_percent REAL DEFAULT 0,
      progress_stage TEXT DEFAULT 'initializing',
      progress_message TEXT DEFAULT NULL,
      total_candidates INTEGER DEFAULT 0,
      processed_candidates INTEGER DEFAULT 0,
      last_progress_at INTEGER DEFAULT NULL,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS processed_email_log (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      insight_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      previous_state_hash TEXT NOT NULL,
      previous_labels TEXT DEFAULT '[]',
      internal_date INTEGER NOT NULL,
      processed_at INTEGER DEFAULT (unixepoch('now') * 1000),
      retry_count INTEGER DEFAULT 0,
      last_retry_at INTEGER DEFAULT NULL,
      last_error_message TEXT DEFAULT NULL,
      error_type TEXT DEFAULT 'none',
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000),
      UNIQUE(account_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pel_account ON processed_email_log(account_id);
    CREATE INDEX IF NOT EXISTS idx_pel_retry ON processed_email_log(account_id, retry_count, error_type);

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      message_id TEXT DEFAULT NULL,
      insight_id TEXT DEFAULT NULL,
      thread_id TEXT DEFAULT NULL,
      feedback_type TEXT NOT NULL,
      original_label TEXT DEFAULT NULL,
      original_intent TEXT DEFAULT NULL,
      original_score REAL DEFAULT NULL,
      corrected_label TEXT DEFAULT NULL,
      corrected_intent TEXT DEFAULT NULL,
      signal TEXT DEFAULT 'none',
      source TEXT DEFAULT 'ai_insight',
      used_in_training INTEGER DEFAULT 0,
      training_weight REAL DEFAULT NULL,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_insight ON feedback(insight_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_message ON feedback(message_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_training ON feedback(used_in_training);

    CREATE TABLE IF NOT EXISTS training_dataset (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      subject TEXT DEFAULT '',
      snippet TEXT DEFAULT '',
      from_domain TEXT DEFAULT '',
      has_attachment INTEGER DEFAULT 0,
      hour_received INTEGER DEFAULT NULL,
      is_weekend INTEGER DEFAULT 0,
      thread_size INTEGER DEFAULT 1,
      embedding TEXT DEFAULT NULL,
      final_label TEXT DEFAULT NULL,
      final_intent TEXT DEFAULT NULL,
      label_source TEXT NOT NULL,
      training_weight REAL DEFAULT 0.7,
      confirmed_at INTEGER DEFAULT NULL,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_training_user ON training_dataset(user_id);
    CREATE INDEX IF NOT EXISTS idx_training_source ON training_dataset(label_source);
    CREATE INDEX IF NOT EXISTS idx_training_confirmed ON training_dataset(confirmed_at);

    CREATE TABLE IF NOT EXISTS label_vectors (
      id TEXT PRIMARY KEY,
      label_id TEXT NOT NULL UNIQUE,
      label_name TEXT DEFAULT '',
      embedding TEXT NOT NULL,
      embedding_model TEXT DEFAULT NULL,
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_label_vectors_label ON label_vectors(label_id);

    CREATE TABLE IF NOT EXISTS label_candidates (
      id TEXT PRIMARY KEY,
      email_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      label_name TEXT NOT NULL,
      similarity_score REAL NOT NULL,
      label_mode TEXT DEFAULT 'existing',
      stage2_processed_at INTEGER DEFAULT NULL,
      created_at INTEGER DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER DEFAULT (unixepoch('now') * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_lc_email ON label_candidates(email_id);
    CREATE INDEX IF NOT EXISTS idx_lc_label ON label_candidates(label_id);
    CREATE INDEX IF NOT EXISTS idx_lc_score ON label_candidates(similarity_score);
  `);
}

/**
 * Migration v2: Add label_name column to label_vectors
 */
function migration_v2(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(label_vectors)").all() as any[];
    const hasLabelName = tableInfo.some((col) => col.name === "label_name");

    if (!hasLabelName) {
      db.exec("ALTER TABLE label_vectors ADD COLUMN label_name TEXT DEFAULT ''");
      logger.info("Added label_name column to label_vectors table");
    }
  } catch (error) {
    logger.info("Migration v2 failed (non-critical):", error);
  }
}

/**
 * Migration v3: Add background sync tray fields to sync_checkpoints
 */
function migration_v3(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(sync_checkpoints)").all() as any[];
    
    if (!tableInfo.some((col) => col.name === "sync_interval_minutes")) {
      db.exec("ALTER TABLE sync_checkpoints ADD COLUMN sync_interval_minutes INTEGER DEFAULT 180");
    }
    if (!tableInfo.some((col) => col.name === "emails_processed_last_sync")) {
      db.exec("ALTER TABLE sync_checkpoints ADD COLUMN emails_processed_last_sync INTEGER DEFAULT 0");
    }
    if (!tableInfo.some((col) => col.name === "last_sync_email_count")) {
      db.exec("ALTER TABLE sync_checkpoints ADD COLUMN last_sync_email_count INTEGER DEFAULT 0");
    }
    
    logger.info("Added background sync fields to sync_checkpoints table");
  } catch (error) {
    logger.info("Migration v3 failed (non-critical):", error);
  }
}

/**
 * Migration v4: Add is_active column to accounts table
 */
function migration_v4(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(accounts)").all() as any[];
    if (!tableInfo.some((col) => col.name === "is_active")) {
      db.exec("ALTER TABLE accounts ADD COLUMN is_active INTEGER DEFAULT 0");
      logger.info("Added is_active column to accounts table");
    }
  } catch (error) {
    logger.info("Migration v4 failed (non-critical):", error);
  }
}

/**
 * Migration v5: Add is_completed column to insights table
 */
function migration_v5(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(insights)").all() as any[];
    if (!tableInfo.some((col) => col.name === "is_completed")) {
      db.exec("ALTER TABLE insights ADD COLUMN is_completed INTEGER DEFAULT 0");
      logger.info("Added is_completed column to insights table");
    }
  } catch (error) {
    logger.info("Migration v5 failed (non-critical):", error);
  }
}

/**
 * Migration v6: Add track folder fields to insights table
 */
function migration_v6(db: Database.Database): void {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(insights)").all() as any[];
    if (!tableInfo.some((col) => col.name === "is_tracked")) {
      db.exec("ALTER TABLE insights ADD COLUMN is_tracked INTEGER DEFAULT 0");
    }
    if (!tableInfo.some((col) => col.name === "tracking_note")) {
      db.exec("ALTER TABLE insights ADD COLUMN tracking_note TEXT DEFAULT NULL");
    }
    if (!tableInfo.some((col) => col.name === "tracked_at")) {
      db.exec("ALTER TABLE insights ADD COLUMN tracked_at INTEGER DEFAULT NULL");
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_tracked ON insights(is_tracked, tracked_at)`);
    logger.info("Added track folder fields to insights table");
  } catch (error) {
    logger.info("Migration v6 failed (non-critical):", error);
  }
}

/**
 * Migration v7: Purge rows left behind by accounts that were removed.
 *
 * Until now, pruning a stale account deleted only its row in `accounts`,
 * orphaning everything keyed to it. Those orphans kept feeding notifications
 * for accounts the user had already disconnected, and left checkpoints the AI
 * worker could not resolve ("Gmail account not found"). The prune now calls
 * purgeAccountData, but existing installs still carry the debris — this clears
 * it once.
 *
 * Guarded on `accounts` being non-empty: an empty table means either a fresh
 * install (nothing to orphan) or a database whose accounts have not been
 * populated yet, and deleting every row on that signal would wipe real data.
 */
function migration_v7(db: Database.Database): void {
  try {
    const accountCount = (
      db.prepare("SELECT COUNT(*) AS c FROM accounts").get() as { c: number }
    ).c;

    if (accountCount === 0) {
      logger.info("Migration v7: no accounts present, skipping orphan purge");
      return;
    }

    const tables = [
      "insights",
      "email_messages",
      "processed_email_log",
      "feedback",
      "sync_checkpoints",
    ];

    const tx = db.transaction(() => {
      let total = 0;
      for (const table of tables) {
        const { changes } = db
          .prepare(
            `DELETE FROM ${table}
              WHERE account_id IS NOT NULL
                AND account_id NOT IN (SELECT id FROM accounts)`
          )
          .run();
        if (changes > 0) {
          logger.info(`Migration v7: removed ${changes} orphaned row(s) from ${table}`);
          total += changes;
        }
      }
      logger.info(`Migration v7: purged ${total} orphaned row(s) in total`);
    });

    tx();
  } catch (error) {
    logger.info("Migration v7 failed (non-critical):", error);
  }
}
