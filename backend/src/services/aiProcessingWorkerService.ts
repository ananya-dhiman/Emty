import { Types } from "mongoose";
import { google } from "googleapis";
import { EmailMessageModel } from "../model/EmailMessage";
import { SyncCheckpointModel } from "../model/SyncCheckpoint";
import { GmailAccountModel } from "../model/GmailAccount";
import { InsightModel } from "../model/Insight";
import { ProcessedEmailLogModel } from "../model/ProcessedEmailLog";
import { createOAuthClient } from "../utils/createOAuth";
import { refreshAccessToken } from "./gmailAuth";
import { processEmailDeep } from "./emailProcessingService";
import rulesEngine from "./rulesEngine";
import classifyError from "./errorClassifier";
import { 
    getAssignableLabels, 
    normalizeAIClassification, 
    recordSuggestedLabel, 
    AI_LABEL_SUGGESTION_MIN_MATCHES 
} from "./labelLifecycleService";
import { computeBaseScore, getPriorityScoringContext } from "./focusBoardService";

/**
 * AI Processing Worker Service
 * Runs asynchronously after the scoring worker.
 * Processes the top K emails using OpenRouter AI.
 * Strict concurrency management via batching.
 */

const BATCH_SIZE = 1; // Process 1 email at a time to stay under API limits
const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 5;

const safeParseDate = (val: any): Date | null => {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number') {
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

export const runAiProcessingWorker = async (userId: string, accountId: string): Promise<void> => {
    const objectIdAccountId = new Types.ObjectId(accountId);
    console.log(`[AI WORKER] Started for account ${accountId}`);

    // ===== SETUP OAUTH AND GMAIL =====
    const gmailAccount = await GmailAccountModel.findById(accountId);
    if (!gmailAccount) {
        throw new Error("Gmail account not found");
    }

    const oauth2Client = createOAuthClient();
    const isExpired = gmailAccount.tokenExpiry &&
        Date.now() >= (typeof gmailAccount.tokenExpiry === "number" ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry.getTime()) - 60_000;

    if (isExpired && gmailAccount.refreshToken) {
        const tokens = await refreshAccessToken(gmailAccount.emailAddress, oauth2Client);
        oauth2Client.setCredentials(tokens);
        await GmailAccountModel.updateOne(
            { _id: gmailAccount._id },
            { $set: { accessToken: tokens.access_token, tokenExpiry: tokens.expiry_date } }
        );
    } else {
        oauth2Client.setCredentials({
            access_token: gmailAccount.accessToken,
            refresh_token: gmailAccount.refreshToken,
            expiry_date: typeof gmailAccount.tokenExpiry === "number" ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry?.getTime(),
        });
    }

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Ensure we process both 'top' emails that haven't been processed
    // and also respect retry limits for emails that previously failed here.
    const candidates = await EmailMessageModel.find({
        accountId: objectIdAccountId,
        priorityState: 'top',
        aiProcessed: false
    });
    
    if (candidates.length === 0) {
        console.log(`[AI WORKER] No top emails to process for account ${accountId}`);
        await updateProgressComplete(objectIdAccountId);
        return;
    }

    console.log(`[AI WORKER] Found ${candidates.length} emails to process with AI`);

    // Prepare context models
    const assignableLabels = await getAssignableLabels(gmailAccount.userId, accountId);
    const labelCandidates = assignableLabels.map((label) => ({
        name: label.name,
        description: label.description || "",
    }));
    const priorityScoringContext = await getPriorityScoringContext({ userId, accountId });

    let processedCount = 0;
    const totalCount = candidates.length;

    // Process in batches
    for (let i = 0; i < totalCount; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        console.log(`[AI WORKER] Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(totalCount / BATCH_SIZE)}`);

        // Update progress
        const ratio = processedCount / totalCount;
        await SyncCheckpointModel.updateOne(
            { accountId: objectIdAccountId },
            {
                $set: {
                    progressPercent: 60 + Math.floor(ratio * 39), // from 60 to 99
                    progressStage: "ai_processing",
                    progressMessage: `Running AI insights on prioritized emails (${processedCount}/${totalCount})`,
                    lastProgressAt: new Date()
                }
            }
        );

        const promises = batch.map(async (email) => {
            const messageId = email.messageId;
            try {
                // Determine relevant labels based on features (rules engine fallback)
                const relevantLabelsStringList = email.extractedFeatures || [];
                const relevantLabels = labelCandidates.filter(l => relevantLabelsStringList.includes(l.name));
                
                // Fetch full internal date string or default to unix epoch string
                const internalDateStr = email.internalDate ? email.internalDate.getTime().toString() : Date.now().toString();

                const deepResult = await processEmailDeep(
                    gmail,
                    messageId,
                    email.threadId,
                    internalDateStr,
                    {
                        from: email.from,
                        subject: email.subject,
                        snippet: email.snippet,
                    },
                    relevantLabels.length ? relevantLabels : rulesEngine.getRelevantLabels(`${email.subject}\n${email.snippet}`, labelCandidates)
                );

                // Upsert Insight
                const normalizedLabels = normalizeAIClassification(
                    deepResult.insights.labels,
                    deepResult.insights.suggestedLabel || undefined,
                    assignableLabels
                );
                const suggestedLabel = await recordSuggestedLabel({
                    userId,
                    accountId,
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
                    userId,
                    accountId: objectIdAccountId,
                    gmailThreadId: email.threadId,
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
                                    (suggestedLabel.suggestionCount || 0) / AI_LABEL_SUGGESTION_MIN_MATCHES,
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
                        userId,
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

                if (insight) {
                    // Update EmailMessage flag
                    email.aiProcessed = true;
                    await email.save();

                    // Clear any previous error states from ProcessedEmailLog (used for history)
                    await ProcessedEmailLogModel.findOneAndUpdate(
                        { accountId: objectIdAccountId, messageId },
                        {
                            insightId: insight._id,
                            threadId: email.threadId,
                            internalDate: email.internalDate ? email.internalDate.getTime().toString() : Date.now().toString(),
                            processedAt: new Date(),
                            retryCount: 0,
                            lastRetryAt: null,
                            lastErrorMessage: null,
                            errorType: 'none',
                        },
                        { upsert: true }
                    );
                }

            } catch (err: any) {
                console.error(`[AI WORKER] Deep processing failed for ${messageId}:`, err.message || err);
                
                // Handle retries
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
        });

        // Await the batch strictly
        for (const p of promises) {
            await p;
        }
        processedCount += batch.length;

        // RATE LIMIT BUFFER: OpenRouter free models limit to 20 requests/min.
        // If there are more batches left to process, wait 4 seconds to avoid 429s.
        if (i + BATCH_SIZE < totalCount) {
          console.log(`[AI WORKER] Email complete. Sleeping 4s to respect rate limits...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
    }

    // Complete Progress Updates
    await updateProgressComplete(objectIdAccountId);
    console.log(`[AI WORKER] Completed processing for account ${accountId}`);
};

async function updateProgressComplete(accountId: Types.ObjectId) {
    await SyncCheckpointModel.updateOne(
        { accountId },
        {
            $set: {
                progressPercent: 100,
                progressStage: "completed",
                progressMessage: "Sync complete",
                lastProgressAt: new Date(),
                syncState: "idle",
                syncStartedAt: null,
            }
        }
    );
}
