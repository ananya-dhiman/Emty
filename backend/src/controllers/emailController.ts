import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { GmailAccountModel } from '../model/GmailAccount';
import * as emailMessageRepository from '../db/repositories/emailMessageRepository';
import * as insightRepository from '../db/repositories/insightRepository';
import { LabelModel } from '../model/Label';
import { UserIntentProfileModel } from '../model/UserIntentProfile';
import { google } from 'googleapis';
import { createOAuthClient } from '../utils/createOAuth';
import { refreshAccessToken } from '../services/gmailAuth';
import { processEmailDeep } from '../services/emailProcessingService';
import rulesEngine from '../services/rulesEngine';
import incrementalSyncService from '../services/incrementalSyncService';
import { runScoringWorker } from '../services/scoringWorkerService';
import { runAiProcessingWorker } from '../services/aiProcessingWorkerService';
import logger from '../utils/logger';
import {
    AI_LABEL_SUGGESTION_MIN_MATCHES,
    getAssignableLabels,
    getVisibleLabels,
    normalizeAIClassification,
    normalizeLabelName,
    recordSuggestedLabel,
} from '../services/labelLifecycleService';
import {
    appendLabelToPriorityConfig,
    getLabelPriorities,
    markLabelPrioritiesReviewed,
    getPriorityRanking,
    reorderLabelPriorities,
} from '../services/focusBoardService';

// Temporary in-memory storage for metadata (keyed by userId)
const metadataCache: Map<string, any[]> = new Map();

//!TODO: Figure out better solution     
// Rate limiting: delay between API calls
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const MIN_AI_SCORE = 0.4;

export const scanMetadata = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const maxResultsNum = parseInt(req.query.maxResults as string) || 100;
    let pageToken: string | undefined = (req.query.pageToken as string);
    if (pageToken === 'undefined' || pageToken === 'null' || !pageToken) pageToken = undefined;
    const accountId = (req.query.accountId as string) || undefined;

    if (!uid) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }

    try {
        // Find user's Gmail account
        let gmailAccount;
        
            gmailAccount = await GmailAccountModel.findById(accountId);
            if (gmailAccount && gmailAccount.userId !== uid) {
                res.status(403).json({ success: false, message: 'Unauthorized: You do not own this Gmail account' });
                return;
            }
        
        if (!gmailAccount) {
            res.status(400).json({ success: false, message: 'Gmail account not connected' });
            return;
        }

     

        // Setup OAuth client
        const oauth2Client = createOAuthClient();
        const isExpired = gmailAccount.tokenExpiry && Date.now() >= (typeof gmailAccount.tokenExpiry === 'number' ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry.getTime()) - 60_000;

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
                expiry_date: typeof gmailAccount.tokenExpiry === 'number' ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry?.getTime()
            });
        }

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });


        // Fetch metadata
        const listParams = {
            userId: 'me',
            q: '', 
            maxResults: Math.min(maxResultsNum, 100),
            pageToken: pageToken as string
        };
  

        let listResponse;
        try {
            listResponse = await gmail.users.messages.list(listParams);
        } catch (gmailError: any) {
            logger.info('[ERROR] Gmail API call failed:', gmailError.message);
            throw gmailError;
        }

        const messages = listResponse.data.messages || [];
        const metadataList: any[] = [];

        // Fetch metadata for each message with delay
        for (const msg of messages) {
            await delay(100); // 100ms delay for rate limiting
            try {
                const msgResponse = await gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id!,
                    format: 'metadata',
                    metadataHeaders: ['From', 'Subject', 'Date']
                });

                const headers = msgResponse.data.payload?.headers || [];
                const from = headers.find(h => h.name === 'From')?.value || '';
                const subject = headers.find(h => h.name === 'Subject')?.value || '';
                const date = headers.find(h => h.name === 'Date')?.value || '';
                const hasAttachments = (msgResponse.data.payload?.parts || []).some((part: any) => part.filename && part.filename !== '');

                metadataList.push({
                    messageId: msg.id,
                    threadId: msg.threadId,
                    from,
                    subject,
                    snippet: msgResponse.data.snippet || '',
                    internalDate: msgResponse.data.internalDate,
                    hasAttachments
                });
            } catch (error) {
                logger.info(`Failed to fetch metadata for ${msg.id}:`, error);
            }
        }

        // Apply filtering using RulesEngine
        const filteredMetadata = rulesEngine.applyRulesAndRelevance(metadataList);

        logger.debug(`[FILTER] Total emails fetched (raw): ${messages.length}. Metadata list size: ${metadataList.length}. After filter: ${filteredMetadata.length}`);
        if (metadataList.length > 0 && filteredMetadata.length === 0) {
      
            metadataList.slice(0, 3).forEach(email => {
                logger.debug(`  - From: ${email.from}, Subject: ${email.subject}, Has attachments: ${email.hasAttachments}`);
            });
        }

        // Store in memory (temporary)
        metadataCache.set(uid, filteredMetadata);

        res.status(200).json({
            success: true,
            filteredMetadata,
            nextPageToken: listResponse.data.nextPageToken || null,
            totalFetched: messages.length
        });

    } catch (error: any) {
        logger.info('Error scanning metadata:', error.message);
        res.status(500).json({ success: false, message: 'Failed to scan metadata: ' + error.message });
    }
};

