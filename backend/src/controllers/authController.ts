import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { UserModel } from '../model/User';
import { GmailAccountModel } from '../model/GmailAccount';
import admin from '../config/firebase';
import mongoose from 'mongoose';
import logger from '../utils/logger';
import crypto from 'crypto';
import { createOAuthClient } from '../utils/createOAuth';
import { client } from '../utils/redis';
import { google } from 'googleapis';

const buildAiSettingsResponse = async (_user: any) => ({
    provider: 'ollama',
    model: process.env.OLLAMA_MODEL || 'llama2',
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
});

/**
 * Authentication Controller
 * Handles user registration, login, and logout operations
 * Simple and generalized for any Firebase + MongoDB project
 */

/**
 * Register or Login User
 * Creates new user if doesn't exist, or returns existing user
 * Frontend should send Firebase ID token after Firebase Auth
 */
export const loginOrRegister = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { token } = req.body;

        if (!token) {
            res.status(400).json({
                success: false,
                message: 'Firebase token is required'
            });
            return;
        }

        // Verify Firebase token
        const decodedToken = await admin.auth().verifyIdToken(token);
        const { uid, email, name, picture } = decodedToken;

        // Check if user exists FIRST before enforcing email 
        // (Custom Tokens from Desktop OAuth won't bind email to the ID token immediately)
        let user = await UserModel.findOne({ firebaseId: uid });

        if (!user) {
             if (!email) {
                 res.status(400).json({
                     success: false,
                     message: 'Email is required for registration'
                 });
                 return;
             }

            // Create new user
            user = new UserModel({
                _id: new mongoose.Types.ObjectId(),
                firebaseId: uid,
                email: email,
                name: name || '',
                avatar: picture || ''
            });
            await user.save();
        }

        // Check if Gmail is connected — return ALL accounts, oldest first,
        // so gmailAccountId stays deterministic (first-connected account).
        const gmailAccounts = await GmailAccountModel.find({ userId: uid }).sort({ createdAt: 1 });
        const gmailAccount = gmailAccounts[0] || null;
        const isGmailConnected = !!gmailAccount;

        res.status(200).json({
            success: true,
            message: 'Authentication successful',
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                firebaseId: user.firebaseId,
                isGmailConnected,
                gmailAccountId: gmailAccount ? gmailAccount._id : null,
                accounts: gmailAccounts.map((a) => ({ id: String(a._id), emailAddress: a.emailAddress })),
                ai: await buildAiSettingsResponse(user),
            }
        });
    } catch (error: any) {
        logger.info('Login/Register error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Authentication failed. Please try again.'
        });
    }
};

/**
 * Logout User
 * Client-side should clear token from storage
 * This endpoint is optional, mainly for logging purposes
 */
export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        res.status(200).json({
            success: true,
            message: 'Logout successful. Please clear token from client.'
        });
    } catch (error: any) {
        logger.info('Logout error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Logout failed'
        });
    }
};

/**
 * Verify Token
 * Protected route to verify if token is still valid
 * Returns current user data
 */
export const verifyTokenEndpoint = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        // User info is already attached by middleware
        if (!req.user) {
            res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
            return;
        }

        // Get user from database
        const user = await UserModel.findOne({ firebaseId: req.user.uid });

        if (!user) {
            res.status(404).json({
                success: false,
                message: 'User not found'
            });
            return;
        }

        const gmailAccounts = await GmailAccountModel.find({ userId: req.user.uid }).sort({ createdAt: 1 });
        const gmailAccount = gmailAccounts[0] || null;
        const isGmailConnected = !!gmailAccount;

        res.status(200).json({
            success: true,
            message: 'Token is valid',
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                firebaseId: user.firebaseId,
                isGmailConnected,
                gmailAccountId: gmailAccount ? gmailAccount._id : null,
                accounts: gmailAccounts.map((a) => ({ id: String(a._id), emailAddress: a.emailAddress })),
                ai: await buildAiSettingsResponse(user),
            }
        });
    } catch (error: any) {
        logger.info('Verify token error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Token verification failed'
        });
    }
};

