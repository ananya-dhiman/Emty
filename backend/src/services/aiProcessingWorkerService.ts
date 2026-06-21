import { Types } from "mongoose";
import { google } from "googleapis";
import { GmailAccount } from "../model/GmailAccount";
import { createOAuthClient } from "../utils/createOAuth";
import * as emailMessageRepository from "../db/repositories/emailMessageRepository";
import * as insightRepository from "../db/repositories/insightRepository";
import * as processedEmailLogRepository from "../db/repositories/processedEmailLogRepository";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";

import * as labelCandidateRepository from "../db/repositories/labelCandidateRepository";
import { refreshAccessToken } from "./gmailAuth";
import { processEmailDeep, classifyEmail } from "./emailProcessingService";
import { fetchFullEmailBody } from "./emailBodyService";

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
import { verifyInsights } from "./verificationService";
import logger from '../utils/logger';

/**
 * AI Processing Worker Service
 * Runs asynchronously after the scoring worker.
 * Processes the top K emails using the local Ollama model.
 * Strict concurrency management via batching.
 */

const BATCH_SIZE = process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE) : 1; // Process 1 email at a time to stay under API limits
const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 5;
const MAX_EMAILS_PER_THREAD = process.env.MAX_EMAILS_PER_THREAD ? parseInt(process.env.MAX_EMAILS_PER_THREAD) : 50;
const MIN_AI_SCORE = process.env.MIN_AI_SCORE ? parseFloat(process.env.MIN_AI_SCORE) : 0.4;

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
    let retries = 0;
    const INITIAL_BACKOFF_MS = 60 * 1000; // 1 minute
    const MAX_BACKOFF_MS = 7 * 60 * 1000; // 7 minutes

    while (true) {
        try {
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

    // BLOCKING SYNC WAIT: Ensure a valid chat model is fully pulled and ready before starting Deep Processing.
    // This allows Tauri up to 30 minutes to download massive models like qwen2.5 seamlessly in the background.
    let isModelReady = false;
    const OLLAMA_URL = process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
    for (let attempt = 0; attempt < 180; attempt++) {
        try {
            const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
            if (tagsRes.ok) {
                const data: any = await tagsRes.json();
                const validModels = (data?.models || []).filter((m: any) => !m.name.includes('embed'));
                if (validModels.length > 0) {
                    isModelReady = true;
                    break;
                }
            }
        } catch (e) {
            // Ignore connection errors during Ollama spin-up
        }
        if (attempt % 3 === 0) {
            logger.debug(`[AI WORKER] Sync paused. Valid model not yet found. Waiting for Tauri to finish pulling models... (${attempt * 10}s)`);
        }
        await new Promise(r => setTimeout(r, 10000)); // 10 second polling interval
    }

    if (!isModelReady) {
        logger.debug(`[AI WORKER] Sync aborted. No chat models became available within 30 minutes. Please check your internet connection or restart the app.`);
        return; // Early exit without altering email processed status
    }

    // Initialize sync checkpoint if needed  
    const syncCheckpoint = syncCheckpointRepository.findOrCreate(accountId);

    // Ensure we process only high-priority emails that are score-qualified.
    const candidates = await emailMessageRepository.findUnprocessed(accountId);
    const totalRemaining = emailMessageRepository.countUnprocessed(accountId);
    logger.debug(
        `[AI WORKER] Candidate query applied | priority=top/pending | aiProcessed=false | minScore=${MIN_AI_SCORE} | totalRemaining=${totalRemaining}`
    );

    if (candidates.length === 0) {
        logger.debug(`[AI WORKER] No top emails to process for account ${accountId}`);
        await updateProgressComplete(accountId);
        return;
    }

    // Sort candidates to offload sensitive ones to the end of the batch
    candidates.sort((a, b) => {
        const classA = classifyEmail(a.from || '', a.subject || '', a.snippet || '');
        const classB = classifyEmail(b.from || '', b.subject || '', b.snippet || '');
        const weightA = classA === 'sensitive' ? 1 : 0;
        const weightB = classB === 'sensitive' ? 1 : 0;
        return weightA - weightB;
    });

    logger.debug(`[AI WORKER] Found ${candidates.length} emails to process with AI (Batch limit)`);

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
            progress_message: `Running 4-Stage AI Pipeline on emails (${processedCount}/${totalRemaining})`,
            total_candidates: totalRemaining,
            processed_candidates: processedCount,
        });

        const promises = batch.map(async (email) => {
            const messageId = email.message_id;
            try {
                // --- STAGE 2: PRE-FETCH BODY ---
                let parsedBodyResult: { body: string; payload: any; headers: any[]; preExtractedLinks: import('./emailBodyService').PreExtractedLink[] } | undefined;

                try {
                    parsedBodyResult = await fetchFullEmailBody(gmail, messageId);
                } catch (stage2Err) {
                    logger.info(`[AI WORKER] Pre-fetch body failed for ${messageId}, falling back...`, stage2Err);
                }

                // Determine relevant labels: Bypass embeddings and give all assignable labels to LLM directly
                const relevantLabels = labelCandidates;

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
                    relevantLabels,
                    {
                        userId,
                        aiContext,
                        prefetchedBody: parsedBodyResult,
                        onFallback: async (notice) => {
                            logger.debug(
                                `[AI WORKER] Fallback notice for ${messageId}: ${notice.fromProvider || "user-model"} -> ${notice.toProvider || "shared-model"}`
                            );
                        }
                    }
                );

                // --- STAGE 4: Verification (CoVe) ---
                const preExtractedUrls = parsedBodyResult?.preExtractedLinks.map((l: any) => l.url) || [];
                const verification = verifyInsights(parsedBodyResult?.body || email.snippet, deepResult.insights, preExtractedUrls);
                deepResult.insights = verification.correctedInsights || deepResult.insights;

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
                        ai_confidence: deepResult.confidence ?? null,
                        ai_uncertainty_source: deepResult.labelReason ?? null,
                        pipeline_stage_reached: "stage4",
                        verification_status: verification.status,
                        failed_verification_groups: JSON.stringify(verification.failedGroups),
                        source: 'ai'
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

                    await insightRepository.updateVerificationStatus(
                        insight.id,
                        verification.status,
                        JSON.stringify(verification.failedGroups),
                        'ai'
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

                // Stop the entire run immediately if it's because Ollama isn't done pulling models yet
                if (err?.message?.includes("AIPendingProvisioningError") || err?.message?.includes("try pulling it first")) {
                    logger.debug(`[AI WORKER] Aborting batch early due to missing models. App is likely still provisioning Ollama.`);
                    throw err;
                }

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

    // --- CONTINUOUS BACKGROUND DRAIN ---
    // Check if more pending emails remain in the backlog (from scoring worker's priority cutoff).
    // If so, re-run scoring to promote the next batch to 'top' and immediately process them.
    const remainingAfterBatch = emailMessageRepository.countUnprocessed(accountId);
    if (remainingAfterBatch > 0) {
        logger.debug(`[AI WORKER] ${remainingAfterBatch} emails still pending. Re-running scoring and starting next batch after cooldown...`);
        // Cooldown between batches to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second gap
        
        await syncCheckpointRepository.updateProgress(accountId, {
            progress_percent: 60,
            progress_stage: "scoring_emails",
            progress_message: `Preparing next batch (${remainingAfterBatch} remaining)...`,
            total_candidates: remainingAfterBatch,
        });
        
        // Re-run scoring to promote next batch of 'pending' -> 'top'
        const { runScoringWorker } = await import('./scoringWorkerService');
        await runScoringWorker(userId, accountId);
        
        retries = 0; // Reset retries on successful batch iteration
        continue; // Loop again for the next batch
    } else {
        logger.debug(`[AI WORKER] Backlog fully drained for account ${accountId}`);
        await updateProgressComplete(accountId);
        return; // Exit function successfully
    }

        } catch (loopErr: any) {
            retries++;
            const backoffMs = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * Math.pow(2, retries - 1));
            logger.info(`[AI WORKER] Backlog drain loop error: ${loopErr.message}. Retrying in ${backoffMs / 1000}s (Retry #${retries})...`);
            
            await syncCheckpointRepository.updateProgress(accountId, {
                progress_stage: "retrying",
                progress_message: `Error syncing. Retrying in ${backoffMs / 1000}s... (${loopErr.message})`
            });
            
            await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
    }
};

async function updateProgressComplete(accountId: string) {
    await syncCheckpointRepository.updateProgress(accountId, {
        progress_percent: 100,
        progress_stage: "completed",
        progress_message: "Sync complete",
    });
    await syncCheckpointRepository.updateSyncState(accountId, "idle");
}


