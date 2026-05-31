import { htmlToText } from 'html-to-text';

export interface PreExtractedLink {
    url: string;
    anchorText: string;
    context: string;
}

/**
 * Aggressively clean text to save LLM tokens
 */
const cleanEmailText = (text: string): string => {
    let result = text;
    
    // 1. Strip common email reply headers (e.g., "On [Date], [User] wrote:")
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

    // 4. Strip all URLs from body — links are pre-extracted separately to save tokens
    result = result.replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, '');
    result = result.replace(/\bwww\.[^\s<>"')\]]+/gi, '');

    // 5. Compress excessive whitespace
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/[ \t]{2,}/g, ' ');
    
    return result.trim();
};

const TRACKING_DOMAINS = [
    'click.mailchimp.com',
    'links.sgrid.net',
    'mailchi.mp',
    't.co',
    'bit.ly',
    'ow.ly',
    'tinyurl.com',
    'mandrillapp.com',
    'sendgrid.net',
    'list-manage.com',
    'createsend.com',
    'campaign-archive.com',
];

const TRACKING_PARAMS_ONLY = /^[^?]*\?(?:utm_[a-z]+=[^&]*&?)+$/i;

const isTrackingUrl = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        if (TRACKING_DOMAINS.some(d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) {
            return true;
        }
        if (TRACKING_PARAMS_ONLY.test(url)) return true;
        return false;
    } catch {
        return false;
    }
};

const getSurroundingContext = (body: string, matchIndex: number, matchLength: number): string => {
    const before = body.lastIndexOf('.', matchIndex);
    const after = body.indexOf('.', matchIndex + matchLength);
    const start = before === -1 ? Math.max(0, matchIndex - 120) : before + 1;
    const end = after === -1 ? Math.min(body.length, matchIndex + matchLength + 120) : after + 1;
    return body.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 200);
};

/**
 * Extract links from a raw MIME payload tree before any cleaning happens.
 * Walks all parts recursively including quoted reply sections.
 */
export const extractLinksFromPayload = (payload: any): PreExtractedLink[] => {
    const linkMap = new Map<string, PreExtractedLink>();

    const processRawHtml = (html: string) => {
        // Capture <a href="url">anchor text</a>
        const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
        let match: RegExpExecArray | null;
        while ((match = anchorRegex.exec(html)) !== null) {
            const rawUrl = match[1].trim();
            const anchor = match[2].replace(/\s+/g, ' ').trim().slice(0, 100);
            if (!rawUrl || rawUrl.startsWith('mailto:') || rawUrl.startsWith('#')) continue;
            try {
                const normalized = new URL(
                    /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
                ).toString();
                if (isTrackingUrl(normalized)) continue;
                if (!linkMap.has(normalized)) {
                    linkMap.set(normalized, {
                        url: normalized,
                        anchorText: anchor || '',
                        context: '',
                    });
                }
            } catch { /* skip invalid URLs */ }
        }
    };

    const processRawText = (text: string) => {
        const urlRegex = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
        let match: RegExpExecArray | null;
        while ((match = urlRegex.exec(text)) !== null) {
            const rawUrl = match[0].replace(/[),.;!?]+$/, '');
            try {
                const normalized = new URL(rawUrl).toString();
                if (isTrackingUrl(normalized)) continue;
                if (!linkMap.has(normalized)) {
                    const ctx = getSurroundingContext(text, match.index, match[0].length);
                    linkMap.set(normalized, {
                        url: normalized,
                        anchorText: '',
                        context: ctx,
                    });
                }
            } catch { /* skip invalid URLs */ }
        }
    };

    const walkParts = (parts: any[]) => {
        for (const part of parts) {
            if (part?.body?.data) {
                const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
                if (part.mimeType === 'text/html') {
                    processRawHtml(decoded);
                    // Also scan as plain text to catch bare URLs in HTML bodies
                    processRawText(htmlToText(decoded, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: false, noLinkBrackets: false } }, { selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }] }));
                } else if (part.mimeType === 'text/plain') {
                    processRawText(decoded);
                }
            }
            if (part?.parts) {
                walkParts(part.parts);
            }
        }
    };

    if (payload?.parts) {
        walkParts(payload.parts);
    } else if (payload?.body?.data) {
        const decoded = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        if (decoded.includes('<') && decoded.includes('>')) {
            processRawHtml(decoded);
            // Also scan as plain text to catch bare URLs in HTML bodies
            processRawText(htmlToText(decoded, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: false, noLinkBrackets: false } }, { selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }] }));
        } else {
            processRawText(decoded);
        }
    }

    return Array.from(linkMap.values()).slice(0, 30);
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
                    { selector: 'a', options: { ignoreHref: false, noLinkBrackets: false } },
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
                    { selector: 'a', options: { ignoreHref: false, noLinkBrackets: false } },
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
 * Fetch full email content from Gmail API and extract its body.
 * Link extraction happens on the raw payload before any cleaning.
 */
export const fetchFullEmailBody = async (
  gmail: any,
  messageId: string
): Promise<{
  body: string;
  payload: any;
  headers: any[];
  preExtractedLinks: PreExtractedLink[];
}> => {
  const messageResponse = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const payload = messageResponse.data.payload;
  const headers = payload?.headers || [];

  // Extract links from the full raw payload (including quoted reply sections)
  // before cleanEmailText strips or truncates anything
  const preExtractedLinks = extractLinksFromPayload(payload);

  // Body cleaning happens after link extraction
  const body = extractEmailBody(payload);

  return { body, payload, headers, preExtractedLinks };
};
