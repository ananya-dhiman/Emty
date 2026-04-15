import { Types } from "mongoose";
import { google } from "googleapis";
import { GmailAccount } from "../model/GmailAccount";
import { createOAuthClient } from "../utils/createOAuth";
import * as emailMessageRepository from "../db/repositories/emailMessageRepository";
import * as insightRepository from "../db/repositories/insightRepository";
import * as processedEmailLogRepository from "../db/repositories/processedEmailLogRepository";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";
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
import { resolveAIContextForUser } from "./aiProviderService";
import logger from '../utils/logger';

/**
 * AI Processing Worker Service
 * Runs asynchronously after the scoring worker.
 * Processes the top K emails using the local Ollama model.
 * Strict concurrency management via batching.
 */

const BATCH_SIZE = 1; // Process 1 email at a time to stay under API limits
const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 5;
const MAX_EMAILS_PER_THREAD = 50;
const MIN_AI_SCORE = 0.4;

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
    logger.debug(`[AI WORKER] Started for account ${accountId}`);

    // ===== SETUP OAUTH AND GMAIL =====
    const gmailAccount = await GmailAccount.findUnique({ where: { id: accountId } });
    if (!gmailAccount) {
        throw new Error("Gmail account not found");
    }

    const oauth2Client = createOAuthClient();
    const isExpired = gmailAccount.tokenExpiry &&
        Date.now() >= (typeof gmailAccount.tokenExpiry === "number" ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry.getTime()) - 60_000;

    if (isExpired && gmailAccount.refreshToken) {
        const tokens = await refreshAccessToken(gmailAccount.emailAddress, oauth2Client);
        oauth2Client.setCredentials(tokens);
        await GmailAccount.update({
            where: { id: gmailAccount.id },
            data: { accessToken: tokens.access_token, tokenExpiry: tokens.expiry_date }
        });
    } else {
        oauth2Client.setCredentials({
            access_token: gmailAccount.accessToken,
            refresh_token: gmailAccount.refreshToken,
            expiry_date: typeof gmailAccount.tokenExpiry === "number" ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry?.getTime(),
        });
    }

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const aiContext = await resolveAIContextForUser(userId);
    logger.debug(
        `[AI WORKER] AI context resolved | provider=${aiContext.preferredProvider} | attempts=${aiContext.attempts.length}`
    );
    logger.debug(
        `[AI WORKER] Provider attempts: ${aiContext.attempts.map(a => `${a.provider}:${a.model}:${a.source}`).join(" -> ")}`
    );

    // Initialize sync checkpoint if needed  
    const syncCheckpoint = syncCheckpointRepository.findOrCreate(accountId);

    // Ensure we process only high-priority emails that are score-qualified.
    const candidates = await emailMessageRepository.findUnprocessed(accountId);
    logger.debug(
        `[AI WORKER] Candidate query applied | priority=top | aiProcessed=false | minScore=${MIN_AI_SCORE}`
    );
    
    if (candidates.length === 0) {
        logger.debug(`[AI WORKER] No top emails to process for account ${accountId}`);
        await updateProgressComplete(accountId);
        return;
    }

    logger.debug(`[AI WORKER] Found ${candidates.length} emails to process with AI`);

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
        logger.debug(`[AI WORKER] Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(totalCount / BATCH_SIZE)}`);

        // Update progress
        const ratio = processedCount / totalCount;
        await syncCheckpointRepository.updateProgress(accountId, {
            progress_percent: 60 + Math.floor(ratio * 39), // from 60 to 99
            progress_stage: "processing_emails",
            progress_message: `Running AI insights on prioritized emails (${processedCount}/${totalCount})`,
        });

        const promises = batch.map(async (email) => {
            const messageId = email.message_id;
            try {
                // Determine relevant labels based on features (rules engine fallback)
                let relevantLabelsStringList: string[] = [];
                try {
                    relevantLabelsStringList = JSON.parse(email.extracted_features || '[]');
                } catch (e) {
                    relevantLabelsStringList = [];
                }
                const relevantLabels = labelCandidates.filter(l => relevantLabelsStringList.includes(l.name));
                
                // Fetch full internal date string or default to unix epoch string
                const internalDateStr = email.internal_date ? email.internal_date.toString() : Date.now().toString();

                const deepResult = await processEmailDeep(
                    gmail,
                    messageId,
                    email.thread_id,
                    internalDateStr,
                    {
                        from: email.from,
                        subject: email.subject,
                        snippet: email.snippet,
                    },
                    relevantLabels.length ? relevantLabels : rulesEngine.getRelevantLabels(`${email.subject}\n${email.snippet}`, labelCandidates),
                    {
                        userId,
                        aiContext,
                        onFallback: async (notice) => {
                            logger.debug(
                                `[AI WORKER] Fallback notice for ${messageId}: ${notice.fromProvider || "user-model"} -> ${notice.toProvider || "shared-model"}`
                            );
                        }
                    }
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
                    threadId: email.thread_id,
                });

                const parsedImportanceScore = (deepResult.insights as any)?.importanceScore;
                const boundedImportanceScore =
                    typeof parsedImportanceScore === "number"
                        ? Math.max(0, Math.min(parsedImportanceScore, 1))
                        : undefined;
                const parsedDates = deepResult.insights.dates
                    .map((d: any) => {
                        const parsed = safeParseDate(d.date);
                        if (!parsed) return null;
                        return {
                            type: d.type,
                            date: parsed,
                        };
                    })
                    .filter(Boolean);
                const parsedChecklist = (Array.isArray(deepResult.insights.checklist) ? deepResult.insights.checklist : [])
                    .map((item: any) => ({
                        task: item?.task,
                        status: "pending" as const,
                        dueDate: safeParseDate(item?.dueDate) || undefined,
                        reason: typeof item?.reason === "string" ? item.reason : undefined,
                        inferred: item?.inferred === true,
                    }))
                    .filter((item: any) => typeof item.task === "string" && item.task.trim().length > 0);
                const parsedImportantLinks = (Array.isArray(deepResult.insights.importantLinks)
                    ? deepResult.insights.importantLinks
                    : []
                )
                    .map((link: any) => ({
                        url: link?.url,
                        label: typeof link?.label === "string" ? link.label : undefined,
                        reason: typeof link?.reason === "string" ? link.reason : undefined,
                        inferred: link?.inferred === true,
                    }))
                    .filter((link: any) => typeof link.url === "string" && link.url.trim().length > 0);

                const emailEntry: any = {
                    messageId,
                    internalDate: new Date(email.internal_date),
                    from: typeof deepResult.from === 'string' ? deepResult.from : deepResult.from?.email || 'unknown',
                    subject: deepResult.subject || email.subject,
                    snippet: email.snippet,
                    labels: normalizedLabels.assignedLabels.map((label: any) => ({
                        labelId: label._id,
                        name: label.name,
                    })),
                    dates: parsedDates,
                    attachments: deepResult.attachmentMetadata.map((a: any) => ({
                        filename: a.filename,
                        mimeType: a.mimeType,
                        size: a.size,
                    })),
                    importantLinks: parsedImportantLinks,
                    checklist: parsedChecklist,
                    extractedFacts: deepResult.insights.extractedFacts,
                    ai: {
                        intent: deepResult.insights.intent,
                        shortSnippet: deepResult.insights.shortSnippet,
                        importanceScore: boundedImportanceScore,
                        processedAt: new Date(),
                    },
                };

                let insight = await insightRepository.findByThreadId(accountId, email.thread_id);

                if (!insight) {
                    const baseScoreResult = computeBaseScore({
                        importanceScore: boundedImportanceScore,
                        labels: normalizedLabels.assignedLabels.map((label: any) => ({
                            labelId: label._id,
                            name: label.name,
                        })),
                        context: priorityScoringContext,
                    });

                    const fromEmail = typeof deepResult.from === 'string' ? deepResult.from : deepResult.from?.email || 'unknown';
                    const fromName = typeof deepResult.from === 'object' ? deepResult.from?.name || null : null;
                    const fromDomain = typeof deepResult.from === 'object' ? deepResult.from?.domain || null : null;
                    
                    const newInsight = await insightRepository.create({
                        user_id: userId,
                        account_id: accountId,
                        gmail_thread_id: email.thread_id,
                        email_ids: JSON.stringify([messageId]),
                        emails: JSON.stringify([emailEntry]),
                        from_email: fromEmail,
                        from_name: fromName,
                        from_domain: fromDomain,
                        labels: JSON.stringify(normalizedLabels.assignedLabels.map((label) => ({
                            labelId: label._id,
                            name: label.name,
                            source: label.source,
                            statusSnapshot: label.status,
                        }))),
                        label_suggestions: JSON.stringify(suggestedLabel
                            ? [
                                {
                                    labelId: suggestedLabel._id,
                                    name: suggestedLabel.name,
                                    source: "ai",
                                    status: "suggested",
                                    confidence: Math.min(
                                        (suggestedLabel.suggestionCount || 0) / AI_LABEL_SUGGESTION_MIN_MATCHES,
                                        1
                                    ),
                                    generatedAt: new Date(),
                                },
                            ]
                            : []),
                        summary_snippet: deepResult.insights.shortSnippet,
                        summary_intent: deepResult.insights.intent,
                        importance_score: boundedImportanceScore || null,
                        base_score: baseScoreResult.baseScore,
                        base_score_breakdown: JSON.stringify({
                            importanceNorm: baseScoreResult.importanceNorm,
                            labelNorm: baseScoreResult.labelNorm,
                            matchedLabelRank: baseScoreResult.matchedLabelRank,
                        }),
                        base_score_computed_at: Date.now(),
                        dates: JSON.stringify(parsedDates.map((d: any) => ({
                            type: d.type,
                            date: d.date,
                            sourceEmailId: messageId,
                        }))),
                        attachments: JSON.stringify(emailEntry.attachments.map((a: any) => ({
                            ...a,
                            sourceEmailId: messageId,
                        }))),
                        checklist: JSON.stringify(parsedChecklist.map((item: any) => ({
                            ...item,
                            sourceEmailId: messageId,
                        }))),
                        extracted_facts: JSON.stringify(deepResult.insights.extractedFacts),
                        state_relevance: "active",
                        state_first_seen_at: Date.now(),
                        state_last_signal_at: Date.now(),
                        state_last_verified_at: Date.now(),
                        embedding: null,
                        needs_review: 0,
                        ai_confidence: null,
                        ai_uncertainty_source: null,
                        pipeline_stage_reached: "stage2",
                    });
                    insight = newInsight;
                } else {
                    // For Phase 1, we update the existing insight with new labels and thread signal
                    // Complex email merging will be handled in Phase 2
                    const threadLabels = normalizedLabels.assignedLabels.map((label) => ({
                        labelId: label._id,
                        name: label.name,
                        source: label.source,
                        statusSnapshot: label.status,
                    }));
                    
                    const threadLabelsJson = JSON.stringify(threadLabels);
                    const suggestionsJson = JSON.stringify(suggestedLabel
                        ? [
                            {
                                labelId: suggestedLabel._id,
                                name: suggestedLabel.name,
                                source: "ai",
                                status: "suggested",
                                confidence: Math.min(
                                    (suggestedLabel.suggestionCount || 0) / AI_LABEL_SUGGESTION_MIN_MATCHES,
                                    1
                                ),
                                generatedAt: new Date(),
                            },
                        ]
                        : []);
                    
                    await insightRepository.updateLabels(
                        insight.id,
                        threadLabelsJson,
                        suggestionsJson
                    );
                    
                    await insightRepository.updateState(
                        insight.id,
                        {
                            state_relevance: "active",
                            state_last_signal_at: Date.now(),
                            state_last_verified_at: Date.now(),
                        }
                    );
                }

                if (insight) {
                    // Update EmailMessage flag
                    await emailMessageRepository.markProcessed(messageId);
                    logger.debug(`[AI WORKER] Email processed successfully ${messageId}`);

                    // Create/update deduplication entry
                    await processedEmailLogRepository.createOrUpdate({
                        account_id: accountId,
                        message_id: messageId,
                        insight_id: insight.id,
                        thread_id: email.thread_id,
                        previous_state_hash: "",
                        internal_date: email.internal_date || Date.now(),
                        processed_at: Date.now(),
                        retry_count: 0,
                        last_retry_at: null,
                        last_error_message: null,
                        error_type: 'none',
                        previous_labels: JSON.stringify([]),
                    });
                }

            } catch (err: any) {
                logger.info(`[AI WORKER] Deep processing failed for ${messageId}:`, err.message || err);
                
                // Handle retries
                const errorType = classifyError(err);
                const existing = await processedEmailLogRepository.findByMessageId(accountId, messageId);
                const newRetryCount = (existing?.retry_count || 0) + 1;
                const isPermanent = errorType === 'permanent' || newRetryCount >= MAX_RETRIES;
                const finalErrorType = isPermanent ? 'permanent' : errorType;

                await processedEmailLogRepository.incrementRetry(
                    accountId,
                    messageId,
                    err.message || String(err),
                    finalErrorType
                );
            }
        });

        // Await the batch strictly
        for (const p of promises) {
            await p;
        }
        processedCount += batch.length;

        // RATE LIMIT BUFFER: If more batches remain, wait briefly to avoid model throttle.
        if (i + BATCH_SIZE < totalCount) {
          logger.debug(`[AI WORKER] Email complete. Sleeping 4s to respect rate limits...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
    }

    // Complete Progress Updates
    await updateProgressComplete(accountId);
    logger.debug(`[AI WORKER] Completed processing for account ${accountId}`);
};

async function updateProgressComplete(accountId: string) {
    await syncCheckpointRepository.updateProgress(accountId, {
        progress_percent: 100,
        progress_stage: "completed",
        progress_message: "Sync complete",
        processed_candidates: 0,
    });
    await syncCheckpointRepository.updateSyncState(accountId, "idle");
}


