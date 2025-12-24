import { Request, Response } from 'express';
import { GmailAccountModel } from '../model/GmailAccount';
import { google } from 'googleapis';

export { generateOAuthUrl, exchangeCodeForTokens, refreshAccessToken, revokeToken } from '../services/gmailAuth';
export { createOAuthClient } from '../utils/createOAuth';
//   /auth/google/callback  ---> Controller
//     |-- Create OAuthClient
//     |-- exchangeCodeForTokens()
//     |-- oauth2Client.setCredentials()
//     |-- gmail.users.getProfile()
//     |-- DB checks
//     |-- persist GmailAccount
//     |-- response

export const store_credentials = async (req:Request, res:Response): Promise<void> => {
    const oauth2Client = createOAuthClient();
    const {code}= req.query.code;


    try {
        const tokens = await exchangeCodeForTokens(code,oauth2Client);
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const profile = await gmail.users.getProfile({userId: 'me'});
        const uid= req.user?.uid; 

        const email= profile.data.emailAddress;
        if(!uid){
            res.status(400).json({
                success: false,
                message: 'User not authenticated.'
            });
            return;
        }
        
        //Handle case where gmailAccount already exists
        const existingAccount = await GmailAccountModel.findOne({userId: uid, emailAddress: email});
        
        if(!existingAccount){
        
        const newGmailAccount = new GmailAccountModel({
                        userId: uid,
                        emailAddress: email,
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        tokenExpiry: tokens.expiry_date
                    });
        await newGmailAccount.save();
        }
            //If account already exists then 
            // Update access token

            // Update expiry

            // Only update refresh token if a new one is returned
                
        const updateFields: Record<string, any> = {
            accessToken: tokens.access_token,
            tokenExpiry: tokens.expiry_date,
        };

        if (tokens.refresh_token !== undefined) {
            updateFields.refreshToken = tokens.refresh_token;
        }

       await GmailAccountModel.updateOne(
            { userId: uid, emailAddress: email },
            { $set: updateFields }
        );
         

        res.status(200).json({
            success: true,
            message: 'New Gmail account created/update successfully.'
        });
    } catch (error: any) {
        console.error('Gmail callback error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Verififcation failed: ' + error.message
        });
    }
};