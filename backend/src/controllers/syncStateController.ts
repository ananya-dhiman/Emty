import { Request, Response } from "express";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";
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

export const triggerSync = async (req: Request, res: Response) => {
  try {
    const { accountId, mode } = req.body;
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId" });
    }

    // Fire and forget so we don't hold the HTTP request open for minutes
    incrementalSyncService.sync(accountId).catch((error) => {
      logger.debug(`Background sync failed for ${accountId}:`, error);
    });

    return res.status(202).json({ success: true, message: "Sync triggered" });
  } catch (error: any) {
    logger.debug("Error triggering sync:", error);
    return res.status(500).json({ error: "Failed to trigger sync" });
  }
};

