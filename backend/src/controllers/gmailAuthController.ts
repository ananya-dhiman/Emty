import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { GmailAccountModel } from '../model/GmailAccount';
import { EmailModel } from '../model/Email';
import { google } from 'googleapis';
import crypto from 'crypto';
import { client } from '../utils/redis';
import { createOAuthClient } from '../utils/createOAuth';
import { generateOAuthUrl, exchangeCodeForTokens, refreshAccessToken, revokeToken } from '../services/gmailAuth';
import {UserModel} from '../model/User';
import { htmlToText } from 'html-to-text';

// /auth/google
// ✔ req.user exists
// ✔ generate state
// ✔ redis SET state → userId (TTL)
// ✔ generate OAuth URL (pass state)
// ✔ redirect
export const initiateGoogleOAuth = async (req:AuthRequest, res:Response): Promise<void> => {
    const oauth2Client = createOAuthClient();
    const uid= req.user?.uid;

    const user = await UserModel.findOne({ firebaseId: uid });

    if(!user){
        res.status(400).json({
            success: false, 
            message: 'User not found.'
        });
        return;
    }


    const state = crypto.randomBytes(32).toString('hex');
    const uidString = uid || '';
    
    await client.setEx(
        `oauth:state:${state}`,
        300, // TTL in seconds (5 minutes)
        uidString
    );
    try {
        const authorizationUrl = await generateOAuthUrl(oauth2Client,state);

        res.status(200).json({
            success: true,
            authorizationUrl: authorizationUrl
        });
    }catch(error){
        console.log("Not able to initiate gmail auth request"+ error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate Google OAuth.'
        });
        return;

    }
       



}


// /auth/google/callback
// Process: 
// 1. Google sends back: code (authorization code) + state (security token)
// 2. Validate state exists in Redis (proves user initiated this flow)
// 3. Extract userId from Redis using state
// 4. Exchange code for access_token + refresh_token
// 5. Fetch Gmail profile (email address)
// 6. Save/Update Gmail account in database
// 7. Delete state from Redis (one-time use)

export const store_credentials = async (req:AuthRequest, res:Response): Promise<void> => {
    const oauth2Client = createOAuthClient();
    const code: string = req.query.code as string;
    const state: string = req.query.state as string;

    try {
        // ========== STEP 1: Validate state from Redis ==========
        // State is the security token we created and stored in initiateGoogleOAuth
        // If state is invalid/missing, this is a suspicious request (CSRF attack)
        
        if (!state) {
            res.status(400).json({
                success: false,
                message: 'Missing state parameter. Invalid OAuth flow.'
            });
            return;
        }

        // Look up state in Redis to get the userId
        const uid = await client.get(`oauth:state:${state}`);

        if (!uid) {
            res.status(400).json({
                success: false,
                message: 'Invalid or expired state. Please initiate Gmail connection again.'
            });
            return;
        }

        // ========== STEP 2: Exchange authorization code for tokens ==========
        // Google gives us: access_token (short-lived) + refresh_token (long-lived)
        const tokens = await exchangeCodeForTokens(code, oauth2Client);
        oauth2Client.setCredentials(tokens);

        // ========== STEP 3: Fetch Gmail profile ==========
        // Use access token to get user's Gmail email address
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const email = profile.data.emailAddress;

        if (!email) {
            res.status(400).json({
                success: false,
                message: 'Could not fetch Gmail email address.'
            });
            return;
        }

        // ========== STEP 4: Check if this Gmail account already linked ==========
        const existingAccount = await GmailAccountModel.findOne({ userId: uid, emailAddress: email });

        if (!existingAccount) {
            // NEW Gmail account - create entry
            const newGmailAccount = new GmailAccountModel({
                userId: uid,
                emailAddress: email,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                tokenExpiry: tokens.expiry_date
            });
            await newGmailAccount.save();
        } else {
            // EXISTING Gmail account - update tokens (in case user re-authenticated)
            const updateFields: Record<string, any> = {
                accessToken: tokens.access_token,
                tokenExpiry: tokens.expiry_date,
            };

            // Only update refresh_token if Google returned a new one
            // (Google only returns refresh token on first auth or if offline access requested)
            if (tokens.refresh_token) {
                updateFields.refreshToken = tokens.refresh_token;
            }

            await GmailAccountModel.updateOne(
                { userId: uid, emailAddress: email },
                { $set: updateFields }
            );
        }

        // ========== STEP 5: Cleanup - Delete state from Redis ==========
        // State is one-time use. Delete it to prevent reuse.
        await client.del(`oauth:state:${state}`);

        res.status(200).json({
            success: true,
            message: 'Gmail account connected successfully.',
            email: email
        });

    } catch (error: any) {
        console.error('Gmail callback error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to connect Gmail account: ' + error.message
        });
    }
};

