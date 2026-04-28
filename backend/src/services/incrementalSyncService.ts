/**
 * IncrementalSyncService
 * Handles incremental email syncing with deduplication and history tracking
 * Supports multiple sync strategies: historyId (preferred) → timestamp → full scan
 * Uses atomic locking to prevent concurrent syncs
 * Reuses existing AI pipeline for deep processing
 */

import { google } from "googleapis";
import crypto from "crypto";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";
import * as processedEmailLogRepository from "../db/repositories/processedEmailLogRepository";
import * as emailMessageRepository from "../db/repositories/emailMessageRepository";
import { GmailAccount } from "../model/GmailAccount";
import { Label } from "../model/Label";
import { UserIntentProfile } from "../model/UserIntentProfile";
import rulesEngine, { EmailMetadata } from "./rulesEngine";
import { processEmailDeep } from "./emailProcessingService";
import { refreshAccessToken } from "./gmailAuth";
import { createOAuthClient } from "../utils/createOAuth";
import classifyError from "./errorClassifier";
import {
  AI_LABEL_SUGGESTION_MIN_MATCHES,
  getAssignableLabels,
  normalizeAIClassification,
  recordSuggestedLabel,
} from "./labelLifecycleService";
import { computeBaseScore, getPriorityScoringContext } from "./focusBoardService";

import logger from '../utils/logger';

const SYNC_LOCK_TIMEOUT = process.env.SYNC_LOCK_TIMEOUT  ? parseInt(process.env.SYNC_LOCK_TIMEOUT): 3 * 60 * 1000;
const TEST_MODE = true; // Set to false for production
const MAX_EMAILS_TEST_MODE = 1;
const MAX_FETCH_TEST_MODE = 50; // cap fetched candidate messages in test mode
const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 5;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Safely parse various date formats produced by AI: ISO strings, numeric strings,
 * epoch seconds, or milliseconds. Returns Date or null if unparseable.
 */
const safeParseDate = (val: any): Date | null => {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
    // seconds vs milliseconds heuristic
    if (val.toString().length <= 10) return new Date(val * 1000);
    return new Date(val);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (trimmed.length <= 10) return new Date(n * 1000);
      return new Date(n);
    }
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) return new Date(parsed);
  }
  return null;
};

export interface SyncResult {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  expired: number;
  errors: Array<{ messageId: string; reason: string }>;
  newHistoryId?: string;
  message?: string;
}

export type EmailSource = "historyId" | "timestamp" | "fullScan";
type SyncProgressStage =
  | "initializing"
  | "auth_setup"
  | "fetch_candidates"
  | "metadata_filtering"
  | "scoring_emails"
  | "processing_emails"
  | "finalizing"
  | "completed"
  | "error";

interface SyncProgressPatch {
  progressPercent?: number;
  progressStage?: SyncProgressStage;
  progressMessage?: string | null;
  totalCandidates?: number;
  processedCandidates?: number;
}

export class IncrementalSyncService {
  private clampPercent(val: number): number {
    return Math.max(0, Math.min(100, Math.floor(val)));
  }

  private async updateProgress(
    accountId: string | any,
    patch: SyncProgressPatch
  ): Promise<void> {
    const progressPercent =
      typeof patch.progressPercent === "number"
        ? this.clampPercent(patch.progressPercent)
        : undefined;
    syncCheckpointRepository.updateProgress(String(accountId), {
      progress_percent: progressPercent,
      progress_stage: patch.progressStage,
      progress_message: patch.progressMessage,
      total_candidates: patch.totalCandidates,
      processed_candidates: patch.processedCandidates,
      last_progress_at: Date.now(),
    });
  }

  private toCheckpointShape(row: syncCheckpointRepository.SyncCheckpointRow) {
    return {
      lastHistoryId: row.last_history_id || undefined,
      lastSyncTimestamp:
        typeof row.last_sync_timestamp === "number"
          ? new Date(row.last_sync_timestamp)
          : undefined,
    };
  }

  /**
   * Determine which sync strategy to use
   * Returns: "historyId" | "timestamp" | "fullScan"
   */
  private determineEmailSource(checkpoint: {
    lastHistoryId?: string;
    lastSyncTimestamp?: Date;
  }): EmailSource {
    if (checkpoint.lastHistoryId) {
      return "historyId";
    }
    if (checkpoint.lastSyncTimestamp) {
      return "timestamp";
    }
    return "fullScan";
  }

