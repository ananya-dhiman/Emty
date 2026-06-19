import { Request, Response } from "express";
import { getActiveAccount } from "../db/repositories/accountLocalRepository";
import * as insightRepository from "../db/repositories/insightRepository";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";

export const getPendingNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeAccount = getActiveAccount();
    const accountId = activeAccount?.id;
    if (!accountId) {
      res.status(200).json({ success: true, notifications: [] });
      return;
    }

    const notifications: Array<{ id: string; title: string; body: string }> = [];
    const now = Date.now();

    // 1. Process Deadlines
    const insights = insightRepository.findAllByAccountId(accountId);
    for (const insight of insights) {
      if (insight.is_completed === 1) continue;
      // Filter out low priority insights
      if (insight.importance_score !== null && insight.importance_score < 0.5) continue;

      try {
        const datesArray = JSON.parse(insight.dates || "[]");
        for (const d of datesArray) {
          if (d.type !== "deadline") continue;
          const deadlineDate = new Date(d.date);
          const deadlineTime = deadlineDate.getTime();
          if (isNaN(deadlineTime)) continue;

          let urgency = "";
          const hoursUntil = (deadlineTime - now) / (1000 * 60 * 60);

          if (hoursUntil < 0) {
            urgency = "OVERDUE: ";
          } else if (hoursUntil <= 24 && deadlineDate.getDate() === new Date(now).getDate()) {
            urgency = "DUE TODAY: ";
          } else if (hoursUntil <= 48) {
            urgency = "UPCOMING: ";
          } else {
            continue; // Too far in the future
          }

          const title = `${urgency}Deadline - ${insight.from_name || insight.from_email}`;
          const body = insight.summary_snippet || insight.summary_intent || "Task requires attention";
          const id = `deadline-${insight.id}-${deadlineTime}`;

          notifications.push({ id, title, body });
        }
      } catch (e) {
        // Safe parse ignore
      }
    }

    // 2. Process Sync Complete
    const checkpoint = syncCheckpointRepository.getByAccountId(accountId);
    if (checkpoint && checkpoint.progress_stage === "completed" && (checkpoint.processed_candidates ?? 0) > 0) {
      const updatedAt = checkpoint.last_progress_at || checkpoint.updated_at || now;
      const id = `sync-complete-${updatedAt}`;
      notifications.push({
        id,
        title: "Emty Sync Complete",
        body: `Processed ${checkpoint.processed_candidates} emails.`,
      });
    }

    res.status(200).json({
      success: true,
      notifications,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
