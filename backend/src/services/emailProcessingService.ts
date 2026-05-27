/**
 * Email Deep Processing Service
 * Fetches full email content and processes it with AI to extract insights
 */

import { google } from 'googleapis';
import { fetchFullEmailBody, extractEmailBody, extractAttachmentMetadata, PreExtractedLink } from './emailBodyService';
import { extractInsightsFromEmail, AIInsightExtraction, AIParsingError } from './aiService';
import { AIResolvedContext } from './aiProviderService';
import { UserIntentProfile } from '../model/UserIntentProfile';
import { decryptApiKey } from '../utils/cryptoService';
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

// ─── Email Classifier ─────────────────────────────────────────────────────────

type EmailClass = 'routine' | 'sensitive' | 'normal';

const SENSITIVE_KEYWORDS = [
  'bank account', 'password', 'otp', 'transaction', 'credit card',
  'diagnosis', 'prescription', 'medical report', 'test results',
  'legal notice', 'court', 'lawsuit', 'confidential',
  'salary', 'aadhaar', 'pan card', 'passport', 'social security',
];

function classifyEmail(from: string, subject: string, body: string): EmailClass {
  if (/newsletter|unsubscribe|noreply|notification/i.test(from)) return 'routine';
  const text = `${subject} ${body}`.toLowerCase();
  if (SENSITIVE_KEYWORDS.some(kw => text.includes(kw))) return 'sensitive';
  return 'normal';
}

// ─── Deep Processing ──────────────────────────────────────────────────────────

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
        prefetchedBody?: { body: string; payload: any; headers: any[]; preExtractedLinks?: PreExtractedLink[] };
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
        let preExtractedLinks: PreExtractedLink[] = [];

        if (options.prefetchedBody) {
            body = options.prefetchedBody.body;
            payload = options.prefetchedBody.payload;
            headers = options.prefetchedBody.headers;
            preExtractedLinks = options.prefetchedBody.preExtractedLinks || [];
        } else {
            // Fetch full message if not prefetched
            const fullMessageResult = await fetchFullEmailBody(gmail, messageId);
            body = fullMessageResult.body;
            payload = fullMessageResult.payload;
            headers = fullMessageResult.headers;
            preExtractedLinks = fullMessageResult.preExtractedLinks;
        }

        // Extract fields
        const from = headers.find((h: any) => h.name === 'From')?.value || metadata.from;
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || metadata.subject;
        body = body || metadata.snippet; // fallback to snippet
        const attachmentMetadata = extractAttachmentMetadata(payload, messageId);
        const parsedFrom = parseEmailAddress(from);

        // Classify email to determine routing
        const emailClass = classifyEmail(from, subject, body);
        logger.debug(`[AI ROUTE] email=${messageId} class=${emailClass}`);

        // Resolve Groq key from DB for normal emails only
        let groqApiKey: string | null = null;
        if (emailClass === 'normal' && options.userId) {
            try {
                const profile = await UserIntentProfile.findUnique({ where: { userId: options.userId } });
                if (profile?.groqApiKey && profile?.aiProvider === 'groq') {
                    groqApiKey = decryptApiKey(profile.groqApiKey);
                }
            } catch (keyErr: any) {
                logger.info(`[AI ROUTE] Failed to read Groq key for user ${options.userId}: ${keyErr.message}`);
            }
        }

        // Call AI service — Groq for normal emails, Ollama for routine/sensitive
        const insights = await extractInsightsFromEmail({
            from,
            subject,
            body,
            internalDate,
            relevantLabels,
            preExtractedLinks,
        }, {
            userId:     options.userId,
            context:    options.aiContext,
            useGroq:    emailClass === 'normal' && !!groqApiKey,
            groqApiKey: groqApiKey ?? undefined,
            stage2Candidates: options.stage2Candidates,
            onFallback: options.onFallback,
        });

        // Attach sensitive flag so the UI can render the local-processing banner
        if (emailClass === 'sensitive') {
            (insights as any).sensitiveFlag = {
                sensitive: true,
                reason: 'Contains sensitive keywords — processed locally',
            };
        }

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