  /**
   * Fetch emails using Gmail History API (most efficient)
   * Returns new/modified messages since historyId
   */
  private async fetchEmailsByHistoryId(
    gmail: any,
    historyId: string
  ): Promise<{ emails: any[]; newHistoryId: string }> {
    try {
      const response: any = await gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId,
        historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
      });

      const emails: any[] = [];
      const newHistoryId = response.data.historyId || historyId;

      if (response.data.history) {
        for (const history of response.data.history) {
          if (history.messages) {
            emails.push(...history.messages);
          }
        }
      }

      logger.debug(
        `[SYNC] Fetched ${emails.length} emails via historyId: ${historyId}`
      );
      return { emails, newHistoryId };
    } catch (error: any) {
      logger.debug(
        `[SYNC] historyId fetch failed (${error.message}), will fallback to timestamp`
      );
      throw error;
    }
  }

  /**
   * Fetch emails using timestamp-based query (fallback)
   * Returns emails where internalDate > lastSyncTimestamp
   */
  private async fetchEmailsSinceTimestamp(
    gmail: any,
    lastSyncTimestamp: Date
  ): Promise<any[]> {
    try {
      const afterTimestamp = Math.floor(lastSyncTimestamp.getTime() / 1000);
      const query = `after:${afterTimestamp}`;

      const response: any = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 100,
      });

      const emails = response.data.messages || [];
      logger.debug(
        `[SYNC] Fetched ${emails.length} emails since timestamp: ${lastSyncTimestamp}`
      );
      return emails;
    } catch (error: any) {
      logger.debug(
        `[SYNC] Timestamp fetch failed (${error.message}), will do full scan`
      );
      throw error;
    }
  }

  /**
   * Full scan: fetch all emails (first-time sync or recovery)
   */
  private async fetchAllEmails(gmail: any): Promise<any[]> {
    try {
      const emails: any[] = [];
      let pageToken: string | undefined = undefined;

      // Fetch all pages (with limit to prevent runaway)
      for (let page = 0; page < 10; page++) {
        const response: any = await gmail.users.messages.list({
          userId: "me",
          maxResults: 100,
          pageToken,
        });

        const messages = response.data.messages || [];
        emails.push(...messages);

        if (!response.data.nextPageToken) {
          break;
        }
        pageToken = response.data.nextPageToken;
      }

      logger.debug(`[SYNC] Full scan: fetched ${emails.length} emails`);
      return emails;
    } catch (error: any) {
      logger.info(`[SYNC] Full scan failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch full email metadata (labels, hasAttachments, from, subject, snippet)
   */
  private async fetchEmailMetadata(
    gmail: any,
    messageId: string
  ): Promise<EmailMetadata> {
    await delay(50); // Rate limiting

    try {
      const response: any = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });

      const headers = response.data.payload?.headers || [];
      const from = headers.find((h: any) => h.name === "From")?.value || "";
      const subject = headers.find((h: any) => h.name === "Subject")?.value || "";
      const hasAttachments = (response.data.payload?.parts || []).some(
        (part: any) => part.filename && part.filename !== ""
      );
      const labels = response.data.labelIds || [];

      return {
        messageId,
        threadId: response.data.threadId,
        from,
        subject,
        snippet: response.data.snippet || "",
        internalDate: response.data.internalDate,
        hasAttachments,
        labels,
      };
    } catch (error: any) {
      logger.info(
        `[SYNC] Failed to fetch metadata for ${messageId}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Check if email should be deep processed
   * Returns true if: email is new OR stateHash changed
   */
  private async shouldDeepProcess(
    accountId: string,
    messageId: string,
    currentStateHash: string
  ): Promise<boolean> {
    const existing = processedEmailLogRepository.findByMessageId(accountId, messageId);

    // New email: always process
    if (!existing) {
      return true;
    }

    // Existing email: process if stateHash changed
    return existing.previous_state_hash !== currentStateHash;
  }

  /**
   * Deep process email: fetch full body and extract insights using AI
   * Reuses existing emailProcessingService.processEmailDeep
   */
  private async deepProcessing(
    gmail: any,
    messageId: string,
    threadId: string,
    metadata: EmailMetadata,
    relevantLabels: Array<{ name: string; description?: string }> = []
  ): Promise<any> {
    return processEmailDeep(
      gmail,
      messageId,
      threadId,
      metadata.internalDate,
      {
        from: metadata.from,
        subject: metadata.subject,
        snippet: metadata.snippet,
      },
      relevantLabels
    );
  }

  /**
   * Acquire atomic lock to prevent concurrent syncs
   * Returns true if lock acquired, false if another sync is running
   */
  private async acquireSyncLock(accountId: string): Promise<boolean> {
    syncCheckpointRepository.resetStaleSyncLock(
      accountId,
      Date.now() - SYNC_LOCK_TIMEOUT
    );

    return syncCheckpointRepository.acquireSyncLock(accountId, {
      progress_percent: 2,
      progress_stage: "initializing",
      progress_message: "Initializing sync...",
      total_candidates: 0,
      processed_candidates: 0,
      last_progress_at: Date.now(),
    });
  }

  /**
   * Release sync lock
   */
  private async releaseSyncLock(
    accountId: string,
    newHistoryId: string | null,
    timestamp: Date,
    stats: { processed: number; succeeded: number; failed: number },
    error?: string
  ): Promise<void> {
    const isError = Boolean(error);
    syncCheckpointRepository.finalizeSync(accountId, {
      sync_state: isError ? "error" : "idle",
      last_history_id: newHistoryId,
      last_sync_timestamp: timestamp.getTime(),
      processed_count: stats.processed,
      succeeded_count: stats.succeeded,
      failed_count: stats.failed,
      last_sync_error: error || null,
      sync_started_at: null,
      progress_percent: isError ? 99 : 100,
      progress_stage: isError ? "error" : "completed",
      progress_message: isError ? error! : "Sync complete",
      total_candidates: stats.processed,
      processed_candidates: stats.processed,
      last_progress_at: Date.now(),
    });
  }

  /**
   * Main sync entry point
   * Handles: first-time sync, incremental sync, error recovery
   */
  async sync(accountId: string, keepLock: boolean = false): Promise<SyncResult> {
    const errors: Array<{ messageId: string; reason: string }> = [];
    const objectIdAccountId = new (require("mongoose").Types.ObjectId)(
      accountId
    );
    const normalizedAccountId = String(objectIdAccountId);

    try {
      // ===== STEP 1: Ensure checkpoint record exists =====
      // If this is the first time we're syncing for this account there will be
      // no SyncCheckpoint document yet.  We need an "idle" record so that the
      // subsequent atomic lock acquisition can succeed.  Previously the code
      // only created a checkpoint *after* trying to acquire the lock which
      // meant the first sync would always fail with "Another sync is already
      // running" and the document would never be created.
      const checkpoint = this.toCheckpointShape(
        syncCheckpointRepository.findOrCreate(normalizedAccountId)
      );

      // ===== STEP 2: Acquire Lock =====
      const lockAcquired = await this.acquireSyncLock(normalizedAccountId);
      if (!lockAcquired) {
        return {
          success: false,
          processed: 0,
          succeeded: 0,
          failed: 0,
          expired: 0,
          errors: [
            { messageId: "", reason: "Another sync is already running" },
          ],
          message: "Sync already in progress",
        };
      }

      await this.updateProgress(normalizedAccountId, {
        progressPercent: 10,
        progressStage: "auth_setup",
        progressMessage: "Authenticating Gmail access...",
      });

      // ===== STEP 3: Setup OAuth & Gmail API =====
      const gmailAccount = await GmailAccount.findUnique({
        where: { id: accountId },
      });
      if (!gmailAccount) {
        throw new Error("Gmail account not found");
      }

      const oauth2Client = createOAuthClient();

      const isExpired =
        gmailAccount.tokenExpiry &&
        Date.now() >=
          (typeof gmailAccount.tokenExpiry === "number"
            ? gmailAccount.tokenExpiry
            : gmailAccount.tokenExpiry.getTime()) -
            60_000;

      if (isExpired && gmailAccount.refreshToken) {
        const tokens = await refreshAccessToken(
          gmailAccount.emailAddress,
          oauth2Client
        );
        oauth2Client.setCredentials(tokens);
        await GmailAccount.update({
          where: { id: gmailAccount.id },
          data: {
            accessToken: tokens.access_token,
            tokenExpiry: tokens.expiry_date,
          },
        });
      } else {
        oauth2Client.setCredentials({
          access_token: gmailAccount.accessToken,
          refresh_token: gmailAccount.refreshToken,
          expiry_date:
            typeof gmailAccount.tokenExpiry === "number"
              ? gmailAccount.tokenExpiry
              : gmailAccount.tokenExpiry?.getTime(),
        });
      }

      const assignableLabels = await getAssignableLabels(
        gmailAccount.userId,
        normalizedAccountId
      );

      const labelCandidates = assignableLabels.map((label) => ({
        name: label.name,
        description: label.description || "",
      }));
      const priorityScoringContext = await getPriorityScoringContext({
        userId: gmailAccount.userId,
        accountId: normalizedAccountId,
      });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // ===== RETRY CANDIDATES MOVED TO ASYNC AI WORKER =====
      // The synchronous AI processing retry block has been removed from the fetch step 
      // and delegated to the standalone AI Processing Worker.

      // ===== STEP 4: Determine Sync Strategy & Fetch Candidates =====
      const emailSource = this.determineEmailSource(checkpoint);
      let candidates: any[] = [];
      let newHistoryId: string | null = null;

      await this.updateProgress(normalizedAccountId, {
        progressPercent: 25,
        progressStage: "fetch_candidates",
        progressMessage: "Fetching candidate emails...",
      });

      logger.debug(`[SYNC] Using strategy: ${emailSource}`);

      try {
        if (emailSource === "historyId") {
          const result = await this.fetchEmailsByHistoryId(
            gmail,
            checkpoint.lastHistoryId!
          );
          candidates = result.emails;
          newHistoryId = result.newHistoryId;
        } else if (emailSource === "timestamp") {
          candidates = await this.fetchEmailsSinceTimestamp(
            gmail,
            checkpoint.lastSyncTimestamp!
          );
        } else {
          candidates = await this.fetchAllEmails(gmail);
        }
      } catch (error: any) {
        // Fallback logic: try next strategy
        if (emailSource === "historyId") {
          logger.debug("[SYNC] Falling back to timestamp strategy");
          try {
            if (checkpoint.lastSyncTimestamp) {
              candidates = await this.fetchEmailsSinceTimestamp(
                gmail,
                checkpoint.lastSyncTimestamp
              );
            } else {
              candidates = await this.fetchAllEmails(gmail);
            }
          } catch (fallbackError: any) {
            logger.debug("[SYNC] Timestamp fallback failed, trying full scan");
            candidates = await this.fetchAllEmails(gmail);
          }
        }
      }

      // After a timestamp or fullScan fetch, gmail.users.messages.list does NOT return a
      // historyId. Call getProfile to capture the mailbox's current historyId.
      // This represents "all events up to now are accounted for", so the NEXT
      // sync can use the fast History API instead of a full scan again.
      if (!newHistoryId) {
        try {
          const profileRes = await gmail.users.getProfile({ userId: 'me' });
          newHistoryId = profileRes.data.historyId || null;
          logger.debug(`[SYNC] Captured current historyId from profile: ${newHistoryId}`);
        } catch (profileErr: any) {
          logger.info(`[SYNC] Could not fetch mailbox historyId from profile: ${profileErr.message}`);
        }
      }

      // TEST_MODE: limit fetched candidate set to avoid heavy fetches

      if (TEST_MODE && candidates.length > MAX_FETCH_TEST_MODE) {
        logger.debug(
          `[SYNC] TEST_MODE fetch cap: limiting fetched candidates ${candidates.length} -> ${MAX_FETCH_TEST_MODE}`
        );
        candidates = candidates.slice(0, MAX_FETCH_TEST_MODE);
      }

      if (candidates.length === 0) {
        logger.debug("[SYNC] No new emails found");
        await this.releaseSyncLock(
          normalizedAccountId,
          newHistoryId,
          new Date(),
          { processed: 0, succeeded: 0, failed: 0 }
        );
        return {
          success: true,
          processed: 0,
          succeeded: 0,
          failed: 0,
          expired: 0,
          errors: [],
          message: "No new emails",
        };
      }

      // ===== STEP 5: Fetch Metadata & Apply Rules =====
      const metadataList: EmailMetadata[] = [];
      for (const candidate of candidates) {
        try {
          const metadata = await this.fetchEmailMetadata(gmail, candidate.id);
          metadataList.push(metadata);
        } catch (error) {
          errors.push({
            messageId: candidate.id,
            reason: "Failed to fetch metadata",
          });
        }
      }

      // We no longer filter emails before staging them.
      // All fetched metadata is inserted into EmailMessage for the async 
      // Scoring Worker to evaluate against the UserIntentProfile.
      
      // Limit emails in test mode
      const emailsToProcess = TEST_MODE
        ? metadataList.slice(0, MAX_EMAILS_TEST_MODE)
        : metadataList;

      await this.updateProgress(normalizedAccountId, {
        progressPercent: 40,
        progressStage: "metadata_filtering",
        progressMessage: "Applying metadata filters...",
        totalCandidates: emailsToProcess.length,
        processedCandidates: 0,
      });

      if (TEST_MODE && emailsToProcess.length > MAX_EMAILS_TEST_MODE) {
        logger.debug(
          `[SYNC] TEST_MODE active: limiting to ${MAX_EMAILS_TEST_MODE} emails (${emailsToProcess.length} total available)`
        );
      }

      // ===== STEP 6: Process Each Email =====
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      const totalToProcess = emailsToProcess.length;

      const profile = await UserIntentProfile.findUnique({
        where: { userId: gmailAccount.userId },
      });
      const preferences = {
        includeKeywords: profile?.includeKeywords || [],
        preferredDomains: profile?.preferredDomains || [],
        excludeKeywords: profile?.excludeKeywords || [],
        blockedDomains: profile?.blockedDomains || [],
      };

      for (const email of emailsToProcess) {
        processed++;
        if (totalToProcess > 0 && (processed % 5 === 0 || processed === totalToProcess)) {
           const ratio = processed / totalToProcess;
           await this.updateProgress(normalizedAccountId, {
             progressPercent: 40 + Math.floor(ratio * 55),
             progressStage: "processing_emails",
             progressMessage: "Saving features directly to staging...",
             totalCandidates: totalToProcess,
             processedCandidates: processed,
           });
        }
        try {
           const filterResult = rulesEngine.shouldProcessEmail(email, preferences);
           
           if (!filterResult.process) {
             logger.debug(`[SYNC] Stage 1 skip: ${email.messageId} - ${filterResult.reason}`);
             // // continue; // Skip staging this email
           }

           const relevantLabels = rulesEngine.getRelevantLabels(
              `${email.subject}\n${email.snippet}`,
              labelCandidates
           );

           emailMessageRepository.upsertMessage({
             user_id: gmailAccount.userId,
             account_id: normalizedAccountId,
             message_id: email.messageId,
             thread_id: email.threadId || email.messageId,
             from: email.from,
             subject: email.subject,
             snippet: email.snippet,
             internal_date: parseInt(email.internalDate) || 0,
             has_attachments: email.hasAttachments ? 1 : 0,
             extracted_features: JSON.stringify(relevantLabels.map(l => l.name)),
             score: null,
             ai_processed: 0,
             priority_state: 'pending',
             embedding: null,
             embedding_model: null,
           });
           
           succeeded++;
        } catch (error: any) {
          logger.info(`[SYNC] Error saving staging email ${email.messageId}: ${error.message}`);
          failed++;
          errors.push({ messageId: email.messageId, reason: error.message });
        }
      }

      // ===== STEP 7: Release Lock & Update Checkpoint =====
      if (keepLock) {
        if (newHistoryId) {
          syncCheckpointRepository.updateCheckpoint(normalizedAccountId, newHistoryId, Date.now());
        }
        await this.updateProgress(normalizedAccountId, {
          progressPercent: 99,
          progressStage: "finalizing",
          progressMessage: "Staging complete, background workers starting...",
          totalCandidates: totalToProcess,
          processedCandidates: processed,
        });
      } else {
        await this.updateProgress(normalizedAccountId, {
          progressPercent: 99,
          progressStage: "finalizing",
          progressMessage: "Finalizing sync...",
          totalCandidates: totalToProcess,
          processedCandidates: processed,
        });

        await this.releaseSyncLock(
          normalizedAccountId,
          newHistoryId,
          new Date(),
          { processed, succeeded, failed }
        );
      }

      logger.debug(
        `[SYNC] Complete: processed=${processed}, succeeded=${succeeded}, failed=${failed}`
      );

      return {
        success: true,
        processed,
        succeeded,
        failed,
        expired: 0, // Cleanup not part of sync
        errors: errors.length > 0 ? errors : [],
        newHistoryId: newHistoryId || undefined,
      };
    } catch (error: any) {
      logger.info("[SYNC] Fatal error:", error.message);
      await this.releaseSyncLock(
        normalizedAccountId,
        null,
        new Date(),
        { processed: 0, succeeded: 0, failed: 0 },
        error.message
      ).catch((e) =>
        logger.info("[SYNC] Failed to release lock:", e.message)
      );

      return {
        success: false,
        processed: 0,
        succeeded: 0,
        failed: 0,
        expired: 0,
        errors: [{ messageId: "", reason: error.message }],
        message: "Sync failed",
      };
    }
  }
}

export default new IncrementalSyncService();


