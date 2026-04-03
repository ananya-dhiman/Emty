import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { UserIntentProfileModel } from "../model/UserIntentProfile";
import { GmailAccountModel } from "../model/GmailAccount";
import { runAndPersistColdStart } from "../services/coldStartService";
import { runScoringWorker } from "../services/scoringWorkerService";
import { runAiProcessingWorker } from "../services/aiProcessingWorkerService";

// ─── GET /api/intent/profile ─────────────────────────────────────────────────
// Returns the current UserIntentProfile for the authenticated user.
// Creates a default (empty) profile if none exists yet.
export const getIntentProfile = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const userId = req.user?.uid;

  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  try {
    const profile = await UserIntentProfileModel.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, profile });
  } catch (err: any) {
    console.error("[Intent] Error fetching profile:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch profile" });
  }
};

// ─── POST /api/intent/profile ─────────────────────────────────────────────────
// Upserts the UserIntentProfile with user-edited fields from onboarding Step 1.
// Body: {
//   includeKeywords?, preferredDomains?, excludeKeywords?, blockedDomains?,
//   inferredLabels?, userPrompt?, onboardingCompleted?
// }
export const upsertIntentProfile = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const userId = req.user?.uid;

  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const {
    includeKeywords,
    preferredDomains,
    excludeKeywords,
    blockedDomains,
    inferredLabels,
    userPrompt,
    onboardingCompleted,
  } = req.body;

  // Build update object — only include fields that were sent
  const update: Record<string, any> = { lastUpdated: new Date() };

  if (Array.isArray(includeKeywords)) update.includeKeywords = includeKeywords;
  if (Array.isArray(preferredDomains)) update.preferredDomains = preferredDomains;
  if (Array.isArray(excludeKeywords)) update.excludeKeywords = excludeKeywords;
  if (Array.isArray(blockedDomains)) update.blockedDomains = blockedDomains;
  if (Array.isArray(inferredLabels)) update.inferredLabels = inferredLabels;
  if (Array.isArray(userPrompt)) update.userPrompt = userPrompt;
  if (typeof onboardingCompleted === "boolean")
    update.onboardingCompleted = onboardingCompleted;

  try {
    const existingProfile = await UserIntentProfileModel.findOne({ userId })
      .select("onboardingCompleted")
      .lean();
    const wasOnboardingCompleted = existingProfile?.onboardingCompleted === true;

    const profile = await UserIntentProfileModel.findOneAndUpdate(
      { userId },
      { $set: update },
      { upsert: true, new: true }
    );

    // Trigger background sequence only when onboarding transitions false -> true.
    if (onboardingCompleted === true && !wasOnboardingCompleted) {
      console.log(`[ONBOARDING] Completed, starting background async sequence for user ${userId}`);
      (async () => {
        try {
          const account = await GmailAccountModel.findOne({ userId });
          if (account) {
            await runScoringWorker(userId, account._id.toString());
            await runAiProcessingWorker(userId, account._id.toString());
          }
        } catch (err: any) {
          console.error('[BACKGROUND SEQUENCE FAIL]', err.message);
        }
      })();
    }

    res.status(200).json({ success: true, profile });
  } catch (err: any) {
    console.error("[Intent] Error upserting profile:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to save profile" });
  }
};

// ─── PUT /api/intent/feedback ─────────────────────────────────────────────────
// Records a thumbs-up (boost) or thumbs-down (suppress) signal for one email.
// Body: { insightId: string, signal: "boost" | "suppress" }
export const recordFeedback = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const userId = req.user?.uid;

  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const { insightId, signal } = req.body;

  if (!insightId || !["boost", "suppress"].includes(signal)) {
    res
      .status(400)
      .json({ success: false, message: "insightId and signal (boost|suppress) are required" });
    return;
  }

  try {
    let update: Record<string, any>;

    if (signal === "boost") {
      update = {
        $addToSet: { boostedEmailIds: insightId },
        $pull: { suppressedEmailIds: insightId },
      };
    } else {
      update = {
        $addToSet: { suppressedEmailIds: insightId },
        $pull: { boostedEmailIds: insightId },
      };
    }

    const profile = await UserIntentProfileModel.findOneAndUpdate(
      { userId },
      { ...update, $set: { lastUpdated: new Date() } },
      { upsert: true, new: true }
    );

    res.status(200).json({ success: true, signal, insightId, profile });
  } catch (err: any) {
    console.error("[Intent] Error recording feedback:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to record feedback" });
  }
};

// ─── POST /api/intent/cold-start ─────────────────────────────────────────────
// Runs cold-start feature extraction over existing Insight records and
// persists inferred fields to UserIntentProfile. Called from SyncLoading.
// Body: { accountId: string, limit?: number }
export const triggerColdStart = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const userId = req.user?.uid;

  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const { accountId, limit } = req.body;

  if (!accountId) {
    res.status(400).json({ success: false, message: "accountId is required" });
    return;
  }

  try {
    // Verify account ownership
    const gmailAccount = await GmailAccountModel.findById(accountId);
    if (!gmailAccount || gmailAccount.userId !== userId) {
      res
        .status(403)
        .json({ success: false, message: "Unauthorized: invalid account" });
      return;
    }

    const result = await runAndPersistColdStart(
      userId,
      accountId,
      typeof limit === "number" ? limit : undefined
    );

    res.status(200).json({
      success: true,
      emailsScanned: result.emailsScanned,
      inferredKeywords: result.inferredKeywords,
      inferredDomains: result.inferredDomains,
      inferredLabels: result.inferredLabels,
    });
  } catch (err: any) {
    console.error("[Intent] Cold start failed:", err.message);
    // Non-blocking: still return OK so the sync loader can continue
    res.status(200).json({
      success: false,
      message: "Cold start extraction failed (non-blocking)",
      inferredKeywords: [],
      inferredDomains: [],
      inferredLabels: [],
    });
  }
};
