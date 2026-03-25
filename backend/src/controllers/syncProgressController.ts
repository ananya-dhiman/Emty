import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { GmailAccountModel } from "../model/GmailAccount";
import { SyncCheckpointModel } from "../model/SyncCheckpoint";

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

    const checkpoint = await SyncCheckpointModel.findOne({
      accountId: gmailAccount._id,
    });
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
      syncState: checkpoint.syncState,
      progressPercent: checkpoint.progressPercent ?? 0,
      progressStage: checkpoint.progressStage ?? "initializing",
      progressMessage: checkpoint.progressMessage ?? "",
      totalCandidates: checkpoint.totalCandidates ?? 0,
      processedCandidates: checkpoint.processedCandidates ?? 0,
      updatedAt: (
        checkpoint.lastProgressAt ||
        checkpoint.updatedAt ||
        new Date()
      ).toISOString(),
    });
  } catch (error: any) {
    console.error("Error fetching sync progress:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sync progress: " + error.message,
    });
  }
};

