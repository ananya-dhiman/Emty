import { Request, Response, NextFunction } from 'express';
import admin from '../config/firebase';

/**
 * Authentication Middleware
 * Verifies Firebase ID token from Authorization header
 * Attaches user info to request object
 */

// Extend Express Request type to include user
export interface AuthRequest extends Request {
    user?: {
        uid: string;
        email?: string;
        name?: string;
    };
}

/**
 * Middleware to verify Firebase token
 * Usage: Add to any route that requires authentication
 * Example: router.get('/protected', verifyToken, controller)
 */
export const verifyToken = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Get token from Authorization header (format: "Bearer <token>")
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({
                success: false,
                message: 'No token provided. Please include Authorization header with Bearer token.'
            });
            return;
        }

        // Extract token
        const token = authHeader.split('Bearer ')[1];

        // Verify token with Firebase Admin
        const decodedToken = await admin.auth().verifyIdToken(token);

        // Attach user info to request
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            name: decodedToken.name
        };

        next();
    } catch (error: any) {
        console.error('Token verification error:', error.message);
        res.status(401).json({
            success: false,
            message: 'Invalid or expired token. Please login again.'
        });
    }
};
