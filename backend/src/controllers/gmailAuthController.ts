import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { GmailAccountModel } from '../model/GmailAccount';
import { google } from 'googleapis';
import crypto from 'crypto';
import * as oauthState from '../utils/oauthStateStore';
import { createOAuthClient } from '../utils/createOAuth';
import { generateOAuthUrl, exchangeCodeForTokens, refreshAccessToken, revokeToken } from '../services/gmailAuth';
import {UserModel} from '../model/User';
import { htmlToText } from 'html-to-text';
import { Types } from 'mongoose';
import * as accountLocalRepository from '../db/repositories/accountLocalRepository';
import * as userLocalRepository from '../db/repositories/userLocalRepository';

import logger from '../utils/logger';

// /auth/google
// ✔ req.user exists
// ✔ generate state
// ✔ redis SET state → userId (TTL)
// ✔ generate OAuth URL (pass state)
// ✔ redirect
export const initiateGoogleOAuth = async (req:AuthRequest, res:Response): Promise<void> => {
    const uid = req.user?.uid;

    try {
        const oauth2Client = createOAuthClient();

        const user = await UserModel.findOne({ firebaseId: uid });

        if (!user) {
            res.status(400).json({
                success: false,
                message: 'User not found.'
            });
            return;
        }

        const state = crypto.randomBytes(32).toString('hex');
        const uidString = uid || '';

        await oauthState.setEx(
            `oauth:state:${state}`,
            300, // TTL in seconds (5 minutes)
            uidString
        );

        const authorizationUrl = await generateOAuthUrl(oauth2Client, state);

        res.status(200).json({
            success: true,
            authorizationUrl: authorizationUrl
        });
    } catch (error) {
        logger.info('Not able to initiate gmail auth request', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate Google OAuth.'
        });
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
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
        // ========== STEP 1: Validate state from Redis ==========
        // State is the security token we created and stored in initiateGoogleOAuth
        // If state is invalid/missing, this is a suspicious request (CSRF attack)
        
        if (!state) {
            res.redirect(`${frontendUrl}/?gmail_error=missing_state`);
            return;
        }

        // Look up state in the local store to get the userId
        const uid = await oauthState.get(`oauth:state:${state}`);

        if (!uid) {
            res.redirect(`${frontendUrl}/?gmail_error=invalid_state`);
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
        const email = profile.data.emailAddress?.toLowerCase();

        if (!email) {
            res.redirect(`${frontendUrl}/?gmail_error=no_email`);
            return;
        }

        // ========== STEP 4: Check if this Gmail account already linked ==========
        const existingAccount = await GmailAccountModel.findOne({ userId: uid, emailAddress: email });

        let accountDocId: string;
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
            accountDocId = String(newGmailAccount._id);
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
            accountDocId = String(existingAccount._id);
        }

        // Mirror into local SQLite immediately so /api/accounts sees the new
        // account without a backend restart. First connected account becomes active.
        try {
            userLocalRepository.upsert(uid);
            accountLocalRepository.upsert({
                id: accountDocId,
                user_id: uid,
                email_address: email,
                config_json: '{}',
            });
            const hasActive = accountLocalRepository
                .findAllByUser(uid)
                .some((a) => a.is_active === 1);
            if (!hasActive) {
                accountLocalRepository.setActive(accountDocId, uid);
            }
        } catch (mirrorErr: any) {
            logger.info('Failed to mirror Gmail account into local DB:', mirrorErr?.message || mirrorErr);
        }

        // ========== STEP 5: Cleanup - Delete state from the local store ==========
        // State is one-time use. Delete it to prevent reuse.
        await oauthState.del(`oauth:state:${state}`);

        // Serve an HTML page that fires the deep link into the Tauri app
        // and then closes the browser tab. A plain redirect to emty:// leaves
        // the tab stuck on an error page in Chrome/Edge.
        const deepLink = process.env.FRONTEND_DEEP_LINK || 'emty://auth';
        const successUrl = `${deepLink}?gmail_success=true`;
        res.setHeader('Content-Type', 'text/html');
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Gmail Connected</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0f0f0f; color: #e5e5e5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { text-align: center; max-width: 380px; padding: 40px 32px;
            border: 1px solid #2a2a2a; background: #1a1a1a; border-radius: 12px; }
    .icon { font-size: 40px; margin-bottom: 16px; }
    h1 { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
    p  { font-size: 13px; color: #888; margin: 0; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h1>Gmail Connected</h1>
    <p>Returning you to Emty&hellip;<br/>If you are not redirected automatically, please click the button below.</p>
    <a href="${successUrl}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #e5e5e5; color: #0f0f0f; text-decoration: none; border-radius: 6px; font-weight: 600;">Open Emty App</a>
  </div>
  <script>
    // Fire the deep link so the Tauri app receives gmail_success
    window.location.href = '${successUrl}';
    // Attempt to close this tab after a short delay
    setTimeout(function() { window.close(); }, 800);
  </script>
</body>
</html>`);

    } catch (error: any) {
        logger.info('Gmail callback error:', error.message);
        const deepLink = process.env.FRONTEND_DEEP_LINK || 'emty://auth';
        const errorUrl = `${deepLink}?gmail_error=true`;
        res.setHeader('Content-Type', 'text/html');
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Connection Failed</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0f0f0f; color: #e5e5e5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; }
    .card { text-align: center; max-width: 380px; padding: 40px 32px;
            border: 1px solid #2a2a2a; background: #1a1a1a; border-radius: 12px; }
    .icon { font-size: 40px; margin-bottom: 16px; }
    h1 { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
    p  { font-size: 13px; color: #888; margin: 0; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x26A0;</div>
    <h1>Connection Failed</h1>
    <p>Something went wrong. Returning you to Emty&hellip;<br/>If you are not redirected automatically, please click the button below.</p>
    <a href="${errorUrl}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #e5e5e5; color: #0f0f0f; text-decoration: none; border-radius: 6px; font-weight: 600;">Return to Emty App</a>
  </div>
  <script>
    window.location.href = '${errorUrl}';
    setTimeout(function() { window.close(); }, 800);
  </script>
</body>
</html>`);
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
    const uid = req.user?.uid;
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
                    { _id: new Types.ObjectId(accountId as string) },
                    {
                        $set: {
                            accessToken: tokens.access_token,
                            tokenExpiry: tokens.expiry_date
                        }
                    }
                );
            } catch (error) {
                logger.info('Failed to refresh token:', error);
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

        logger.debug(`📧 Fetching ${maxResultsNum} emails for user ${uid}`);

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
                    logger.info(`Failed to fetch message ${msg.id}:`, error);
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
        logger.info('Error fetching emails:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch emails: ' + error.message
        });
    }
};

