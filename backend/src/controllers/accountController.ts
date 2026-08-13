import { Request, Response } from 'express';
import * as accountLocalRepository from '../db/repositories/accountLocalRepository';
import { GmailAccountModel } from '../model/GmailAccount';
import { LabelModel } from '../model/Label';
import { LabelPriorityConfigModel } from '../model/LabelPriorityConfig';
import { revokeToken } from '../services/gmailAuth';
import logger from '../utils/logger';

/**
 * GET /api/accounts
 * Lists all Gmail accounts connected for the authenticated user.
 * Used by the widget account switcher and Profile page.
 */
export const listAccounts = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.uid;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const accounts = accountLocalRepository.findAllByUser(userId);

  res.json({
    success: true,
    accounts: accounts.map((a) => ({
      id: a.id,
      emailAddress: a.email_address,
      isActive: a.is_active === 1,
    })),
  });
};

/**
 * PUT /api/accounts/:id/active
 * Marks one of the authenticated user's accounts as the active one
 * (used by the sidecar's background sync and as the app-wide default).
 */
export const setActiveAccount = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.uid;
  const accountId = String(req.params.id || '');

  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  if (!accountId) {
    res.status(400).json({ success: false, message: 'account id is required' });
    return;
  }

  const account = accountLocalRepository
    .findAllByUser(userId)
    .find((a) => a.id === accountId);
  if (!account) {
    res.status(404).json({ success: false, message: 'Account not found' });
    return;
  }

  accountLocalRepository.setActive(accountId, userId);
  res.json({ success: true, accountId });
};

/**
 * DELETE /api/accounts/:id
 * Disconnects a Gmail account: revokes the Google token (best-effort),
 * removes the account + its labels/priorities from the primary DB, and
 * purges all locally stored data for it. If the removed account was the
 * active one, the first remaining account becomes active.
 */
export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (req as any).user?.uid;
  const accountId = String(req.params.id || '');

  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  if (!accountId) {
    res.status(400).json({ success: false, message: 'account id is required' });
    return;
  }

  try {
    const localAccount = accountLocalRepository
      .findAllByUser(userId)
      .find((a) => a.id === accountId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mongoDoc: any = null;
    try {
      mongoDoc = await GmailAccountModel.findById(accountId);
    } catch {
      // invalid ObjectId etc. — treat as not in primary DB (stale local row)
    }

    if (mongoDoc && mongoDoc.userId !== userId) {
      res.status(403).json({ success: false, message: 'Unauthorized: Invalid Gmail account' });
      return;
    }
    if (!mongoDoc && !localAccount) {
      res.status(404).json({ success: false, message: 'Account not found' });
      return;
    }

    if (mongoDoc) {
      // Best-effort revoke — an expired/already-revoked token must not block removal
      try {
        await revokeToken(mongoDoc.refreshToken || mongoDoc.accessToken || '');
      } catch (revokeErr: any) {
        logger.info('Token revoke failed (continuing with removal):', revokeErr?.message || revokeErr);
      }
      try {
        await LabelModel.deleteMany({ userId, accountId });
        await LabelPriorityConfigModel.deleteMany({ userId, accountId });
        await GmailAccountModel.deleteOne({ _id: accountId });
      } catch (mongoErr: any) {
        logger.info('Failed to remove account from primary DB:', mongoErr?.message || mongoErr);
        res.status(500).json({ success: false, message: 'Failed to remove account from primary DB' });
        return;
      }
    }

    const wasActive = localAccount?.is_active === 1;
    accountLocalRepository.purgeAccountData(accountId);

    const remaining = accountLocalRepository.findAllByUser(userId);
    if (wasActive && remaining.length > 0) {
      accountLocalRepository.setActive(remaining[0].id, userId);
    }

    res.json({
      success: true,
      accountId,
      accounts: accountLocalRepository.findAllByUser(userId).map((a) => ({
        id: a.id,
        emailAddress: a.email_address,
        isActive: a.is_active === 1,
      })),
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    logger.info('Error deleting account:', error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to remove account: ' + (error?.message || error) });
  }
};
