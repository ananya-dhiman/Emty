import { Request, Response } from 'express';
import * as accountLocalRepository from '../db/repositories/accountLocalRepository';

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
