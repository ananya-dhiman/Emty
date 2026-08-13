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
        // 'idle' is a terminal stage for the UI — a never-synced account
        // must not render as "syncing".
        progressStage: "idle",
        progressPercent: 0,
        progressMessage: "Waiting to start sync...",
        totalCandidates: 0,
        processedCandidates: 0,
        lastProgressAt: null,
        isStalled: false,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const stage = checkpoint.progress_stage ?? "initializing";
    const lastProgressAt = checkpoint.last_progress_at || checkpoint.updated_at || null;
    const STALL_THRESHOLD_MS = 10 * 60 * 1000;
    const isTerminal = ["completed", "error", "idle"].includes(stage);
    const isStalled =
      !isTerminal && !!lastProgressAt && Date.now() - lastProgressAt > STALL_THRESHOLD_MS;

    res.status(200).json({
        success: true,
        syncState: checkpoint.sync_state,
        progressPercent: checkpoint.progress_percent ?? 0,
        progressStage: stage,
        progressMessage: checkpoint.progress_message ?? "",
        totalCandidates: checkpoint.total_candidates ?? 0,
        processedCandidates: checkpoint.processed_candidates ?? 0,
        lastProgressAt: lastProgressAt ? new Date(lastProgressAt).toISOString() : null,
        isStalled,
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



