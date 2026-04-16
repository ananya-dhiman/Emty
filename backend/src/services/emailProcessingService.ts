/**
 * Email Deep Processing Service
 * Fetches full email content and processes it with AI to extract insights
 */

import { google } from 'googleapis';
import { fetchFullEmailBody, extractEmailBody, extractAttachmentMetadata } from './emailBodyService';
import { extractInsightsFromEmail, AIInsightExtraction, AIParsingError } from './aiService';
import { AIResolvedContext } from './aiProviderService';
import logger from '../utils/logger';

export interface ProcessedEmailInsight {
    messageId: string;
    threadId: string;
    from: {
        email: string;
        name?: string;
        domain?: string;
    };
    subject: string;
    internalDate: string;
    insights: AIInsightExtraction;
    attachmentMetadata: Array<{
        filename: string;
        mimeType: string;
        size: number;
        messageId: string;
    }>;
    labelMode?: 'existing' | 'new';
    confidence?: number;
    labelReason?: string;
}

/**
 * Parse email address from "Name <email@domain.com>" format
 */
const parseEmailAddress = (
    fromString: string
): { email: string; name?: string; domain?: string } => {
    const emailMatch = fromString.match(/<(.+?)>/);
    const email = emailMatch ? emailMatch[1] : fromString;

    let name: string | undefined;
    if (emailMatch) {
        name = fromString.substring(0, fromString.indexOf('<')).trim();
        name = name.replace(/^["']|["']$/g, ''); // Remove quotes
    }

    const domainMatch = email.match(/@(.+)/);
    const domain = domainMatch ? domainMatch[1] : undefined;

    return { email, name: name || undefined, domain };
};

/**
 * Fetch full email content and process with AI
 */
export const processEmailDeep = async (
    gmail: any,
    messageId: string,
    threadId: string,
    internalDate: string,
    metadata: { from: string; subject: string; snippet: string },
    relevantLabels: Array<{ name: string; description?: string }> = [],
    options: {
        userId?: string;
        aiContext?: AIResolvedContext;
        stage2Candidates?: Array<{ name: string; similarityScore: number; labelMode: string }>;
        prefetchedBody?: { body: string; payload: any; headers: any[] };
        onFallback?: (notice: {
            usedSharedFallback: boolean;
            reason: string;
            fromProvider?: string;
            fromModel?: string;
            toProvider?: string;
            toModel?: string;
        }) => Promise<void> | void;
    } = {}
): Promise<ProcessedEmailInsight> => {
    try {
        let body = '';
        let payload = null;
        let headers: any[] = [];

        if (options.prefetchedBody) {
            body = options.prefetchedBody.body;
            payload = options.prefetchedBody.payload;
            headers = options.prefetchedBody.headers;
        } else {
            // Fetch full message if not prefetched
            const fullMessageResult = await fetchFullEmailBody(gmail, messageId);
            body = fullMessageResult.body;
            payload = fullMessageResult.payload;
            headers = fullMessageResult.headers;
        }

        // Extract fields
        const from = headers.find((h: any) => h.name === 'From')?.value || metadata.from;
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || metadata.subject;
        body = body || metadata.snippet; // fallback to snippet
        const attachmentMetadata = extractAttachmentMetadata(payload, messageId);
        const parsedFrom = parseEmailAddress(from);

        // Call AI service to extract insights
        const insights = await extractInsightsFromEmail({
            from,
            subject,
            body,
            internalDate,
            relevantLabels,
        }, {
            userId: options.userId,
            context: options.aiContext,
            stage2Candidates: options.stage2Candidates,
            onFallback: options.onFallback,
        });

        return {
            messageId,
            threadId,
            from: parsedFrom,
            subject,
            internalDate,
            insights,
            attachmentMetadata,
            labelMode: (insights as any).labelMode,
            confidence: (insights as any).confidence,
            labelReason: (insights as any).labelReason,
        };
    } catch (error) {
        if (error instanceof AIParsingError) {
            logger.info(`AI parsing failed for email ${messageId}. Raw response below:`);
            logger.info(error.raw);
        }
        logger.info(`Error processing email ${messageId}:`, error);
        throw error;
    }
};
