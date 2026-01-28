import express from 'express';
import { loginOrRegister, logout, verifyTokenEndpoint } from '../controllers/authController';
import { initiateGoogleOAuth, store_credentials, fetchUserEmails } from '../controllers/gmailAuthController';
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

/**
 * ========================================
 * Gmail OAuth Routes
 * ========================================
 * 
 * Flow:
 * 1. User clicks "Connect Gmail" on frontend
 * 2. Frontend calls POST /api/auth/google/initiate
 * 3. Backend generates OAuth URL with state
 * 4. Frontend redirects user to Google login
 * 5. User grants permissions
 * 6. Google redirects to /api/auth/google/callback?code=...&state=...
 * 7. Backend exchanges code for tokens & saves them
 * 8. User is connected!
 */

// POST /api/auth/google/initiate - Start Gmail OAuth flow
// Step 1: User sends request with their Firebase token
// Protected route (needs verifyToken middleware)
// Returns: authorizationUrl to redirect user to Google login
router.post('/google/initiate', verifyToken, initiateGoogleOAuth);

// GET /api/auth/google/callback - Google redirects here after user consent
// Step 2: Google sends authorization code & state parameter
// Public route (state in Redis links it to user)
// Returns: Success/failure of token exchange
router.get('/google/callback', store_credentials);

/**
 * ========================================
 * Email Fetch Routes
 * ========================================
 */

// GET /api/auth/emails - Fetch user's emails from connected Gmail account
// Headers: Authorization: Bearer <firebase-token>
// Query params:
//   - accountId: Gmail account MongoDB ID (required)
//   - query: Gmail search query (optional, e.g., "from:user@example.com")
//   - maxResults: Number of emails to fetch (default: 10, max: 100)
//   - pageToken: For pagination (optional)
// Returns: List of emails with subject, sender, body preview, etc.
router.get('/emails', verifyToken, fetchUserEmails);

export default router;
