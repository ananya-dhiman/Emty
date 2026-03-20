import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { GmailAccountModel } from '../model/GmailAccount';
import { InsightModel } from '../model/Insight';
import { LabelModel } from '../model/Label';
import { google } from 'googleapis';
import { createOAuthClient } from '../utils/createOAuth';
import { refreshAccessToken } from '../services/gmailAuth';
import { processEmailDeep, ProcessedEmailInsight } from '../services/emailProcessingService';
import rulesEngine from '../services/rulesEngine';
import incrementalSyncService from '../services/incrementalSyncService';
import {
    AI_LABEL_SUGGESTION_MIN_MATCHES,
    getAssignableLabels,
    getVisibleLabels,
    normalizeAIClassification,
    normalizeLabelName,
    recordSuggestedLabel,
} from '../services/labelLifecycleService';

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

                // Persist to Intelligence Index
                const insight = new InsightModel({
                    userId: uid,
                    accountId: gmailAccount._id,
                    gmailThreadId: metadata.threadId,
                    emailIds: [metadata.messageId],
                    threadId: null, // Will be updated when Thread model is available
                    from: processed.from,
                    labels: normalizedLabels.assignedLabels.map((label) => ({
                        labelId: label._id,
                        name: label.name,
                        source: label.source,
                        statusSnapshot: label.status,
                    })),
                    labelSuggestions: suggestedLabel && suggestedLabel.status !== 'rejected'
                        ? [{
                            labelId: suggestedLabel._id,
                            name: suggestedLabel.name,
                            source: 'ai',
                            status: suggestedLabel.status,
                            confidence: Math.min((suggestedLabel.suggestionCount || 0) / AI_LABEL_SUGGESTION_MIN_MATCHES, 1),
                            generatedAt: new Date(),
                        }]
                        : [],
                    importanceScore: null, // Will be calculated later
                    summary: {
                        shortSnippet: processed.insights.shortSnippet,
                        intent: processed.insights.intent,
                    },
                    dates: processed.insights.dates.map((d) => ({
                        type: d.type,
                        date: new Date(d.date),
                        sourceEmailId: metadata.messageId,
                    })),
                    attachments: processed.attachmentMetadata,
                    state: null, // Will be set later
                    extractedFacts: processed.insights.extractedFacts,
                });

                await insight.save();
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

        // Trigger incremental sync
        const result = await incrementalSyncService.sync(accountId);

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
