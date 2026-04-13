import { Types } from "mongoose";
import { EmailMessage } from "../model/EmailMessage";
import { SyncCheckpoint } from "../model/SyncCheckpoint";
import { computeBaseScore, getPriorityScoringContext } from "./focusBoardService";

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
    await SyncCheckpoint.updateMany(
        { where: { accountId: objectIdAccountId.toString() } },
        {
            progressPercent: 60,
            progressStage: "scoring_emails",
            progressMessage: "Evaluating priority of emails...",
            lastProgressAt: new Date(),
        }
    );

    try {
        const priorityScoringContext = await getPriorityScoringContext({
            userId,
            accountId,
        });

        // Loop through all EmailMessage documents for this account
        const emails = await EmailMessage.findMany({ where: { accountId: objectIdAccountId.toString() } });
        
        logger.debug(`[SCORING] Found ${emails.length} emails to score`);

        let processed = 0;
        for (const email of emails) {
            // Re-score based on extracted generic labels
            const baseScoreResult = computeBaseScore({
                importanceScore: undefined, // Will be set by AI processing later if selected
                labels: email.extractedFeatures.map(name => ({ name })),
                context: priorityScoringContext,
            });

            await EmailMessage.update(
                { where: { id: email.id } },
                {
                    score: baseScoreResult.baseScore,
                    priorityState: 'pending',
                }
            );
            
            processed++;
            if (processed % 100 === 0) {
                logger.debug(`[SCORING] Processed ${processed}/${emails.length}`);
            }
        }

        // Now, we need to pick the Top K (e.g., 50) and mark them as 'top', rest as 'low'
        const TOP_K = 50;
        const allScored = await EmailMessage.findMany({
            where: { accountId: objectIdAccountId.toString() },
            orderBy: [{ score: "desc" }, { internalDate: "desc" }],
        });

        let rank = 1;
        for (const item of allScored) {
            const newState = rank <= TOP_K ? 'top' : 'low';
            if (item.priorityState !== newState) {
                await EmailMessage.update(
                    { where: { id: item.id } },
                    { priorityState: newState }
                );
            }
            rank++;
        }

        logger.debug(`[SCORING] Worker completed successfully`);

    } catch (error: any) {
        logger.info(`[SCORING] Worker failed: ${error.message}`);
        throw error;
    }
};