// ========== FETCH USER EMAILS ==========
// Fetches emails from user's Gmail account
// Query params:
//   - accountId: Gmail account ID to fetch emails from
//   - query: Gmail search query (optional, e.g., "from:someone@example.com")
//   - maxResults: Number of emails to fetch (default: 10, max: 100)
//   - pageToken: For pagination
export const fetchUserEmails = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const uid = req.user?.uid;
        const { accountId, query = '', maxResults = 10, pageToken } = req.query;

        if (!uid) {
            res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
            return;
        }

        // ========== STEP 1: Get Gmail account and validate ownership ==========
        const gmailAccount = await GmailAccountModel.findById(accountId);

        if (!gmailAccount) {
            res.status(404).json({
                success: false,
                message: 'Gmail account not found'
            });
            return;
        }

        // Security check: Verify user owns this Gmail account
        if (gmailAccount.userId !== uid) {
            res.status(403).json({
                success: false,
                message: 'Unauthorized: You do not own this Gmail account'
            });
            return;
        }

        // ========== STEP 2: Setup OAuth client with user's tokens ==========
        const oauth2Client = createOAuthClient();

        // Check if token needs refresh
        const isExpired = gmailAccount.tokenExpiry && Date.now() >= (typeof gmailAccount.tokenExpiry === 'number' ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry.getTime()) - 60_000;

        if (isExpired && gmailAccount.refreshToken) {
            try {
                // Refresh the access token
                const tokens = await refreshAccessToken(gmailAccount.emailAddress, oauth2Client);
                oauth2Client.setCredentials(tokens);

                // Update tokens in database
                await GmailAccountModel.updateOne(
                    { _id: accountId },
                    {
                        $set: {
                            accessToken: tokens.access_token,
                            tokenExpiry: tokens.expiry_date
                        }
                    }
                );
            } catch (error) {
                console.error('Failed to refresh token:', error);
                res.status(401).json({
                    success: false,
                    message: 'Failed to refresh Gmail authorization. Please re-connect your Gmail account.'
                });
                return;
            }
        } else {
            // Use existing access token
            oauth2Client.setCredentials({
                access_token: gmailAccount.accessToken,
                refresh_token: gmailAccount.refreshToken,
                expiry_date: typeof gmailAccount.tokenExpiry === 'number' ? gmailAccount.tokenExpiry : gmailAccount.tokenExpiry?.getTime()
            });
        }

        // ========== STEP 3: Fetch email list from Gmail API ==========
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Limit maxResults to prevent memory issues (max 50 emails at once)
        const maxResultsNum = Math.min(parseInt(maxResults as string) || 10, 50);

        console.log(`📧 Fetching ${maxResultsNum} emails for user ${uid}`);

        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            q: query as string,
            maxResults: maxResultsNum,
            pageToken: pageToken as string
        });

        const messageIds = listResponse.data.messages || [];

        if (messageIds.length === 0) {
            res.status(200).json({
                success: true,
                emails: [],
                nextPageToken: null,
                message: 'No emails found'
            });
            return;
        }

        // ========== STEP 4: Fetch full email details ==========
        const emailDetails = await Promise.all(
            messageIds.map(async (msg) => {
                try {
                    const fullMessage = await gmail.users.messages.get({
                        userId: 'me',
                        id: msg.id!,
                        format: 'full' // Get full message with headers and body
                    });

                    const headers = fullMessage.data.payload?.headers || [];
                    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
                    const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender';
                    const to = headers.find(h => h.name === 'To')?.value || '';
                    const date = headers.find(h => h.name === 'Date')?.value || '';

                    // Extract body - handles both text/plain and text/html emails
                    let body = '';

                    // Helper function to extract text from MIME parts
                    const extractTextFromParts = (parts: any[]): string => {
                        // First, try to find text/plain part (preferred)
                        const textPart = parts.find(p => p.mimeType === 'text/plain');
                        if (textPart?.body?.data) {
                            return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
                        }

                        // If no text/plain, try text/html and convert to text
                        const htmlPart = parts.find(p => p.mimeType === 'text/html');
                        if (htmlPart?.body?.data) {
                            const htmlContent = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
                            return htmlToText(htmlContent, {
                                wordwrap: false,
                                selectors: [
                                    { selector: 'a', options: { linkBrackets: false, hideLinkHrefIfSameAsText: true } },
                                    { selector: 'img', format: 'skip' },
                                    { selector: 'script', format: 'skip' },
                                    { selector: 'style', format: 'skip' }
                                ]
                            });
                        }

                        // If parts have sub-parts (multipart), recursively search
                        for (const part of parts) {
                            if (part.parts) {
                                const nestedText = extractTextFromParts(part.parts);
                                if (nestedText) return nestedText;
                            }
                        }

                        return '';
                    };

                    // Try to extract from parts first
                    if (fullMessage.data.payload?.parts) {
                        body = extractTextFromParts(fullMessage.data.payload.parts);
                    }

                    // Fallback to main body if no parts
                    if (!body && fullMessage.data.payload?.body?.data) {
                        const rawBody = Buffer.from(fullMessage.data.payload.body.data, 'base64').toString('utf-8');
                        // Check if it's HTML or plain text
                        if (rawBody.includes('<') && rawBody.includes('>')) {
                            body = htmlToText(rawBody, {
                                wordwrap: false,
                                selectors: [
                                    { selector: 'a', options: { linkBrackets: false, hideLinkHrefIfSameAsText: true } },
                                    { selector: 'img', format: 'skip' },
                                    { selector: 'script', format: 'skip' },
                                    { selector: 'style', format: 'skip' }
                                ]
                            });
                        } else {
                            body = rawBody;
                        }
                    }

                    // Final fallback: use Gmail's snippet
                    if (!body.trim()) {
                        body = fullMessage.data.snippet || 'No content available';
                    }

                    return {
                        gmailMessageId: msg.id,
                        subject,
                        from,
                        to: [to],
                        body: body, // Full clean text content (HTML parsed, no truncation)
                        date,
                        snippet: fullMessage.data.snippet || '',
                        labels: fullMessage.data.labelIds || [] // Include email labels (INBOX, UNREAD, etc.)
                    };
                } catch (error) {
                    console.error(`Failed to fetch message ${msg.id}:`, error);
                    return null;
                }
            })
        );

        // Filter out any null entries (failed fetches)
        const validEmails = emailDetails.filter(email => email !== null);

        res.status(200).json({
            success: true,
            emails: validEmails,
            nextPageToken: listResponse.data.nextPageToken || null,
            totalResults: listResponse.data.resultSizeEstimate || 0
        });

    } catch (error: any) {
        console.error('Error fetching emails:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch emails: ' + error.message
        });
    }
};