export const getAiSettings = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.user?.uid) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const user = await UserModel.findOne({ firebaseId: req.user.uid });
        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }

        res.status(200).json({
            success: true,
            ai: await buildAiSettingsResponse(user),
        });
    } catch (error: any) {
        logger.info('Get AI settings error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch AI settings' });
    }
};

export const updateAiSettings = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.user?.uid) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const user = await UserModel.findOne({ firebaseId: req.user.uid });
        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }

        res.status(200).json({
            success: true,
            ai: await buildAiSettingsResponse(user),
        });
    } catch (error: any) {
        logger.info('Update AI settings error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update AI settings' });
    }
};

/**
 * =========================================
 * Desktop Google Login Fallback via Backend
 * =========================================
 */
export const initiateDesktopOAuth = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const oauth2Client = createOAuthClient();
        const state = crypto.randomBytes(32).toString('hex');
        
        await client.setEx(
            `desktop_oauth:state:${state}`,
            300, 
            'pending'
        );

        const authorizationUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'select_account',
            scope: ['profile', 'email'],
            state: `desktop_login_${state}`
        });

        res.redirect(authorizationUrl);
    } catch (error) {
        logger.debug("Failed to initiate Desktop OAuth", error);
        res.status(500).send("Failed to initiate Google Login.");
    }
};

const renderOAuthRedirectHtml = (res: Response, targetUrl: string, isSuccess: boolean) => {
    const title = isSuccess ? 'Login Successful' : 'Login Failed';
    const icon = isSuccess ? '&#10003;' : '&#x26A0;';
    const message = isSuccess 
        ? 'Returning you to Emty&hellip;<br/>If you are not redirected automatically, please click the button below.'
        : 'Something went wrong. Returning you to Emty&hellip;<br/>If you are not redirected automatically, please click the button below.';
        
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
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
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${targetUrl}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #e5e5e5; color: #0f0f0f; text-decoration: none; border-radius: 6px; font-weight: 600;">Open Emty App</a>
  </div>
  <script>
    window.location.href = '${targetUrl}';
    setTimeout(function() { window.close(); }, 800);
  </script>
</body>
</html>`);
};

export const desktopOAuthCallback = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const code = req.query.code as string;
        const stateParam = req.query.state as string;

        const frontendUrl = process.env.FRONTEND_DEEP_LINK || 'emty://auth';

        if (!stateParam || !stateParam.startsWith('desktop_login_')) {
            renderOAuthRedirectHtml(res, `${frontendUrl}?error=invalid_state`, false);
            return;
        }

        const stateId = stateParam.replace('desktop_login_', '');
        const stateExists = await client.get(`desktop_oauth:state:${stateId}`);

        if (!stateExists) {
            renderOAuthRedirectHtml(res, `${frontendUrl}?error=session_expired`, false);
            return;
        }

        const oauth2Client = createOAuthClient();
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfoRes = await oauth2.userinfo.get();
        const googleUser = userInfoRes.data;

        if (!googleUser.email) {
            renderOAuthRedirectHtml(res, `${frontendUrl}?error=no_email`, false);
            return;
        }

        const uid = googleUser.id!; 

        // Upsert user in database
        let user = await UserModel.findOne({ email: googleUser.email });
        if (!user) {
            user = new UserModel({
                _id: new mongoose.Types.ObjectId(),
                firebaseId: uid,
                email: googleUser.email,
                name: googleUser.name || '',
                avatar: googleUser.picture || ''
            });
            await user.save();
        } else if (!user.firebaseId || user.firebaseId !== uid) {
            user.firebaseId = uid;
            await user.save();
        }

        const customToken = await admin.auth().createCustomToken(user.firebaseId);

        await client.del(`desktop_oauth:state:${stateId}`);

        renderOAuthRedirectHtml(res, `${frontendUrl}?desktop_login_token=${customToken}`, true);
    } catch (error: any) {
        logger.debug('Desktop OAuth Callback Error', error);
        const frontendUrl = process.env.FRONTEND_DEEP_LINK || 'emty://auth';
        renderOAuthRedirectHtml(res, `${frontendUrl}?error=auth_failed`, false);
    }
};