export const createLabel = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const { accountId, name, description, color } = req.body;
    const normalizedName = typeof name === 'string' ? normalizeLabelName(name) : '';

    if (!uid || !accountId || !normalizedName) {
        res.status(400).json({ success: false, message: 'accountId and name are required' });
        return;
    }

    try {
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({ success: false, message: 'Unauthorized: invalid account' });
            return;
        }

        const existingLabel = await LabelModel.findOne({
            userId: uid,
            accountId,
            nameNormalized: normalizedName,
        });

        if (existingLabel) {
            if (existingLabel.source === 'ai') {
                existingLabel.name = name.trim();
                existingLabel.nameNormalized = normalizedName;
                existingLabel.description = description?.trim() || existingLabel.description || '';
                existingLabel.color = color?.trim() || existingLabel.color;
                existingLabel.source = 'user';
                existingLabel.status = 'active';
                await existingLabel.save();
                await appendLabelToPriorityConfig(uid, accountId, existingLabel._id);
                res.status(200).json({ success: true, label: existingLabel });
                return;
            }

            res.status(409).json({ success: false, message: 'Label already exists' });
            return;
        }

        const label = await LabelModel.create({
            userId: uid,
            accountId,
            name: name.trim(),
            nameNormalized: normalizedName,
            description: description?.trim() || '',
            color: color?.trim() || undefined,
            source: 'user',
            status: 'active',
        });
        await appendLabelToPriorityConfig(uid, accountId, label._id);

        res.status(201).json({ success: true, label });
    } catch (error: any) {
        if (error?.code === 11000) {
            res.status(409).json({ success: false, message: 'Label already exists' });
            return;
        }
        logger.info('Error creating label:', error.message);
        res.status(500).json({ success: false, message: 'Failed to create label: ' + error.message });
    }
};

export const listLabels = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const accountId = req.query.accountId as string;
    const status = req.query.status as 'active' | 'suggested' | 'rejected' | undefined;

    if (!uid || !accountId) {
        res.status(400).json({ success: false, message: 'accountId is required in query' });
        return;
    }

    try {
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({ success: false, message: 'Unauthorized: invalid account' });
            return;
        }

        const labels = await getVisibleLabels(uid, accountId, status);
        res.status(200).json({ success: true, labels });
    } catch (error: any) {
        logger.info('Error listing labels:', error.message);
        res.status(500).json({ success: false, message: 'Failed to list labels: ' + error.message });
    }
};

export const acceptSuggestedLabel = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const { labelId } = req.params;

    if (!uid || !labelId) {
        res.status(400).json({ success: false, message: 'labelId is required' });
        return;
    }

    try {
        const label = await LabelModel.findById(labelId);
        if (!label || label.userId !== uid) {
            res.status(404).json({ success: false, message: 'Label not found' });
            return;
        }

        label.source = 'user';
        label.status = 'active';
        await label.save();
        await appendLabelToPriorityConfig(label.userId, label.accountId, label._id);

        res.status(200).json({ success: true, label });
    } catch (error: any) {
        logger.info('Error accepting suggested label:', error.message);
        res.status(500).json({ success: false, message: 'Failed to accept label: ' + error.message });
    }
};

