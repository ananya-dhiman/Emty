import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { UserModel } from '../model/User';
import admin from '../config/firebase';
import mongoose from 'mongoose';

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
                    firebaseId: user.firebaseId
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
                    firebaseId: user.firebaseId
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

        res.status(200).json({
            success: true,
            message: 'Token is valid',
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                firebaseId: user.firebaseId
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
