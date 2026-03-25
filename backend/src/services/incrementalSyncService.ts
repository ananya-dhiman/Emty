/**
 * IncrementalSyncService
 * Handles incremental email syncing with deduplication and history tracking
 * Supports multiple sync strategies: historyId (preferred) → timestamp → full scan
 * Uses atomic locking to prevent concurrent syncs
 * Reuses existing AI pipeline for deep processing
 */

import { google } from "googleapis";
import crypto from "crypto";
import {
  SyncCheckpointModel,
  ISyncCheckpoint,
  SyncProgressStage,
} from "../model/SyncCheckpoint";
import { ProcessedEmailLogModel } from "../model/ProcessedEmailLog";
import { GmailAccountModel } from "../model/GmailAccount";
import { InsightModel } from "../model/Insight";
import { LabelModel } from "../model/Label";
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

const SYNC_LOCK_TIMEOUT = process.env.SYNC_LOCK_TIMEOUT  ? parseInt(process.env.SYNC_LOCK_TIMEOUT): 3 * 60 * 1000;
const TEST_MODE = true; // Set to false for production
const MAX_EMAILS_TEST_MODE = 20;
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
    const progressUpdate: Record<string, any> = {
      ...patch,
      lastProgressAt: new Date(),
    };
    if (typeof progressUpdate.progressPercent === "number") {
      progressUpdate.progressPercent = this.clampPercent(
        progressUpdate.progressPercent
      );
    }
    await SyncCheckpointModel.updateOne(
      { accountId },
      {
        $set: progressUpdate,
      }
    );
  }

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
          progressPercent: 2,
          progressStage: "initializing",
          progressMessage: "Initializing sync...",
          totalCandidates: 0,
          processedCandidates: 0,
          lastProgressAt: new Date(),
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
    const setPayload: Record<string, any> = {
      syncState: error ? "error" : "idle",
      lastHistoryId: newHistoryId,
      lastSyncTimestamp: timestamp,
      processedCount: stats.processed,
      succeededCount: stats.succeeded,
      failedCount: stats.failed,
      lastSyncError: error || null,
      syncStartedAt: null,
      lastProgressAt: new Date(),
    };

    if (error) {
      setPayload.progressStage = "error";
      setPayload.progressMessage = error;
    } else {
      setPayload.progressPercent = 100;
      setPayload.progressStage = "completed";
      setPayload.progressMessage = "Sync complete";
      setPayload.totalCandidates = stats.processed;
      setPayload.processedCandidates = stats.processed;
    }

    await SyncCheckpointModel.updateOne(
      { accountId },
      {
        $set: setPayload,
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
      // ===== STEP 1: Ensure checkpoint record exists =====
      // If this is the first time we're syncing for this account there will be
      // no SyncCheckpoint document yet.  We need an "idle" record so that the
      // subsequent atomic lock acquisition can succeed.  Previously the code
      // only created a checkpoint *after* trying to acquire the lock which
      // meant the first sync would always fail with "Another sync is already
      // running" and the document would never be created.
      let checkpoint = await SyncCheckpointModel.findOne({
        accountId: objectIdAccountId,
      });
      if (!checkpoint) {
        checkpoint = await SyncCheckpointModel.create({
          accountId: objectIdAccountId,
          syncState: "idle",
        });
      }

      // ===== STEP 2: Acquire Lock =====
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

      await this.updateProgress(objectIdAccountId, {
        progressPercent: 10,
        progressStage: "auth_setup",
        progressMessage: "Authenticating Gmail access...",
      });

      // ===== STEP 3: Setup OAuth & Gmail API =====
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

      const assignableLabels = await getAssignableLabels(
        gmailAccount.userId,
        objectIdAccountId.toString()
      );

      const labelCandidates = assignableLabels.map((label) => ({
        name: label.name,
        description: label.description || "",
      }));
      const priorityScoringContext = await getPriorityScoringContext({
        userId: gmailAccount.userId,
        accountId: objectIdAccountId.toString(),
      });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // ===== PRIORITY: Process pending retry candidates (DB-driven) =====
      // Find emails from previous syncs that failed but haven't exceeded max retries and aren't permanently failed
      const retryCandidates = await ProcessedEmailLogModel.find({
        accountId: objectIdAccountId,
        retryCount: { $gt: 0 },
        errorType: { $ne: 'permanent' },
      });

      const retriedSet = new Set<string>();
      if (retryCandidates && retryCandidates.length > 0) {
        console.log(`[SYNC] Found ${retryCandidates.length} retry candidates, processing them first`);
        for (const candidate of retryCandidates) {
          const messageId = candidate.messageId;
          try {
            // Fetch metadata and attempt deep processing
            const metadata = await this.fetchEmailMetadata(gmail, messageId);
            const stateHash = this.computeStateHash(metadata);
            const shouldProcess = await this.shouldDeepProcess(accountId, messageId, stateHash);

            if (shouldProcess) {
              const relevantLabels = rulesEngine.getRelevantLabels(
                `${metadata.subject}\n${metadata.snippet}`,
                labelCandidates
              );
              const deepResult = await this.deepProcessing(
                gmail,
                messageId,
                metadata.threadId,
                metadata,
                relevantLabels
              );

              // Upsert Insight (reuse existing logic)
              const normalizedLabels = normalizeAIClassification(
                deepResult.insights.labels,
                deepResult.insights.suggestedLabel || undefined,
                assignableLabels
              );
              const suggestedLabel = await recordSuggestedLabel({
                userId: gmailAccount.userId,
                accountId: objectIdAccountId.toString(),
                suggestionName: normalizedLabels.suggestedLabelName,
                threadId: metadata.threadId,
              });

              const parsedImportanceScore = (deepResult.insights as any)?.importanceScore;
              const boundedImportanceScore =
                typeof parsedImportanceScore === "number"
                  ? Math.max(0, Math.min(parsedImportanceScore, 1))
                  : undefined;
              const baseScoreResult = computeBaseScore({
                importanceScore: boundedImportanceScore,
                labels: normalizedLabels.assignedLabels.map((label: any) => ({
                  labelId: label._id,
                  name: label.name,
                })),
                context: priorityScoringContext,
              });

              const insightData: any = {
                userId: gmailAccount.userId,
                accountId: objectIdAccountId,
                gmailThreadId: metadata.threadId,
                emailIds: [messageId],
                from: deepResult.from,
                labels: normalizedLabels.assignedLabels.map((label) => ({
                  labelId: label._id,
                  name: label.name,
                  source: label.source,
                  statusSnapshot: label.status,
                })),
                labelSuggestions: suggestedLabel && suggestedLabel.status !== "rejected"
                  ? [
                      {
                        labelId: suggestedLabel._id,
                        name: suggestedLabel.name,
                        source: "ai",
                        status: suggestedLabel.status,
                        confidence: Math.min(
                          (suggestedLabel.suggestionCount || 0) /
                            AI_LABEL_SUGGESTION_MIN_MATCHES,
                          1
                        ),
                        generatedAt: new Date(),
                      },
                    ]
                  : [],
                summary: {
                  shortSnippet: deepResult.insights.shortSnippet,
                  intent: deepResult.insights.intent,
                },
                dates: deepResult.insights.dates
                  .map((d: any) => {
                    const parsed = safeParseDate(d.date);
                    if (!parsed) return null;
                    return {
                      type: d.type,
                      date: parsed,
                      sourceEmailId: messageId,
                    };
                  })
                  .filter(Boolean),
                attachments: deepResult.attachmentMetadata,
                extractedFacts: deepResult.insights.extractedFacts,
                state: {
                  relevance: "active",
                  firstSeenAt: new Date(),
                  lastSignalAt: new Date(),
                  lastVerifiedAt: new Date(),
                },
              };
              if (typeof boundedImportanceScore === "number") {
                insightData.importanceScore = boundedImportanceScore;
              }

              const insight = await InsightModel.findOneAndUpdate(
                {
                  userId: gmailAccount.userId,
                  gmailThreadId: metadata.threadId,
                },
                {
                  $set: insightData,
                  $setOnInsert: {
                    baseScore: baseScoreResult.baseScore,
                    baseScoreBreakdown: {
                      importanceNorm: baseScoreResult.importanceNorm,
                      labelNorm: baseScoreResult.labelNorm,
                      matchedLabelRank: baseScoreResult.matchedLabelRank,
                    },
                    baseScoreComputedAt: new Date(),
                  },
                },
                { upsert: true, new: true }
              );

              if (insight) {
                // Clear retry state on successful processing
                await ProcessedEmailLogModel.findOneAndUpdate(
                  { accountId: objectIdAccountId, messageId },
                  {
                    insightId: insight._id,
                    threadId: metadata.threadId,
                    previousStateHash: stateHash,
                    previousLabels: metadata.labels,
                    internalDate: metadata.internalDate,
                    processedAt: new Date(),
                    retryCount: 0,
                    lastRetryAt: null,
                    lastErrorMessage: null,
                    errorType: 'none',
                  },
                  { upsert: true }
                );

                retriedSet.add(messageId);
              }
            }
          } catch (err: any) {
            console.error(`[SYNC] Retry candidate failed for ${messageId}:`, err.message || err);
            // Classification: mark as permanent if errorType is 'permanent' or if retryCount hit max
            const errorType = classifyError(err);
            const existing = await ProcessedEmailLogModel.findOne({ accountId: objectIdAccountId, messageId });
            const newRetryCount = (existing?.retryCount || 0) + 1;
            const isPermanent = errorType === 'permanent' || newRetryCount >= MAX_RETRIES;
            const finalErrorType = isPermanent ? 'permanent' : errorType;

            await ProcessedEmailLogModel.findOneAndUpdate(
              { accountId: objectIdAccountId, messageId },
              {
                retryCount: newRetryCount,
                lastRetryAt: new Date(),
                lastErrorMessage: err.message || String(err),
                errorType: finalErrorType,
              },
              { upsert: true }
            );
          }
        }
      }

   

      // ===== STEP 4: Determine Sync Strategy & Fetch Candidates =====
      const emailSource = this.determineEmailSource(checkpoint);
      let candidates: any[] = [];
      let newHistoryId: string | null = null;

      await this.updateProgress(objectIdAccountId, {
        progressPercent: 25,
        progressStage: "fetch_candidates",
        progressMessage: "Fetching candidate emails...",
      });

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

      // TEST_MODE: limit fetched candidate set to avoid heavy fetches
      if (TEST_MODE && candidates.length > MAX_FETCH_TEST_MODE) {
        console.log(
          `[SYNC] TEST_MODE fetch cap: limiting fetched candidates ${candidates.length} -> ${MAX_FETCH_TEST_MODE}`
        );
        candidates = candidates.slice(0, MAX_FETCH_TEST_MODE);
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

      // Remove any emails we already retried above so we don't double-process
      const filteredWithoutRetried = filteredEmails.filter((e) => !retriedSet.has(e.messageId));

      // Limit emails in test mode
      const emailsToProcess = TEST_MODE
        ? filteredWithoutRetried.slice(0, MAX_EMAILS_TEST_MODE)
        : filteredWithoutRetried;

      await this.updateProgress(objectIdAccountId, {
        progressPercent: 40,
        progressStage: "metadata_filtering",
        progressMessage: "Applying metadata filters...",
        totalCandidates: emailsToProcess.length,
        processedCandidates: 0,
      });

      if (TEST_MODE && filteredWithoutRetried.length > MAX_EMAILS_TEST_MODE) {
        console.log(
          `[SYNC] TEST_MODE active: limiting to ${MAX_EMAILS_TEST_MODE} emails (${filteredWithoutRetried.length} total available)`
        );
      }

      // ===== STEP 6: Process Each Email =====
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      const totalToProcess = emailsToProcess.length;

      for (const email of emailsToProcess) {
        processed++;
        if (totalToProcess > 0 && (processed % 5 === 0 || processed === totalToProcess)) {
          const ratio = processed / totalToProcess;
          await this.updateProgress(objectIdAccountId, {
            progressPercent: 40 + Math.floor(ratio * 55),
            progressStage: "processing_emails",
            progressMessage: "Processing inbox content...",
            totalCandidates: totalToProcess,
            processedCandidates: processed,
          });
        }
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
            const relevantLabels = rulesEngine.getRelevantLabels(
              `${email.subject}\n${email.snippet}`,
              labelCandidates
            );
            const deepResult = await this.deepProcessing(
              gmail,
              email.messageId,
              email.threadId,
              email,
              relevantLabels
            );

            // Upsert Insight
            const normalizedLabels = normalizeAIClassification(
              deepResult.insights.labels,
              deepResult.insights.suggestedLabel || undefined,
              assignableLabels
            );
            const suggestedLabel = await recordSuggestedLabel({
              userId: gmailAccount.userId,
              accountId: objectIdAccountId.toString(),
              suggestionName: normalizedLabels.suggestedLabelName,
              threadId: email.threadId,
            });

            const parsedImportanceScore = (deepResult.insights as any)?.importanceScore;
            const boundedImportanceScore =
              typeof parsedImportanceScore === "number"
                ? Math.max(0, Math.min(parsedImportanceScore, 1))
                : undefined;
            const baseScoreResult = computeBaseScore({
              importanceScore: boundedImportanceScore,
              labels: normalizedLabels.assignedLabels.map((label: any) => ({
                labelId: label._id,
                name: label.name,
              })),
              context: priorityScoringContext,
            });

            const insightData: any = {
              userId: gmailAccount.userId,
              accountId: objectIdAccountId,
              gmailThreadId: email.threadId,
              emailIds: [email.messageId],
              from: deepResult.from,
              labels: normalizedLabels.assignedLabels.map((label) => ({
                labelId: label._id,
                name: label.name,
                source: label.source,
                statusSnapshot: label.status,
              })),
              labelSuggestions: suggestedLabel && suggestedLabel.status !== "rejected"
                ? [
                    {
                      labelId: suggestedLabel._id,
                      name: suggestedLabel.name,
                      source: "ai",
                      status: suggestedLabel.status,
                      confidence: Math.min(
                        (suggestedLabel.suggestionCount || 0) /
                          AI_LABEL_SUGGESTION_MIN_MATCHES,
                        1
                      ),
                      generatedAt: new Date(),
                    },
                  ]
                : [],
              summary: {
                shortSnippet: deepResult.insights.shortSnippet,
                intent: deepResult.insights.intent,
              },
              dates: deepResult.insights.dates
                .map((d: any) => {
                  const parsed = safeParseDate(d.date);
                  if (!parsed) return null;
                  return {
                    type: d.type,
                    date: parsed,
                    sourceEmailId: email.messageId,
                  };
                })
                .filter(Boolean),
              attachments: deepResult.attachmentMetadata,
              extractedFacts: deepResult.insights.extractedFacts,
              state: {
                relevance: "active",
                firstSeenAt: new Date(),
                lastSignalAt: new Date(),
                lastVerifiedAt: new Date(),
              },
            };
            if (typeof boundedImportanceScore === "number") {
              insightData.importanceScore = boundedImportanceScore;
            }

            insight = await InsightModel.findOneAndUpdate(
              {
                userId: gmailAccount.userId,
                gmailThreadId: email.threadId,
              },
              {
                $set: insightData,
                $setOnInsert: {
                  baseScore: baseScoreResult.baseScore,
                  baseScoreBreakdown: {
                    importanceNorm: baseScoreResult.importanceNorm,
                    labelNorm: baseScoreResult.labelNorm,
                    matchedLabelRank: baseScoreResult.matchedLabelRank,
                  },
                  baseScoreComputedAt: new Date(),
                },
              },
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
                source: "system",
                statusSnapshot: "active",
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
                  errorType: 'none',
              },
              { upsert: true }
            );

            succeeded++;
          }
        } catch (error: any) {
          console.error(`[SYNC] Error processing ${email.messageId}: ${error.message}`);
          failed++;
          errors.push({ messageId: email.messageId, reason: error.message });

          // Classification: mark as permanent if errorType is 'permanent' or if retryCount hit max
          const errorType = classifyError(error);
          const existing = await ProcessedEmailLogModel.findOne({ accountId: objectIdAccountId, messageId: email.messageId });
          const newRetryCount = (existing?.retryCount || 0) + 1;
          const isPermanent = errorType === 'permanent' || newRetryCount >= MAX_RETRIES;
          const finalErrorType = isPermanent ? 'permanent' : errorType;

          await ProcessedEmailLogModel.findOneAndUpdate(
            { accountId: objectIdAccountId, messageId: email.messageId },
            {
              retryCount: newRetryCount,
              lastRetryAt: new Date(),
              lastErrorMessage: error.message,
              errorType: finalErrorType,
            },
            { upsert: true }
          );
        }
      }

      // ===== STEP 7: Release Lock & Update Checkpoint =====
      await this.updateProgress(objectIdAccountId, {
        progressPercent: 99,
        progressStage: "finalizing",
        progressMessage: "Finalizing sync...",
        totalCandidates: totalToProcess,
        processedCandidates: processed,
      });

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
