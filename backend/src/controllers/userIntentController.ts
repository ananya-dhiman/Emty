import { Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { UserIntentProfileModel } from "../model/UserIntentProfile";
import { GmailAccountModel } from "../model/GmailAccount";
import * as insightRepository from "../db/repositories/insightRepository";
import * as emailMessageRepository from "../db/repositories/emailMessageRepository";
import * as feedbackRepository from "../db/repositories/feedbackRepository";
import { runAndPersistColdStart } from "../services/coldStartService";
import { runScoringWorker } from "../services/scoringWorkerService";
import { runAiProcessingWorker } from "../services/aiProcessingWorkerService";
import * as trainingDatasetRepository from "../db/repositories/trainingDatasetRepository";
import logger from '../utils/logger';

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
      { upsert: true, returnDocument: "after" }
    );

    res.status(200).json({ success: true, profile });
  } catch (err: any) {
    logger.info("[Intent] Error fetching profile:", err.message);
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
    profileType,
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

  if (profileType !== undefined) update.profileType = profileType;
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
      { upsert: true, returnDocument: "after" }
    );

    // Trigger background sequence only when onboarding transitions false -> true.
    if (onboardingCompleted === true && !wasOnboardingCompleted) {
      logger.debug(`[ONBOARDING] Completed, starting background async sequence for user ${userId}`);
      (async () => {
        try {
          const account = await GmailAccountModel.findOne({ userId });
          if (account) {
            await runScoringWorker(userId, account._id.toString());
            await runAiProcessingWorker(userId, account._id.toString());
          }
        } catch (err: any) {
          logger.info('[BACKGROUND SEQUENCE FAIL]', err.message);
        }
      })();
    }

    res.status(200).json({ success: true, profile });
  } catch (err: any) {
    logger.info("[Intent] Error upserting profile:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to save profile" });
  }
};

// ─── PUT /api/intent/feedback ─────────────────────────────────────────────────
// Records a thumbs-up (boost) or thumbs-down (suppress) signal for one email.
// Body: { insightId?: string, messageId?: string, signal: "boost" | "suppress" | "none" }
export const recordFeedback = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const userId = req.user?.uid;

  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const { insightId, messageId, signal } = req.body;

  if ((!insightId && !messageId) || !["boost", "suppress", "none"].includes(signal)) {
    res
      .status(400)
      .json({ success: false, message: "insightId or messageId, and valid signal (boost|suppress|none) are required" });
    return;
  }

  const targetId = insightId || messageId;

  try {
    let update: Record<string, any>;

    if (signal === "boost") {
      update = {
        $addToSet: { boostedEmailIds: targetId },
        $pull: { suppressedEmailIds: targetId },
      };
    } else if (signal === "suppress") {
      update = {
        $addToSet: { suppressedEmailIds: targetId },
        $pull: { boostedEmailIds: targetId },
      };
    } else {
      update = {
        $pull: { boostedEmailIds: targetId, suppressedEmailIds: targetId },
      };
    }

    const profile = await UserIntentProfileModel.findOneAndUpdate(
      { userId },
      { ...update, $set: { lastUpdated: new Date() } },
      { upsert: true, returnDocument: "after" }
    );

    // Telemetry logging
    try {
      let predictedScore = 0;
      let source: "ai_insight" | "pre_filter" = "ai_insight";

      if (insightId) {
        const insight = insightRepository.findById(insightId);
        if (insight) {
          predictedScore = typeof insight.base_score === 'number' ? insight.base_score :
                           typeof insight.importance_score === 'number' ? insight.importance_score : 0;
        }
      } else if (messageId) {
        const msg = emailMessageRepository.findById(messageId);
        if (msg) {
          predictedScore = typeof msg.score === 'number' ? msg.score : 0;
          source = "pre_filter";
        }
      }

      // Record feedback telemetry in local feedbackRepository
      feedbackRepository.create({
        user_id: userId,
        account_id: '',
        message_id: messageId || null,
        insight_id: insightId || null,
        thread_id: null,
        feedback_type: signal === 'boost' ? 'boosted' : signal === 'suppress' ? 'suppressed' : 'none',
        original_label: null,
        original_intent: null,
        original_score: predictedScore,
        corrected_label: null,
        corrected_intent: null,
        signal,
        source,
        used_in_training: 0,
        training_weight: null,
      });

        // Phase 6: Integrate with training_dataset for continuous learning
        try {
          if (insightId) {
            const insight = insightRepository.findById(insightId);
            if (insight && insight.email_ids) {
              let emailIds: string[] = [];
              try { emailIds = JSON.parse(insight.email_ids || '[]'); } catch {}
              let emails: any[] = [];
              try { emails = JSON.parse(insight.emails || '[]'); } catch {}
              const firstEmail = emails[0];
              if (firstEmail) {
                const parsedInternalDate = firstEmail.internalDate ? new Date(firstEmail.internalDate) : new Date();
                trainingDatasetRepository.create({
                  user_id: userId,
                  message_id: emailIds[0] || firstEmail.messageId,
                  subject: firstEmail.subject || '',
                  snippet: firstEmail.snippet || '',
                  from_domain: firstEmail.from?.domain || '',
                  has_attachment: (Array.isArray(firstEmail.attachments) && firstEmail.attachments.length > 0) ? 1 : 0,
                  hour_received: parsedInternalDate.getHours(),
                  is_weekend: [0, 6].includes(parsedInternalDate.getDay()) ? 1 : 0,
                  thread_size: emailIds.length || 1,
                  embedding: null,
                  final_label: signal === 'boost' ? 'important' : (signal === 'suppress' ? 'noise' : 'neutral'),
                  final_intent: insight.summary_intent || null,
                  label_source: 'user_feedback',
                  training_weight: 1.0,
                  confirmed_at: Date.now()
                });
              }
            }
          } else if (messageId) {
            const msg = emailMessageRepository.findById(messageId);
            if (msg) {
              const parsedInternalDate = msg.internal_date ? new Date(msg.internal_date) : new Date();
              let domain = '';
              if (msg.from) {
                const match = msg.from.match(/@([^>]+)>/);
                if (match) domain = match[1];
                else if (msg.from.includes('@')) domain = msg.from.split('@')[1];
              }
              trainingDatasetRepository.create({
                user_id: userId,
                message_id: messageId,
                subject: msg.subject || '',
                snippet: msg.snippet || '',
                from_domain: domain,
                has_attachment: msg.has_attachments ? 1 : 0,
                hour_received: parsedInternalDate.getHours(),
                is_weekend: [0, 6].includes(parsedInternalDate.getDay()) ? 1 : 0,
                thread_size: 1,
                embedding: null,
                final_label: signal === 'boost' ? 'important' : (signal === 'suppress' ? 'noise' : 'neutral'),
                final_intent: 'noise',
                label_source: 'user_feedback',
                training_weight: 1.0,
                confirmed_at: Date.now()
              });
            }
          }
        } catch (trainErr) {
           logger.debug("[Intent] Ignored error while persisting to training_dataset", trainErr);
        }

    } catch (logErr: any) {
      logger.info("[Intent] Error logging ranking feedback telemetry:", logErr.message);
    }

    res.status(200).json({ success: true, signal, insightId, messageId, profile });
  } catch (err: any) {
    logger.info("[Intent] Error recording feedback:", err.message);
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
    logger.info("[Intent] Cold start failed:", err.message);
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