export const rejectSuggestedLabel = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const { labelId } = req.params;

    if (!uid || !labelId) {
        res.status(400).json({ success: false, message: 'labelId is required' });
        return;
    }

    try {
        const label = await LabelModel.findById(labelId);
        if (!label || label.userId !== uid) {
            res.status(404).json({ success: false, message: 'Label not found' });
            return;
        }

        label.status = 'rejected';
        await label.save();

        res.status(200).json({ success: true, label });
    } catch (error: any) {
        logger.info('Error rejecting suggested label:', error.message);
        res.status(500).json({ success: false, message: 'Failed to reject label: ' + error.message });
    }
};

/**
 * Deep Process Emails Controller
 * Takes filtered metadata and processes each email:
 * 1. Fetches full email body and attachment metadata
 * 2. Calls AI service to extract insights
 * 3. Persists to Intelligence Index (Insight model)
 * 4. Clears full email data after processing
 */
export const deepProcessEmails = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    
    const { accountId, filteredMetadata } = req.body;

    if (!uid || !accountId || !Array.isArray(filteredMetadata) || filteredMetadata.length === 0) {
        res.status(400).json({
            success: false,
            message: 'Missing required fields: accountId and valid filteredMetadata array',
        });
        return;
    }

    try {
        // Fetch Gmail account and validate ownership
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({
                success: false,
                message: 'Unauthorized: Invalid Gmail account',
            });
            return;
        }

        // Setup OAuth client
        const oauth2Client = createOAuthClient();
        const isExpired = gmailAccount.tokenExpiry && Date.now() >= (typeof gmailAccount.tokenExpiry === 'number' ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry.getTime()) - 60_000;

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
                expiry_date: typeof gmailAccount.tokenExpiry === 'number' ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry?.getTime(),
            });
        }

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Process each filtered email
        const assignableLabels = await getAssignableLabels(uid, gmailAccount._id.toString());
        const labelCandidates = assignableLabels.map((label) => ({
            name: label.name,
            description: label.description || "",
        }));

        const processedInsights: any[] = [];
        const errors: any[] = [];

          for (const metadata of filteredMetadata) {
              try {
                  const staged = emailMessageRepository.findByMessageId(
                      gmailAccount._id.toString(),
                      metadata.messageId
                  );
                  const stagedScore = typeof staged?.score === 'number' ? staged.score : null;
                  if (stagedScore !== null && stagedScore < MIN_AI_SCORE) {
                      continue;
                  }

                  const relevantLabels = rulesEngine.getRelevantLabels(
                      `${metadata.subject}\n${metadata.snippet}`,
                      labelCandidates
                  );

                const processed = await processEmailDeep(
                    gmail,
                    metadata.messageId,
                    metadata.threadId,
                    metadata.internalDate,
                      {
                          from: metadata.from,
                          subject: metadata.subject,
                          snippet: metadata.snippet,
                      },
                      relevantLabels,
                      {
                          userId: uid,
                      }
                  );

                const normalizedLabels = normalizeAIClassification(
                    processed.insights.labels,
                    processed.insights.suggestedLabel || undefined,
                    assignableLabels
                );

                const suggestedLabel = await recordSuggestedLabel({
                    userId: uid,
                    accountId: gmailAccount._id.toString(),
                    suggestionName: normalizedLabels.suggestedLabelName,
                    threadId: metadata.threadId,
                });

                const parsedDates = processed.insights.dates.map((d) => ({
                    type: d.type,
                    date: new Date(d.date),
                }));
                const parsedChecklist = (Array.isArray(processed.insights.checklist) ? processed.insights.checklist : [])
                    .map((item: any) => ({
                        task: item?.task,
                        status: "pending" as const,
                        dueDate: item?.dueDate ? new Date(item.dueDate) : undefined,
                        reason: item?.reason,
                        inferred: item?.inferred === true,
                    }))
                    .filter((item: any) => typeof item.task === "string" && item.task.trim().length > 0);
                const parsedImportantLinks = (Array.isArray(processed.insights.importantLinks)
                    ? processed.insights.importantLinks
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
                    messageId: metadata.messageId,
                    internalDate: Number.isFinite(parseInt(metadata.internalDate, 10))
                        ? new Date(parseInt(metadata.internalDate, 10))
                        : new Date(),
                    from: processed.from,
                    subject: processed.subject || metadata.subject,
                    snippet: metadata.snippet,
                    labels: normalizedLabels.assignedLabels.map((label) => ({
                        labelId: label._id,
                        name: label.name,
                    })),
                    dates: parsedDates,
                    attachments: processed.attachmentMetadata.map((a) => ({
                        filename: a.filename,
                        mimeType: a.mimeType,
                        size: a.size,
                    })),
                    importantLinks: parsedImportantLinks,
                    checklist: parsedChecklist,
                    extractedFacts: processed.insights.extractedFacts,
                    ai: {
                        intent: processed.insights.intent,
                        shortSnippet: processed.insights.shortSnippet,
                        processedAt: new Date(),
                    },
                };

                const accountId = gmailAccount._id.toString();
                let existingInsight = insightRepository.findByThreadId(accountId, metadata.threadId);

                const labelsJson = JSON.stringify(normalizedLabels.assignedLabels.map((label) => ({
                    labelId: String(label._id),
                    name: label.name,
                    source: label.source,
                    statusSnapshot: label.status,
                })));
                const labelSuggestionsJson = JSON.stringify(suggestedLabel
                    ? [{
                        labelId: String(suggestedLabel._id),
                        name: suggestedLabel.name,
                        source: 'ai',
                        status: 'suggested',
                        confidence: Math.min((suggestedLabel.suggestionCount || 0) / AI_LABEL_SUGGESTION_MIN_MATCHES, 1),
                        generatedAt: new Date().toISOString(),
                    }]
                    : []);

                let insightId: string;

                if (!existingInsight) {
                    const created = insightRepository.create({
                        user_id: uid,
                        account_id: accountId,
                        gmail_thread_id: metadata.threadId,
                        email_ids: JSON.stringify([metadata.messageId]),
                        emails: JSON.stringify([emailEntry]),
                        from_email: typeof processed.from?.email === 'string' ? processed.from.email : '',
                        from_name: typeof processed.from?.name === 'string' ? processed.from.name : null,
                        from_domain: typeof processed.from?.domain === 'string' ? processed.from.domain : null,
                        labels: labelsJson,
                        label_suggestions: labelSuggestionsJson,
                        importance_score: null,
                        base_score: null,
                        base_score_breakdown: null,
                        base_score_computed_at: null,
                        summary_snippet: processed.insights.shortSnippet,
                        summary_intent: processed.insights.intent,
                        dates: JSON.stringify(parsedDates.map((d) => ({ ...d, sourceEmailId: metadata.messageId }))),
                        attachments: JSON.stringify(emailEntry.attachments.map((a: any) => ({ ...a, sourceEmailId: metadata.messageId }))),
                        checklist: JSON.stringify(parsedChecklist.map((item: any) => ({ ...item, sourceEmailId: metadata.messageId }))),
                        state_relevance: 'active',
                        state_first_seen_at: Date.now(),
                        state_last_signal_at: Date.now(),
                        state_last_verified_at: null,
                        extracted_facts: processed.insights.extractedFacts ? JSON.stringify(processed.insights.extractedFacts) : null,
                        embedding: null,
                        needs_review: 0,
                        ai_confidence: null,
                        ai_uncertainty_source: null,
                        pipeline_stage_reached: null,
                        verification_status: 'pending',
                        failed_verification_groups: '[]',
                        source: null,
                    });
                    insightId = created.id;
                } else {
                    let existingEmails: any[] = [];
                    try { existingEmails = JSON.parse(existingInsight.emails || '[]'); } catch {}
                    const idx = existingEmails.findIndex((e: any) => e?.messageId === metadata.messageId);
                    if (idx >= 0) existingEmails[idx] = { ...existingEmails[idx], ...emailEntry };
                    else existingEmails.push(emailEntry);
                    const boundedEmails = existingEmails
                        .sort((a: any, b: any) => new Date(a.internalDate).getTime() - new Date(b.internalDate).getTime())
                        .slice(-50);
                    const latest = boundedEmails[boundedEmails.length - 1] || emailEntry;

                    const mergedDates = JSON.stringify(boundedEmails.flatMap((entry: any) =>
                        (Array.isArray(entry?.dates) ? entry.dates : []).map((d: any) => ({ type: d.type, date: d.date, sourceEmailId: entry.messageId }))
                    ));
                    const mergedAttachments = JSON.stringify(boundedEmails.flatMap((entry: any) =>
                        (Array.isArray(entry?.attachments) ? entry.attachments : []).map((a: any) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, sourceEmailId: entry.messageId }))
                    ));
                    const checklistByKey = new Map<string, any>();
                    for (const entry of boundedEmails) {
                        const items = Array.isArray(entry?.checklist) ? entry.checklist : [];
                        for (const item of items) {
                            const task = typeof item?.task === 'string' ? item.task.trim() : '';
                            if (!task) continue;
                            const dueDateIso = item?.dueDate ? new Date(item.dueDate).toISOString() : '';
                            const key = `${task.toLowerCase()}|${dueDateIso}`;
                            checklistByKey.set(key, { task, status: 'pending', dueDate: item?.dueDate ? new Date(item.dueDate) : undefined, reason: typeof item?.reason === 'string' ? item.reason : undefined, inferred: item?.inferred === true, sourceEmailId: entry.messageId });
                        }
                    }

                    insightRepository.updateLabels(
                        existingInsight.id,
                        JSON.stringify(normalizedLabels.assignedLabels.map((label) => ({ labelId: String(label._id), name: label.name, source: label.source, statusSnapshot: label.status }))),
                        labelSuggestionsJson
                    );
                    insightRepository.updateState(existingInsight.id, { state_last_signal_at: Date.now() });
                    insightId = existingInsight.id;
                }

                processedInsights.push({
                    messageId: metadata.messageId,
                    success: true,
                    insightId,
                });
            } catch (error: any) {
                logger.info(`Error processing email ${metadata.messageId}:`, error);
                errors.push({
                    messageId: metadata.messageId,
                    error: error.message,
                });
            }
        }

        res.status(200).json({
            success: true,
            processedCount: processedInsights.length,
            errorCount: errors.length,
            processedInsights,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (error: any) {
        logger.info('Error in deep processing:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to process emails: ' + error.message,
        });
    }
};

