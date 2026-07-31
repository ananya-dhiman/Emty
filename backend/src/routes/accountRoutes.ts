import express from 'express';
import { verifyToken } from '../middleware/authMiddleware';
import { listAccounts } from '../controllers/accountController';

const router = express.Router();

// GET /api/accounts - List all connected Gmail accounts for the authenticated user
router.get('/', verifyToken, listAccounts);

export default router;
