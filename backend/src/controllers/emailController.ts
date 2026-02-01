import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { GmailAccountModel } from '../model/GmailAccount';
import { google } from 'googleapis';
import { createOAuthClient } from '../utils/createOAuth';
import { refreshAccessToken } from '../services/gmailAuth';

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
    const { maxResults = 100, pageToken } = req.body;

    if (!uid) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }

    try {
        // Find user's Gmail account
        const gmailAccount = await GmailAccountModel.findOne({ userId: uid });
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
        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            maxResults: Math.min(maxResults, 100), // Limit to 100
            pageToken
        });

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