/**
 * Sync Endpoint - Incremental Email Sync
 * Fetches new/changed emails and processes them incrementally
 * Uses atomic locking to prevent concurrent syncs
 * Supports fallback strategies: historyId → timestamp → full scan
 */
export const syncEmails = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const { accountId } = req.body;

    if (!uid || !accountId) {
        res.status(400).json({
            success: false,
            message: 'Missing required fields: accountId',
        });
        return;
    }

    try {
        // Validate user owns this account
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({
                success: false,
                message: 'Unauthorized: Invalid Gmail account',
            });
            return;
        }

          // Start scoring + AI workers only after onboarding is completed.
          const intentProfile = await UserIntentProfileModel.findOne({ userId: uid }).select('onboardingCompleted').lean();
          const canRunAiPipeline = intentProfile?.onboardingCompleted === true;

          if (!canRunAiPipeline) {
              logger.debug(`[SYNC] Onboarding not completed for user ${uid}. Staging only, AI workers deferred.`);
          }

          // Trigger incremental sync (fetches new candidates into EmailMessage staging DB)
          // Pass canRunAiPipeline as keepLock so the sync_state stays 'syncing' for the AI workers.
          const result = await incrementalSyncService.sync(accountId, canRunAiPipeline);

          if (result.success && result.processed >= 0 && canRunAiPipeline) {
              (async () => {
                  try {
                      await runScoringWorker(uid, accountId);
                      await runAiProcessingWorker(uid, accountId);
                  } catch (err: any) {
                      logger.info('[BACKGROUND SEQUENCE FAIL from Sync]', err.message || err);
                      const syncRepo = require('../db/repositories/syncCheckpointRepository');
                      syncRepo.markSyncError(accountId, err.message || String(err));
                  }
              })();
          }

          res.status(result.success ? 200 : 400).json({
            success: result.success,
            processed: result.processed,
            succeeded: result.succeeded,
              failed: result.failed,
              errors: result.errors.length > 0 ? result.errors : undefined,
              onboardingCompleted: canRunAiPipeline,
              message: canRunAiPipeline
                  ? (result.message || 'Sync completed')
                  : ((result.message || 'Sync completed') + ' (AI processing deferred until onboarding is completed)'),
          });
    } catch (error: any) {
        logger.info('Error in sync endpoint:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to sync emails: ' + error.message,
        });
    }
};

