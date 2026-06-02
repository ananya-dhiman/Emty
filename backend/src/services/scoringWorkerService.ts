import { Types } from "mongoose";
import * as emailMessageRepository from "../db/repositories/emailMessageRepository";
import * as syncCheckpointRepository from "../db/repositories/syncCheckpointRepository";
import { computeBaseScore, getPriorityScoringContext } from "./focusBoardService";
import rulesEngine from "./rulesEngine";
import { UserModel } from "../model/User";
import { UserIntentProfileModel } from "../model/UserIntentProfile";

import logger from '../utils/logger';

/**
 * Scoring Worker Service
 * Runs asynchronously after fetching or after onboarding.
 * Recalculates scores for all emails in the staging EmailMessage table
 * based on the most up-to-date UserIntentProfile and Label priorities.
 */
export const runScoringWorker = async (userId: string, accountId: string): Promise<void> => {
    const objectIdAccountId = new Types.ObjectId(accountId);

    logger.debug(`[SCORING] Worker started for account ${accountId}`);

    // Update progress
    syncCheckpointRepository.updateProgress(objectIdAccountId.toString(), {
        progress_percent: 60,
        progress_stage: "scoring_emails",
        progress_message: "Evaluating priority of emails...",
        total_candidates: 0,
        processed_candidates: 0,
        last_progress_at: Date.now(),
    });

    try {
        const priorityScoringContext = await getPriorityScoringContext({
            userId,
            accountId,
        });

        // Loop through all unprocessed EmailMessage documents for this account
        const emails = emailMessageRepository.findByAccountId(objectIdAccountId.toString()).filter(e => e.ai_processed === 0);

        logger.debug(`[SCORING] Found ${emails.length} emails to score`);

        const profile: any = await UserIntentProfileModel.findOne({ userId }).lean();
        const preferences = {
            includeKeywords: profile?.includeKeywords || [],
            preferredDomains: profile?.preferredDomains || [],
            excludeKeywords: profile?.excludeKeywords || [],
            blockedDomains: profile?.blockedDomains || [],
        };

        let processed = 0;
        for (const email of emails) {
            const filterResult = rulesEngine.shouldProcessEmail({
                messageId: email.message_id,
                threadId: email.thread_id,
                from: email.from || '',
                subject: email.subject || '',
                snippet: email.snippet || '',
                internalDate: String(email.internal_date),
                hasAttachments: email.has_attachments === 1,
            }, preferences);

            let scoreToSave = 0;
            if (filterResult.process) {
                // Re-score based on extracted generic labels
                const baseScoreResult = computeBaseScore({
                    importanceScore: undefined, // Will be set by AI processing later if selected
                    labels: (email.extracted_features ? JSON.parse(email.extracted_features) : []).map((name: any) => ({ name })),
                    context: priorityScoringContext,
                });
                scoreToSave = baseScoreResult.baseScore;
            } else {
                scoreToSave = filterResult.score || 0.1; // Ensure it stays low
            }

            // Immediately mark it as 'low' if it was rejected, otherwise 'pending'
            const newPriorityState = filterResult.process ? "pending" : "low";

            emailMessageRepository.updatePriorityStateAndScore(email.id, scoreToSave, newPriorityState);

            processed++;
            if (processed % 100 === 0) {
                logger.debug(`[SCORING] Processed ${processed}/${emails.length}`);
            }
        }

        // Now, we need to pick the Top K (e.g., 50) and mark them as 'top', rest as 'low'
        const TOP_K = parseInt(process.env.TOP_K || '10', 10);
        const allScored = emailMessageRepository.findTopScoredByAccountId(objectIdAccountId.toString()).filter(e => e.ai_processed === 0);

        let rank = 1;
        for (const item of allScored) {
            // Only consider promoting to 'top' if it wasn't already marked as 'low' by the rules engine
            if (item.priority_state !== 'low') {
                const newState = rank <= TOP_K ? 'top' : 'pending';
                if (item.priority_state !== newState) {
                    emailMessageRepository.updatePriorityState(item.id, newState);
                }
                rank++;
            }
        }

        logger.debug(`[SCORING] Worker completed successfully`);

    } catch (error: any) {
        logger.info(`[SCORING] Worker failed: ${error.message}`);
        throw error;
    }
};
