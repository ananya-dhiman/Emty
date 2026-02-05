import express from 'express';
import { verifyToken } from '../middleware/authMiddleware';
import { scanMetadata } from '../controllers/emailController';

const router = express.Router();

/**
 * Email Scanning Routes
 * 
 */

// get/api/emails/scan-metadata - Scan Gmail for metadata and apply cheap filtering
// Protected route (needs verifyToken middleware)
// Body: { maxResults?: number, pageToken?: string }
// Returns: filtered metadata list
router.get('/scan-metadata', verifyToken, scanMetadata);

export default router;