import express from 'express';
import { verifyToken } from '../middleware/authMiddleware';
import { scanMetadata, deepProcessEmails } from '../controllers/emailController';

const router = express.Router();

/**
 * Email Scanning Routes
 * 
 */

// POST /api/emails/scan-metadata - Scan Gmail for metadata and apply cheap filtering
// Protected route (needs verifyToken middleware)
// Body: { maxResults?: number, pageToken?: string }
// Returns: filtered metadata list
router.post('/scan-metadata', verifyToken, scanMetadata);

// POST /api/emails/deep-process - Process filtered emails with AI
// Protected route (needs verifyToken middleware)
// Body: { accountId: string, filteredMetadata: array }
// Returns: processed insights and persistence status
router.post('/deep-process', verifyToken, deepProcessEmails);

export default router;