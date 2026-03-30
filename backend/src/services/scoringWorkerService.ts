import { Types } from "mongoose";
import { EmailMessageModel } from "../model/EmailMessage";
import { SyncCheckpointModel } from "../model/SyncCheckpoint";
import { computeBaseScore, getPriorityScoringContext } from "./focusBoardService";

/**
 * Scoring Worker Service
 * Runs asynchronously after fetching or after onboarding.
 * Recalculates scores for all emails in the staging EmailMessage table
 * based on the most up-to-date UserIntentProfile and Label priorities.
 */
export const runScoringWorker = async (userId: string, accountId: string): Promise<void> => {
    const objectIdAccountId = new Types.ObjectId(accountId);

    console.log(`[SCORING] Worker started for account ${accountId}`);
    
    // Update progress
    await SyncCheckpointModel.updateOne(
        { accountId: objectIdAccountId },
        {
            $set: {
                progressPercent: 60,
                progressStage: "scoring_emails",
                progressMessage: "Evaluating priority of emails...",
                lastProgressAt: new Date(),
            }
        }
    );

    try {
        const priorityScoringContext = await getPriorityScoringContext({
            userId,
            accountId,
        });

        // Loop through all EmailMessage documents for this account
        const emails = await EmailMessageModel.find({ accountId: objectIdAccountId });
        
        console.log(`[SCORING] Found ${emails.length} emails to score`);

        let processed = 0;
        for (const email of emails) {
            // Re-score based on extracted generic labels
            const baseScoreResult = computeBaseScore({
                importanceScore: undefined, // Will be set by AI processing later if selected
                labels: email.extractedFeatures.map(name => ({ name })),
                context: priorityScoringContext,
            });

            email.score = baseScoreResult.baseScore;
            // Clear prior priority decisions to evaluate fresh
            email.priorityState = 'pending';
            await email.save();
            
            processed++;
            if (processed % 100 === 0) {
                console.log(`[SCORING] Processed ${processed}/${emails.length}`);
            }
        }

        // Now, we need to pick the Top K (e.g., 50) and mark them as 'top', rest as 'low'
        const TOP_K = 50;
        const allScored = await EmailMessageModel.find({ accountId: objectIdAccountId })
            .sort({ score: -1, internalDate: -1 });

        let rank = 1;
        for (const item of allScored) {
            const newState = rank <= TOP_K ? 'top' : 'low';
            if (item.priorityState !== newState) {
                await EmailMessageModel.updateOne(
                    { _id: item._id },
                    { $set: { priorityState: newState } }
                );
            }
            rank++;
        }

        console.log(`[SCORING] Worker completed successfully`);

    } catch (error: any) {
        console.error(`[SCORING] Worker failed: ${error.message}`);
        throw error;
    }
};
