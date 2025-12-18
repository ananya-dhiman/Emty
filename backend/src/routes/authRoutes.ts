import express from 'express';
import { loginOrRegister, logout, verifyTokenEndpoint } from '../controllers/authController';
import { verifyToken } from '../middleware/authMiddleware';

const router = express.Router();

/**
 * Authentication Routes
 * Simple and generalized for any Firebase project
 */

// POST /api/auth/login - Login or Register user
// Body: { token: "firebase-id-token" }
router.post('/login', loginOrRegister);

// POST /api/auth/logout - Logout user (optional endpoint)
router.post('/logout', logout);

// GET /api/auth/verify - Verify token and get user data
// Headers: Authorization: Bearer <firebase-token>
router.get('/verify', verifyToken, verifyTokenEndpoint);

export default router;