export const getLabelPriorityOrder = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const accountId = req.query.accountId as string;

    if (!uid || !accountId) {
        res.status(400).json({ success: false, message: 'accountId is required in query' });
        return;
    }

    try {
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({ success: false, message: 'Unauthorized: invalid account' });
            return;
        }

        const config = await getLabelPriorities(uid, accountId);
        res.status(200).json({
            success: true,
            accountId,
            isReviewedByUser: config.isReviewedByUser,
            priorities: config.priorities.sort((a, b) => a.rank - b.rank),
            initializedAt: config.initializedAt,
            lastComputedAt: config.lastComputedAt,
            lastEditedAt: config.lastEditedAt,
        });
    } catch (error: any) {
        logger.info('Error getting label priorities:', error.message);
        res.status(500).json({ success: false, message: 'Failed to get label priorities: ' + error.message });
    }
};

export const updateLabelPriorityOrder = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const { accountId, orderedLabelIds } = req.body as { accountId?: string; orderedLabelIds?: string[] };

    if (!uid || !accountId || !Array.isArray(orderedLabelIds)) {
        res.status(400).json({ success: false, message: 'accountId and orderedLabelIds are required' });
        return;
    }

    try {
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({ success: false, message: 'Unauthorized: invalid account' });
            return;
        }

        const config = await reorderLabelPriorities({
            userId: uid,
            accountId,
            orderedLabelIds,
        });

        res.status(200).json({
            success: true,
            accountId,
            isReviewedByUser: config.isReviewedByUser,
            priorities: config.priorities.sort((a, b) => a.rank - b.rank),
            lastEditedAt: config.lastEditedAt,
        });
    } catch (error: any) {
        if (error?.message?.includes('orderedLabelIds')) {
            res.status(400).json({ success: false, message: error.message });
            return;
        }
        logger.info('Error updating label priorities:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update label priorities: ' + error.message });
    }
};

