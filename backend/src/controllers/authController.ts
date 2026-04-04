import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { UserModel } from '../model/User';
import { GmailAccountModel } from '../model/GmailAccount';
import admin from '../config/firebase';
import mongoose from 'mongoose';
import { getDailyQuotaLimit, getDailyUsageStatus } from '../services/aiUsageService';
import { maskKey } from '../services/aiProviderService';

const buildAiSettingsResponse = async (user: any) => {
    const geminiKey = user?.aiSettings?.geminiApiKey || '';
    const openaiKey = user?.aiSettings?.openaiApiKey || '';
    const hasGeminiKey = Boolean(geminiKey);
    const hasOpenaiKey = Boolean(openaiKey);
    const hasByok = hasGeminiKey || hasOpenaiKey;
    const quotaLimit = getDailyQuotaLimit(hasByok);
    const usage = await getDailyUsageStatus(user.firebaseId, quotaLimit);

    return {
        hasGeminiKey,
        hasOpenaiKey,
        geminiKeyMasked: maskKey(geminiKey),
        openaiKeyMasked: maskKey(openaiKey),
        preferredProvider: user?.aiSettings?.preferredProvider || 'gemini',
        preferredModel: user?.aiSettings?.preferredModel || null,
        ...usage,
    };
};

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

        if (!email) {
            res.status(400).json({
                success: false,
                message: 'Email is required for registration'
            });
            return;
        }

        // Check if user exists
        let user = await UserModel.findOne({ firebaseId: uid });

        // Check if Gmail is connected
        const gmailAccount = await GmailAccountModel.findOne({ userId: uid });
        const isGmailConnected = !!gmailAccount;

        if (!user) {
            // Create new user
            user = new UserModel({
                _id: new mongoose.Types.ObjectId(),
                firebaseId: uid,
                email: email,
                name: name || '',
                avatar: picture || ''
            });
            await user.save();

            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                    firebaseId: user.firebaseId,
                    isGmailConnected,
                    gmailAccountId: gmailAccount ? gmailAccount._id : null,
                    ai: await buildAiSettingsResponse(user),
                }
            });
        } else {
            // User exists, return user data
            res.status(200).json({
                success: true,
                message: 'Login successful',
                user: {
                    id: user._id,
                    email: user.email,
                    name: user.name,
                    avatar: user.avatar,
                    firebaseId: user.firebaseId,
                    isGmailConnected,
                    gmailAccountId: gmailAccount ? gmailAccount._id : null,
                    ai: await buildAiSettingsResponse(user),
                }
            });
        }
    } catch (error: any) {
        console.error('Login/Register error:', error.message);
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
        console.error('Logout error:', error.message);
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

        const gmailAccount = await GmailAccountModel.findOne({ userId: req.user.uid });
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
                ai: await buildAiSettingsResponse(user),
            }
        });
    } catch (error: any) {
        console.error('Verify token error:', error.message);
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
        console.error('Get AI settings error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch AI settings' });
    }
};

export const updateAiSettings = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.user?.uid) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { geminiApiKey, openaiApiKey, preferredProvider, preferredModel } = req.body || {};
        const updatePayload: any = {};

        if (geminiApiKey !== undefined) {
            updatePayload['aiSettings.geminiApiKey'] = String(geminiApiKey || '').trim() || null;
        }
        if (openaiApiKey !== undefined) {
            updatePayload['aiSettings.openaiApiKey'] = String(openaiApiKey || '').trim() || null;
        }
        if (preferredProvider !== undefined) {
            updatePayload['aiSettings.preferredProvider'] = preferredProvider === 'openai' ? 'openai' : 'gemini';
        }
        if (preferredModel !== undefined) {
            updatePayload['aiSettings.preferredModel'] = String(preferredModel || '').trim() || null;
        }

        let user = null;
        if (Object.keys(updatePayload).length === 0) {
            user = await UserModel.findOne({ firebaseId: req.user.uid });
        } else {
            user = await UserModel.findOneAndUpdate(
                { firebaseId: req.user.uid },
                { $set: updatePayload },
                { new: true }
            );
        }

        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }

        res.status(200).json({
            success: true,
            message: 'AI settings updated',
            ai: await buildAiSettingsResponse(user),
        });
    } catch (error: any) {
        console.error('Update AI settings error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update AI settings' });
    }
};
