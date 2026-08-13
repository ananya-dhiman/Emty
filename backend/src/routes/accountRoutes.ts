import express from 'express';
import { verifyToken } from '../middleware/authMiddleware';
import { listAccounts, setActiveAccount, deleteAccount } from '../controllers/accountController';

const router = express.Router();

// GET /api/accounts - List all connected Gmail accounts for the authenticated user
router.get('/', verifyToken, listAccounts);

// PUT /api/accounts/:id/active - Switch the user's active account
router.put('/:id/active', verifyToken, setActiveAccount);

// DELETE /api/accounts/:id - Disconnect an account (revoke token + purge data)
router.delete('/:id', verifyToken, deleteAccount);

export default router;
