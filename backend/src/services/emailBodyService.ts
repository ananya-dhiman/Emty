import { htmlToText } from 'html-to-text';

/**
 * Aggressively clean text to save LLM tokens
 */
const cleanEmailText = (text: string): string => {
    let result = text;
    
    // 1. Strip URLs (they cost a lot of tokens)
    result = result.replace(/https?:\/\/[^\s]+/g, '[URL]');
    
    // 2. Strip common email reply headers (e.g., "On [Date], [User] wrote:")
    const replyHeaderRegex = /(On\s+.*?wrote:|From:.*?\r?\nSent:.*?\r?\nTo:.*?\r?\nSubject:)/s;
    const replyMatch = result.match(replyHeaderRegex);
    if (replyMatch && replyMatch.index !== undefined) {
        result = result.substring(0, replyMatch.index);
    }
    
    // 3. Strip common signature dashes
    const signatureMatch = result.search(/\r?\n--\r?\n|\r?\n___\r?\n/);
    if (signatureMatch !== -1) {
        result = result.substring(0, signatureMatch);
    }

    // 4. Compress excessive whitespace
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/[ \t]{2,}/g, ' ');
    
    return result.trim();
};

/**
 * Extract email body from Gmail message payload
 */
export const extractEmailBody = (payload: any): string => {
    const extractTextFromParts = (parts: any[]): string => {
        const textPart = parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
            return cleanEmailText(Buffer.from(textPart.body.data, 'base64').toString('utf-8'));
        }

        const htmlPart = parts.find(p => p.mimeType === 'text/html');
        if (htmlPart?.body?.data) {
            const htmlContent = Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
            return cleanEmailText(htmlToText(htmlContent, {
                wordwrap: false,
                selectors: [
                    { selector: 'a', options: { ignoreHref: true } },
                    { selector: 'img', format: 'skip' },
                    { selector: 'script', format: 'skip' },
                    { selector: 'style', format: 'skip' },
                ],
            }));
        }

        for (const part of parts) {
            if (part.parts) {
                const nestedText = extractTextFromParts(part.parts);
                if (nestedText) return cleanEmailText(nestedText);
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
            return cleanEmailText(htmlToText(rawBody, {
                wordwrap: false,
                selectors: [
                    { selector: 'a', options: { ignoreHref: true } },
                    { selector: 'img', format: 'skip' },
                    { selector: 'script', format: 'skip' },
                    { selector: 'style', format: 'skip' },
                ],
            }));
        }
        return cleanEmailText(rawBody);
    }

    return '';
};

/**
 * Extract attachment metadata from Gmail message payload
 */
export const extractAttachmentMetadata = (payload: any, messageId: string): Array<{
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
 * Fetch full email content from Gmail API and extract its body
 */
export const fetchFullEmailBody = async (
  gmail: any,
  messageId: string
): Promise<{
  body: string;
  payload: any;
  headers: any[];
}> => {
  const messageResponse = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const payload = messageResponse.data.payload;
  const headers = payload?.headers || [];
  const body = extractEmailBody(payload);

  return { body, payload, headers };
};
