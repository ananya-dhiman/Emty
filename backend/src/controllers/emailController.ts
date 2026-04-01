import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { GmailAccountModel } from '../model/GmailAccount';
import { InsightModel } from '../model/Insight';
import { LabelModel } from '../model/Label';
import { google } from 'googleapis';
import { createOAuthClient } from '../utils/createOAuth';
import { refreshAccessToken } from '../services/gmailAuth';
import { processEmailDeep } from '../services/emailProcessingService';
import rulesEngine from '../services/rulesEngine';
import incrementalSyncService from '../services/incrementalSyncService';
import { runScoringWorker } from '../services/scoringWorkerService';
import { runAiProcessingWorker } from '../services/aiProcessingWorkerService';
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
            console.error('[ERROR] Gmail API call failed:', gmailError.message);
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
                console.error(`Failed to fetch metadata for ${msg.id}:`, error);
            }
        }

        // Apply filtering using RulesEngine
        const filteredMetadata = rulesEngine.applyRulesAndRelevance(metadataList);

        console.log(`[FILTER] Total emails fetched (raw): ${messages.length}. Metadata list size: ${metadataList.length}. After filter: ${filteredMetadata.length}`);
        if (metadataList.length > 0 && filteredMetadata.length === 0) {
      
            metadataList.slice(0, 3).forEach(email => {
                console.log(`  - From: ${email.from}, Subject: ${email.subject}, Has attachments: ${email.hasAttachments}`);
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
        console.error('Error scanning metadata:', error.message);
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
        console.error('Error creating label:', error.message);
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
        console.error('Error listing labels:', error.message);
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
        console.error('Error accepting suggested label:', error.message);
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
        console.error('Error rejecting suggested label:', error.message);
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
                    relevantLabels
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

                let insight = await InsightModel.findOne({
                    userId: uid,
                    accountId: gmailAccount._id,
                    gmailThreadId: metadata.threadId,
                });

                if (!insight) {
                    const newInsight = new InsightModel({
                        userId: uid,
                        accountId: gmailAccount._id,
                        docType: 'thread_insight',
                        gmailThreadId: metadata.threadId,
                        emailIds: [metadata.messageId],
                        threadId: null,
                        emails: [emailEntry],
                        from: processed.from,
                        labels: normalizedLabels.assignedLabels.map((label) => ({
                            labelId: label._id,
                            name: label.name,
                            source: label.source,
                            statusSnapshot: label.status,
                        })),
                        labelSuggestions: suggestedLabel
                            ? [{
                                labelId: suggestedLabel._id,
                                name: suggestedLabel.name,
                                source: 'ai',
                                status: 'suggested',
                                confidence: Math.min((suggestedLabel.suggestionCount || 0) / AI_LABEL_SUGGESTION_MIN_MATCHES, 1),
                                generatedAt: new Date(),
                            }]
                            : [],
                        importanceScore: null,
                        summary: {
                            shortSnippet: processed.insights.shortSnippet,
                            intent: processed.insights.intent,
                        },
                        dates: parsedDates.map((d) => ({
                            ...d,
                            sourceEmailId: metadata.messageId,
                        })),
                        attachments: emailEntry.attachments.map((a: any) => ({
                            ...a,
                            sourceEmailId: metadata.messageId,
                        })),
                        checklist: parsedChecklist.map((item: any) => ({
                            ...item,
                            sourceEmailId: metadata.messageId,
                        })),
                        state: null,
                        extractedFacts: processed.insights.extractedFacts,
                    });
                    await newInsight.save();
                    insight = newInsight;
                } else {
                    const existingEmails = Array.isArray((insight as any).emails) ? [...(insight as any).emails] : [];
                    const idx = existingEmails.findIndex((e: any) => e?.messageId === metadata.messageId);
                    if (idx >= 0) existingEmails[idx] = { ...existingEmails[idx], ...emailEntry };
                    else existingEmails.push(emailEntry);
                    const boundedEmails = existingEmails
                        .sort((a: any, b: any) => new Date(a.internalDate).getTime() - new Date(b.internalDate).getTime())
                        .slice(-50);
                    const latest = boundedEmails[boundedEmails.length - 1] || emailEntry;

                    insight.docType = 'thread_insight';
                    insight.emailIds = boundedEmails.map((e: any) => e.messageId);
                    (insight as any).emails = boundedEmails;
                    insight.from = latest.from || insight.from;
                    insight.labels = normalizedLabels.assignedLabels.map((label) => ({
                        labelId: label._id,
                        name: label.name,
                        source: label.source,
                        statusSnapshot: label.status,
                    }));
                    insight.labelSuggestions = suggestedLabel
                        ? [{
                            labelId: suggestedLabel._id,
                            name: suggestedLabel.name,
                            source: 'ai',
                            status: 'suggested',
                            confidence: Math.min((suggestedLabel.suggestionCount || 0) / AI_LABEL_SUGGESTION_MIN_MATCHES, 1),
                            generatedAt: new Date(),
                        }]
                        : [];
                    insight.summary = {
                        shortSnippet: latest?.ai?.shortSnippet || processed.insights.shortSnippet,
                        intent: latest?.ai?.intent || processed.insights.intent,
                    };
                    insight.dates = boundedEmails.flatMap((entry: any) =>
                        (Array.isArray(entry?.dates) ? entry.dates : []).map((d: any) => ({
                            type: d.type,
                            date: d.date,
                            sourceEmailId: entry.messageId,
                        }))
                    ) as any;
                    insight.attachments = boundedEmails.flatMap((entry: any) =>
                        (Array.isArray(entry?.attachments) ? entry.attachments : []).map((a: any) => ({
                            filename: a.filename,
                            mimeType: a.mimeType,
                            size: a.size,
                            sourceEmailId: entry.messageId,
                        }))
                    ) as any;
                    const checklistByKey = new Map<string, any>();
                    for (const entry of boundedEmails) {
                        const items = Array.isArray(entry?.checklist) ? entry.checklist : [];
                        for (const item of items) {
                            const task = typeof item?.task === "string" ? item.task.trim() : "";
                            if (!task) continue;
                            const dueDateIso = item?.dueDate ? new Date(item.dueDate).toISOString() : "";
                            const key = `${task.toLowerCase()}|${dueDateIso}`;
                            checklistByKey.set(key, {
                                task,
                                status: "pending",
                                dueDate: item?.dueDate ? new Date(item.dueDate) : undefined,
                                reason: typeof item?.reason === "string" ? item.reason : undefined,
                                inferred: item?.inferred === true,
                                sourceEmailId: entry.messageId,
                            });
                        }
                    }
                    insight.checklist = Array.from(checklistByKey.values()) as any;
                    insight.extractedFacts = latest?.extractedFacts || insight.extractedFacts;
                    await insight.save();
                }
                processedInsights.push({
                    messageId: metadata.messageId,
                    success: true,
                    insightId: insight._id,
                });
            } catch (error: any) {
                console.error(`Error processing email ${metadata.messageId}:`, error);
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
        console.error('Error in deep processing:', error.message);
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

        // Trigger incremental sync (fetches new candidates into EmailMessage staging DB)
        const result = await incrementalSyncService.sync(accountId);

        // Phase 2: Start background workers to dynamically score and AI-process the new arrivals
        // We run this asynchronously so the web request returns 200 immediately and the
        // Dashboard can use its Option B auto-polling stream.
        if (result.success && result.processed >= 0) {
            console.log(`[SYNC] Completed fetch stage. Starting background workers for user ${uid}`);
            (async () => {
                try {
                    await runScoringWorker(uid, accountId);
                    await runAiProcessingWorker(uid, accountId);
                } catch (err: any) {
                    console.error('[BACKGROUND SEQUENCE FAIL from Sync]', err.message);
                }
            })();
        }


        res.status(result.success ? 200 : 400).json({
            success: result.success,
            processed: result.processed,
            succeeded: result.succeeded,
            failed: result.failed,
            errors: result.errors.length > 0 ? result.errors : undefined,
            message: result.message || 'Sync completed',
        });
    } catch (error: any) {
        console.error('Error in sync endpoint:', error.message);
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
        console.error('Error getting label priorities:', error.message);
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
        console.error('Error updating label priorities:', error.message);
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
        console.error('Error marking label priorities reviewed:', error.message);
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
        });
    } catch (error: any) {
        if (error?.message === 'Invalid accountId') {
            res.status(400).json({ success: false, message: 'Invalid accountId' });
            return;
        }
        console.error('Error getting priority ranking insights:', error.message);
        res.status(500).json({ success: false, message: 'Failed to get priority ranking insights: ' + error.message });
    }
};
