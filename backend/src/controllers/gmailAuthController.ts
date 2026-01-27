import { Request, Response } from 'express';
import { GmailAccountModel } from '../model/GmailAccount';
import { google } from 'googleapis';
import crypto from 'crypto';
import { client } from '../utils/redis';
import { createOAuthClient } from '../utils/createOAuth';
import { generateOAuthUrl, exchangeCodeForTokens, refreshAccessToken, revokeToken } from '../services/gmailAuth';
import {UserModel} from '../model/User';

// /auth/google
// ✔ req.user exists
// ✔ generate state
// ✔ redis SET state → userId (TTL)
// ✔ generate OAuth URL (pass state)
// ✔ redirect
export const initiateGoogleOAuth = async (req:Request, res:Response): Promise<void> => {
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
      await client.set(
            `oauth:state:${state}`,
            uid,
            { EX: 300 } // Time verification session is active for
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

export const store_credentials = async (req:Request, res:Response): Promise<void> => {
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