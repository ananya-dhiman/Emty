import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { GmailAccountModel } from "../model/GmailAccount";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";

import logger from '../utils/logger';

export const getSyncProgress = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const uid = req.user?.uid;
  const accountId = req.query.accountId as string;

  if (!uid || !accountId) {
    res.status(400).json({
      success: false,
      message: "accountId is required",
    });
    return;
  }

  try {
    const gmailAccount = await GmailAccountModel.findById(accountId);
    if (!gmailAccount || gmailAccount.userId !== uid) {
      res.status(403).json({
        success: false,
        message: "Unauthorized: Invalid Gmail account",
      });
      return;
    }

    const checkpoint = syncCheckpointRepository.getByAccountId(accountId);
    if (!checkpoint) {
      res.status(200).json({
        success: true,
        syncState: "idle",
        progressPercent: 0,
        progressStage: "initializing",
        progressMessage: "Waiting to start sync...",
        totalCandidates: 0,
        processedCandidates: 0,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

      res.status(200).json({
        success: true,
        syncState: checkpoint.sync_state,
        progressPercent: checkpoint.progress_percent ?? 0,
        progressStage: checkpoint.progress_stage ?? "initializing",
        progressMessage: checkpoint.progress_message ?? "",
        totalCandidates: checkpoint.total_candidates ?? 0,
        processedCandidates: checkpoint.processed_candidates ?? 0,
        updatedAt: new Date(
          checkpoint.last_progress_at || checkpoint.updated_at || Date.now()
        ).toISOString(),
    });
  } catch (error: any) {
    logger.info("Error fetching sync progress:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sync progress: " + error.message,
    });
  }
};



