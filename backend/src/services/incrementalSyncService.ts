/**
 * IncrementalSyncService
 * Handles incremental email syncing with deduplication and history tracking
 * Supports multiple sync strategies: historyId (preferred) → timestamp → full scan
 * Uses atomic locking to prevent concurrent syncs
 * Reuses existing AI pipeline for deep processing
 */

import { google } from "googleapis";
import crypto from "crypto";
import { SyncCheckpointModel, ISyncCheckpoint } from "../model/SyncCheckpoint";
import { ProcessedEmailLogModel } from "../model/ProcessedEmailLog";
import { GmailAccountModel } from "../model/GmailAccount";
import { InsightModel } from "../model/Insight";
import rulesEngine, { EmailMetadata } from "./rulesEngine";
import { processEmailDeep } from "./emailProcessingService";
import { refreshAccessToken } from "./gmailAuth";
import { createOAuthClient } from "../utils/createOAuth";

const SYNC_LOCK_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export class IncrementalSyncService {
  /**
   * Compute state hash from email metadata
   * Used to detect changes in labels, attachments, from field
   */
  private computeStateHash(metadata: any): string {
    const stateObject = {
      labels: (metadata.labels || []).sort(),
      hasAttachments: metadata.hasAttachments || false,
      from: metadata.from || "",
    };

    const jsonStr = JSON.stringify(stateObject);
    return crypto.createHash("sha256").update(jsonStr).digest("hex");
  }

  /**
   * Determine which sync strategy to use
   * Returns: "historyId" | "timestamp" | "fullScan"
   */
  private determineEmailSource(checkpoint: ISyncCheckpoint | null): EmailSource {
    if (checkpoint?.lastHistoryId) {
      return "historyId";
    }
    if (checkpoint?.lastSyncTimestamp) {
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

      console.log(
        `[SYNC] Fetched ${emails.length} emails via historyId: ${historyId}`
      );
      return { emails, newHistoryId };
    } catch (error: any) {
      console.warn(
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
      console.log(
        `[SYNC] Fetched ${emails.length} emails since timestamp: ${lastSyncTimestamp}`
      );
      return emails;
    } catch (error: any) {
      console.warn(
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

      console.log(`[SYNC] Full scan: fetched ${emails.length} emails`);
      return emails;
    } catch (error: any) {
      console.error(`[SYNC] Full scan failed: ${error.message}`);
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
      console.error(
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
    const existing = await ProcessedEmailLogModel.findOne({
      accountId,
      messageId,
    });

    // New email: always process
    if (!existing) {
      return true;
    }

    // Existing email: process if stateHash changed
    return existing.previousStateHash !== currentStateHash;
  }

  /**
   * Deep process email: fetch full body and extract insights using AI
   * Reuses existing emailProcessingService.processEmailDeep
   */
  private async deepProcessing(
    gmail: any,
    messageId: string,
    threadId: string,
    metadata: EmailMetadata
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
      }
    );
  }

  /**
   * Acquire atomic lock to prevent concurrent syncs
   * Returns true if lock acquired, false if another sync is running
   */
  private async acquireSyncLock(accountId: string): Promise<boolean> {
    // First, clean up stale locks (older than SYNC_LOCK_TIMEOUT)
    const staleThreshold = new Date(Date.now() - SYNC_LOCK_TIMEOUT);
    await SyncCheckpointModel.updateMany(
      {
        accountId,
        syncState: "syncing",
        syncStartedAt: { $lt: staleThreshold },
      },
      { $set: { syncState: "idle", syncStartedAt: null } }
    );

    // Attempt atomic update: only succeeds if current state is "idle"
    const result = await SyncCheckpointModel.updateOne(
      { accountId, syncState: "idle" },
      {
        $set: {
          syncState: "syncing",
          syncStartedAt: new Date(),
          lastSyncError: null,
        },
      }
    );

    return result.modifiedCount > 0;
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
    await SyncCheckpointModel.updateOne(
      { accountId },
      {
        $set: {
          syncState: error ? "error" : "idle",
          lastHistoryId: newHistoryId,
          lastSyncTimestamp: timestamp,
          processedCount: stats.processed,
          succeededCount: stats.succeeded,
          failedCount: stats.failed,
          lastSyncError: error || null,
          syncStartedAt: null,
        },
      }
    );
  }

  /**
   * Main sync entry point
   * Handles: first-time sync, incremental sync, error recovery
   */
  async sync(accountId: string): Promise<SyncResult> {
    const errors: Array<{ messageId: string; reason: string }> = [];
    const objectIdAccountId = new (require("mongoose").Types.ObjectId)(
      accountId
    );

    try {
      // ===== STEP 1: Acquire Lock =====
      const lockAcquired = await this.acquireSyncLock(objectIdAccountId);
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

      // ===== STEP 2: Setup OAuth & Gmail API =====
      const gmailAccount = await GmailAccountModel.findById(accountId);
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
        await GmailAccountModel.updateOne(
          { _id: gmailAccount._id },
          {
            $set: {
              accessToken: tokens.access_token,
              tokenExpiry: tokens.expiry_date,
            },
          }
        );
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

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // ===== STEP 3: Get or Create SyncCheckpoint =====
      let checkpoint = await SyncCheckpointModel.findOne({
        accountId: objectIdAccountId,
      });
      if (!checkpoint) {
        checkpoint = await SyncCheckpointModel.create({
          accountId: objectIdAccountId,
          syncState: "idle",
        });
      }

      // ===== STEP 4: Determine Sync Strategy & Fetch Candidates =====
      const emailSource = this.determineEmailSource(checkpoint);
      let candidates: any[] = [];
      let newHistoryId: string | null = null;

      console.log(`[SYNC] Using strategy: ${emailSource}`);

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
          console.log("[SYNC] Falling back to timestamp strategy");
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
            console.log("[SYNC] Timestamp fallback failed, trying full scan");
            candidates = await this.fetchAllEmails(gmail);
          }
        }
      }

      if (candidates.length === 0) {
        console.log("[SYNC] No new emails found");
        await this.releaseSyncLock(
          objectIdAccountId,
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

      const filteredEmails = rulesEngine.applyRulesAndRelevance(metadataList);
      console.log(
        `[SYNC] Filtered: ${metadataList.length} → ${filteredEmails.length}`
      );

      // ===== STEP 6: Process Each Email =====
      let processed = 0;
      let succeeded = 0;
      let failed = 0;

      for (const email of filteredEmails) {
        processed++;
        try {
          // Compute current state hash
          const stateHash = this.computeStateHash(email);

          // Check if should deep process
          const shouldProcess = await this.shouldDeepProcess(
            accountId,
            email.messageId,
            stateHash
          );

          let insight: any = null;

          if (shouldProcess) {
            // Deep process: fetch full body and extract insights
            const deepResult = await this.deepProcessing(
              gmail,
              email.messageId,
              email.threadId,
              email
            );

            // Upsert Insight
            const insightData = {
              userId: gmailAccount.userId,
              accountId: objectIdAccountId,
              gmailThreadId: email.threadId,
              emailIds: [email.messageId],
              from: deepResult.from,
              labels: deepResult.insights.labels.map((label: string) => ({
                name: label,
              })),
              summary: {
                shortSnippet: deepResult.insights.shortSnippet,
                intent: deepResult.insights.intent,
              },
              dates: deepResult.insights.dates.map((d: any) => ({
                type: d.type,
                date: new Date(d.date),
                sourceEmailId: email.messageId,
              })),
              attachments: deepResult.attachmentMetadata,
              extractedFacts: deepResult.insights.extractedFacts,
              state: {
                relevance: "active",
                firstSeenAt: new Date(),
                lastSignalAt: new Date(),
                lastVerifiedAt: new Date(),
              },
            };

            insight = await InsightModel.findOneAndUpdate(
              {
                userId: gmailAccount.userId,
                gmailThreadId: email.threadId,
              },
              insightData,
              { upsert: true, new: true }
            );
          } else {
            // Metadata-only update: no deep processing needed
            const existing = await ProcessedEmailLogModel.findOne({
              accountId: objectIdAccountId,
              messageId: email.messageId,
            });
            insight = await InsightModel.findById(existing?.insightId);

            if (insight) {
              insight.labels = email.labels?.map((label: string) => ({
                name: label,
              })) || [];
              await insight.save();
            }
          }

          // Upsert ProcessedEmailLog
          if (insight) {
            await ProcessedEmailLogModel.findOneAndUpdate(
              {
                accountId: objectIdAccountId,
                messageId: email.messageId,
              },
              {
                insightId: insight._id,
                threadId: email.threadId,
                previousStateHash: stateHash,
                previousLabels: email.labels,
                internalDate: email.internalDate,
                processedAt: new Date(),
                retryCount: 0,
              },
              { upsert: true }
            );

            succeeded++;
          }
        } catch (error: any) {
          console.error(
            `[SYNC] Error processing ${email.messageId}: ${error.message}`
          );
          failed++;
          errors.push({
            messageId: email.messageId,
            reason: error.message,
          });

          // Track retry count for next sync
          await ProcessedEmailLogModel.findOneAndUpdate(
            {
              accountId: objectIdAccountId,
              messageId: email.messageId,
            },
            {
              $inc: { retryCount: 1 },
              lastRetryAt: new Date(),
              lastErrorMessage: error.message,
            },
            { upsert: true }
          );
        }
      }

      // ===== STEP 7: Release Lock & Update Checkpoint =====
      await this.releaseSyncLock(
        objectIdAccountId,
        newHistoryId,
        new Date(),
        { processed, succeeded, failed }
      );

      console.log(
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
      console.error("[SYNC] Fatal error:", error.message);
      await this.releaseSyncLock(
        objectIdAccountId,
        null,
        new Date(),
        { processed: 0, succeeded: 0, failed: 0 },
        error.message
      ).catch((e) =>
        console.error("[SYNC] Failed to release lock:", e.message)
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
