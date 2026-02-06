import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { GmailAccountModel } from '../model/GmailAccount';
import { InsightModel } from '../model/Insight';
import { google } from 'googleapis';
import { createOAuthClient } from '../utils/createOAuth';
import { refreshAccessToken } from '../services/gmailAuth';
import { processEmailDeep, ProcessedEmailInsight } from '../services/emailProcessingService';

// Temporary in-memory storage for metadata (keyed by userId)
const metadataCache: Map<string, any[]> = new Map();

//!TODO: Enhance to make this customizable per user
// Cheap filtering 
const isRelevant = (metadata: any): boolean => {
    const { from, subject, snippet, hasAttachments } = metadata;

    // Extract domain from 'from' (e.g., user@domain.com -> domain.com)
    const domainMatch = from.match(/@(.+)/);
    const domain = domainMatch ? domainMatch[1].toLowerCase() : '';

    // Include rules
    if (domain.includes('.edu') || ['linkedin.com', 'indeed.com', 'glassdoor.com'].includes(domain)) {
        return true;
    }
    if (hasAttachments) {
        return true;
    }
    const text = `${subject} ${snippet}`.toLowerCase();
    if (/\b(job|interview|application|deadline|event|opportunity)\b/.test(text)) {
        return true;
    }

    // Exclude rules
    if (from.toLowerCase().includes('no-reply@') || from.toLowerCase().includes('noreply@')) {
        return false;
    }
    if (/\b(weekly digest|newsletter|promotion|unsubscribe)\b/i.test(text)) {
        return false;
    }

    return false; // Default exclude if no include rule matches
};

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

        // Apply filtering
        const filteredMetadata = metadataList.filter(isRelevant);


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
        const processedInsights: any[] = [];
        const errors: any[] = [];

        for (const metadata of filteredMetadata) {
            try {
                const processed = await processEmailDeep(
                    gmail,
                    metadata.messageId,
                    metadata.threadId,
                    metadata.internalDate,
                    {
                        from: metadata.from,
                        subject: metadata.subject,
                        snippet: metadata.snippet,
                    }
                );

                // Persist to Intelligence Index
                const insight = new InsightModel({
                    userId: uid,
                    accountId: gmailAccount._id,
                    gmailThreadId: metadata.threadId,
                    emailIds: [metadata.messageId],
                    threadId: null, // Will be updated when Thread model is available
                    from: processed.from,
                    labels: processed.insights.labels.map((label) => ({ name: label })),
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