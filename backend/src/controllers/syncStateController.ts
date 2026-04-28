import { Request, Response } from "express";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";
import * as accountLocalRepository from "../db/repositories/accountLocalRepository";
import logger from "../utils/logger";

export const getSyncState = async (req: Request, res: Response) => {
  try {
    const accountId = req.params.accountId as string;
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId" });
    }

    const state = syncCheckpointRepository.getByAccountId(accountId);
    if (!state) {
      return res.status(404).json({ error: "Sync state not found" });
    }

    return res.status(200).json(state);
  } catch (error: any) {
    logger.debug("Error getting sync state:", error);
    return res.status(500).json({ error: "Failed to get sync state" });
  }
};

export const getSyncStateActive = async (req: Request, res: Response) => {
  try {
    const activeAccount = accountLocalRepository.getActiveAccount();
    if (!activeAccount) {
      return res.status(404).json({ error: "No active account found" });
    }
logger.debug("activeAccount", activeAccount);
    const state = syncCheckpointRepository.getByAccountId(activeAccount.id);
    if (!state) {
      return res.status(404).json({ error: "Sync state not found" });
    }

    return res.status(200).json({ ...state, account_id: activeAccount.id });
  } catch (error: any) {
    logger.debug("Error getting active sync state:", error);
    return res.status(500).json({ error: "Failed to get active sync state" });
  }
};

export const setActiveAccount = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.body;
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId" });
    }

    const localAccount = accountLocalRepository.findById(accountId);
    if (!localAccount) {
      logger.debug("Account not found in local database, fetching from primary database");
      const gmailAccount = await GmailAccount.findUnique({ where: { id: accountId } });
      if (gmailAccount) {
        accountLocalRepository.upsert({
          id: accountId,
          user_id: gmailAccount.userId,
          email_address: gmailAccount.emailAddress,
          config_json: "{}"
        });
      } else {
        return res.status(404).json({ error: "Account not found in primary database" });
      }
    }

    accountLocalRepository.setActive(accountId);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.debug("Error setting active account:", error);
    return res.status(500).json({ error: "Failed to set active account" });
  }
};


export const updateSyncState = async (req: Request, res: Response) => {
  try {
    const accountId = req.params.accountId as string;
    const { sync_interval_minutes } = req.body;

    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId" });
    }

    const db = require("../db/sqlite").getDb();
    const now = Date.now();
    
    // Only update if provided
    if (sync_interval_minutes !== undefined) {
       db.prepare(`
        UPDATE sync_checkpoints
        SET sync_interval_minutes = ?, updated_at = ?
        WHERE account_id = ?
      `).run(sync_interval_minutes, now, accountId);
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    logger.debug("Error updating sync state:", error);
    return res.status(500).json({ error: "Failed to update sync state" });
  }
};

import incrementalSyncService from "../services/incrementalSyncService";
import { UserIntentProfile } from "../model/UserIntentProfile";
import { GmailAccount } from "../model/GmailAccount";

export const triggerSync = async (req: Request, res: Response) => {
  try {
    let { accountId, mode } = req.body;
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId" });
    }

    if (accountId === "active") {
      const activeAccount = accountLocalRepository.getActiveAccount();
      if (!activeAccount) {
        return res.status(404).json({ error: "No active account found" });
      }
      accountId = activeAccount.id;
    }

    (async () => {
      try {
        const gmailAccount = await GmailAccount.findUnique({ where: { id: accountId } });
        if (!gmailAccount) return;
        const intentProfile = await UserIntentProfile.findUnique({ where: { userId: gmailAccount.userId } });
        const canRunAiPipeline = intentProfile?.onboardingCompleted === true;

        const { runScoringWorker } = require("../services/scoringWorkerService");
        const { runAiProcessingWorker } = require("../services/aiProcessingWorkerService");

        const result = await incrementalSyncService.sync(accountId, canRunAiPipeline);

        if (result.success && result.processed >= 0 && canRunAiPipeline) {
          try {
            await runScoringWorker(gmailAccount.userId, accountId);
            await runAiProcessingWorker(gmailAccount.userId, accountId);
          } catch (err: any) {
            logger.info('[BACKGROUND SEQUENCE FAIL from triggerSync]', err.message || err);
            syncCheckpointRepository.markSyncError(accountId, err.message || String(err));
          }
        }
      } catch (error: any) {
        logger.debug(`Background sync failed for ${accountId}:`, error);
      }
    })();

    return res.status(202).json({ success: true, message: "Sync triggered" });
  } catch (error: any) {
    logger.debug("Error triggering sync:", error);
    return res.status(500).json({ error: "Failed to trigger sync" });
  }
};

