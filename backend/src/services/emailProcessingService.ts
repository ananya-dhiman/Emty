/**
 * Email Deep Processing Service
 * Fetches full email content and processes it with AI to extract insights
 */

import { google } from 'googleapis';
import { htmlToText } from 'html-to-text';
import { extractInsightsFromEmail, AIInsightExtraction, AIParsingError } from './aiService';

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
}

/**
 * Extract email body from Gmail message payload
 */
const extractEmailBody = (payload: any): string => {
    const extractTextFromParts = (parts: any[]): string => {
        const textPart = parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
            return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }

        const htmlPart = parts.find(p => p.mimeType === 'text/html');
        if (htmlPart?.body?.data) {
            const htmlContent = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
            return htmlToText(htmlContent, {
                wordwrap: false,
                selectors: [
                    { selector: 'a', options: { linkBrackets: false, hideLinkHrefIfSameAsText: true } },
                    { selector: 'img', format: 'skip' },
                    { selector: 'script', format: 'skip' },
                    { selector: 'style', format: 'skip' },
                ],
            });
        }

        for (const part of parts) {
            if (part.parts) {
                const nestedText = extractTextFromParts(part.parts);
                if (nestedText) return nestedText;
            }
        }

        return '';
    };

    if (payload?.parts) {
        return extractTextFromParts(payload.parts);
    }

    if (payload?.body?.data) {
        const rawBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        if (rawBody.includes('<') && rawBody.includes('>')) {
            return htmlToText(rawBody, {
                wordwrap: false,
                selectors: [
                    { selector: 'a', options: { linkBrackets: false, hideLinkHrefIfSameAsText: true } },
                    { selector: 'img', format: 'skip' },
                    { selector: 'script', format: 'skip' },
                    { selector: 'style', format: 'skip' },
                ],
            });
        }
        return rawBody;
    }

    return '';
};

/**
 * Extract attachment metadata from Gmail message payload
 */
const extractAttachmentMetadata = (payload: any, messageId: string): Array<{
    filename: string;
    mimeType: string;
    size: number;
    messageId: string;
}> => {
    const attachments: Array<{
        filename: string;
        mimeType: string;
        size: number;
        messageId: string;
    }> = [];

    const processPayloadParts = (parts: any[]) => {
        for (const part of parts) {
            if (part.filename && part.filename.trim() !== '') {
                attachments.push({
                    filename: part.filename,
                    mimeType: part.mimeType || 'application/octet-stream',
                    size: parseInt(part.size) || 0,
                    messageId,
                });
            }
            if (part.parts) {
                processPayloadParts(part.parts);
            }
        }
    };

    if (payload?.parts) {
        processPayloadParts(payload.parts);
    }

    return attachments;
};

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
    metadata: { from: string; subject: string; snippet: string }
): Promise<ProcessedEmailInsight> => {
    try {
        // Fetch full message
        const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });

        const payload = fullMessage.data.payload;
        const headers = payload?.headers || [];

        // Extract fields
        const from = headers.find((h: any) => h.name === 'From')?.value || metadata.from;
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || metadata.subject;
        const body = extractEmailBody(payload) || metadata.snippet;
        const attachmentMetadata = extractAttachmentMetadata(payload, messageId);
        const parsedFrom = parseEmailAddress(from);

        // Call AI service to extract insights
        const insights = await extractInsightsFromEmail({
            from,
            subject,
            body,
            internalDate,
        });

        return {
            messageId,
            threadId,
            from: parsedFrom,
            subject,
            internalDate,
            insights,
            attachmentMetadata,
        };
    } catch (error) {
        if (error instanceof AIParsingError) {
            console.error(`AI parsing failed for email ${messageId}. Raw response below:`);
            console.error(error.raw);
        }
        console.error(`Error processing email ${messageId}:`, error);
        throw error;
    }
};
