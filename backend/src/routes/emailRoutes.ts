import express from 'express';
import { verifyToken } from '../middleware/authMiddleware';
import { scanMetadata, deepProcessEmails, syncEmails, createLabel, listLabels } from '../controllers/emailController';

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
router.post('/labels', verifyToken, createLabel);
router.get('/labels', verifyToken, listLabels);

// POST /api/emails/sync - Incremental email sync (manual trigger)
// Protected route (needs verifyToken middleware)
// Body: { accountId: string }
// Returns: sync results with processed/succeeded/failed counts
router.post('/sync', verifyToken, syncEmails);

export default router;