export const reviewLabelPriorityOrder = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const { accountId } = req.body as { accountId?: string };

    if (!uid || !accountId) {
        res.status(400).json({ success: false, message: 'accountId is required' });
        return;
    }

    try {
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({ success: false, message: 'Unauthorized: invalid account' });
            return;
        }

        const config = await markLabelPrioritiesReviewed(uid, accountId);
        res.status(200).json({
            success: true,
            accountId,
            isReviewedByUser: config.isReviewedByUser,
            lastEditedAt: config.lastEditedAt,
        });
    } catch (error: any) {
        logger.info('Error marking label priorities reviewed:', error.message);
        res.status(500).json({ success: false, message: 'Failed to mark label priorities reviewed: ' + error.message });
    }
};

export const getPriorityRankingInsights = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const accountId = req.query.accountId as string;

    if (!uid || !accountId) {
        res.status(400).json({ success: false, message: 'accountId is required in query' });
        return;
    }

    try {
        const gmailAccount = await GmailAccountModel.findById(accountId);
        if (!gmailAccount || gmailAccount.userId !== uid) {
            res.status(403).json({ success: false, message: 'Unauthorized: invalid account' });
            return;
        }

        const result = await getPriorityRanking({
            userId: uid,
            accountId,
        });

        res.status(200).json({
            success: true,
            accountId,
            isReviewedByUser: result.config.isReviewedByUser,
            prioritiesCount: result.config.priorities.length,
            actionRequired: result.actionRequired,
            topPriority: result.topPriority,
            others: result.others,
            completed: result.completed,
            lowPriorityEmails: result.lowPriorityEmails,
        });
    } catch (error: any) {
        if (error?.message === 'Invalid accountId') {
            res.status(400).json({ success: false, message: 'Invalid accountId' });
            return;
        }
        logger.info('Error getting priority ranking insights:', error.message);
        res.status(500).json({ success: false, message: 'Failed to get priority ranking insights: ' + error.message });
    }
};

export const toggleEmailCompletion = async (req: AuthRequest, res: Response): Promise<void> => {
    const uid = req.user?.uid;
    const { insightId } = req.params;
    const { isCompleted } = req.body;

    if (!uid || !insightId || typeof insightId !== 'string') {
        res.status(400).json({ success: false, message: 'insightId is required and must be a string' });
        return;
    }

    if (typeof isCompleted !== 'boolean') {
        res.status(400).json({ success: false, message: 'isCompleted must be a boolean' });
        return;
    }

    try {
        const insight = insightRepository.findById(insightId);
        if (!insight || insight.user_id !== uid) {
            res.status(404).json({ success: false, message: 'Insight not found or unauthorized' });
            return;
        }

        insightRepository.updateCompletedStatus(insightId, isCompleted);

        res.status(200).json({
            success: true,
            insightId,
            isCompleted
        });
    } catch (error: any) {
        logger.info('Error toggling email completion:', error.message);
        res.status(500).json({ success: false, message: 'Failed to toggle email completion: ' + error.message });
    }
};
