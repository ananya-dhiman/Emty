/**
 * OpenRouter AI Service
 * Handles calls to OpenRouter API for email processing and insight extraction
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface AIInsightExtraction {
    intent: 'action_required' | 'event' | 'opportunity' | 'information' | 'waiting' | 'noise';
    shortSnippet: string;
    labels: string[]; // AI-generated labels
    dates: Array<{
        type: 'deadline' | 'event' | 'followup';
        date: string; // ISO date string
        description?: string;
    }>;
    extractedFacts: Record<string, any>; // Any extracted structured data
}

// Custom error thrown when the AI response cannot be parsed as JSON
export class AIParsingError extends Error {
    raw: string;
    constructor(message: string, raw: string) {
        super(message);
        this.raw = raw;
        this.name = 'AIParsingError';
    }
}

// Attempt to parse the text produced by the model. If the first pass fails
// try a minimal sanitization pass (strip trailing commas, remove surrounding
// extraneous text). If parsing still fails, throw an AIParsingError so callers
// can decide how to handle it.
export const parseAIResponse = (text: string): AIInsightExtraction => {
    const sanitizeJson = (input: string): string => {
        let cleaned = input.trim();
        // remove anything before first { and after last }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            cleaned = cleaned.substring(start, end + 1);
        }
        // simple trailing-comma removal: replace `,}` or `,]` with `}`/`]`
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
        return cleaned;
    };

    try {
        return JSON.parse(text);
    } catch (origErr) {
        console.error('Failed to parse AI output on first attempt. Raw response:', text);
        const cleaned = sanitizeJson(text);
        try {
            return JSON.parse(cleaned);
        } catch (err2) {
            // include original text so the caller can log/store it
            throw new AIParsingError('Unable to parse AI response as JSON', text);
        }
    }
};

/**
 * Call OpenRouter API to extract insights from email content
 */
export const extractInsightsFromEmail = async (
    emailContent: {
        from: string;
        subject: string;
        body: string;
        internalDate?: string;
        relevantLabels?: Array<{ name: string; description?: string }>;
    }
): Promise<AIInsightExtraction> => {
    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not configured');
    }

    const candidates = emailContent.relevantLabels?.length
        ? emailContent.relevantLabels.map((l) => `- ${l.name}: ${l.description || 'No description'}`).join('\n')
        : '- Needs Action: Emails that require a response, deadline, or task\n- Finance: Bills, transactions, payments\n- Other: If none of the above labels apply';

    const prompt = `You are an email insight extraction AI. Analyze the following email and extract structured insights.

From: ${emailContent.from}
Subject: ${emailContent.subject}
Date: ${emailContent.internalDate || 'Unknown'}

Label candidates:
${candidates}

Body:
${emailContent.body.substring(0, 2000)}

Extract and return a JSON object with:
1. intent: One of 'action_required', 'event', 'opportunity', 'information', 'waiting', 'noise'
2. shortSnippet: A 1-2 sentence summary of the email (max 150 chars)
3. labels: Array of 1-3 smart labels categorizing the email. Choose from the provided label candidates when possible, and use 'Other' as fallback.
4. dates: Array of important dates with type ('deadline', 'event', 'followup') and ISO date string
5. extractedFacts: Object with any important facts (e.g., company, position, salary, event details)

Return ONLY valid JSON, no markdown code blocks.`;

    try {
        const requestPayload = {
            model: 'openrouter/free',
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0.3,
            max_tokens: 1000,
        };

        console.log(`[AI] Calling OpenRouter with model: ${requestPayload.model}`);
        console.log(`[AI] Prompt length: ${prompt.length} chars`);

        // Small retry loop for transient LLM errors (429 / 5xx)
        const maxAttempts = 2;
        let attempt = 0;
        let response: any = null;
        let lastError: any = null;

        while (attempt < maxAttempts) {
            attempt++;
            try {
                response = await fetch(OPENROUTER_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestPayload),
                });

                if (!response.ok) {
                    // capture body if available for logging
                    let errorDetail = response.statusText;
                    try {
                        const errorBody = await response.json();
                        errorDetail = JSON.stringify(errorBody, null, 2);
                    } catch (e) {
                        // ignore
                    }
                    const status = response.status || 0;
                    console.error(`[AI] OpenRouter error (status=${status}). Attempt ${attempt}/${maxAttempts}`);
                    console.error(`[AI] Error details:`, errorDetail);

                    // Retry on transient status codes
                    if ((status === 429 || status >= 500) && attempt < maxAttempts) {
                        const backoffMs = 500 * attempt;
                        await new Promise((r) => setTimeout(r, backoffMs));
                        continue;
                    }

                    const err = new Error(`OpenRouter API error: ${status} ${response.statusText}`);
                    (err as any).status = status;
                    throw err;
                }

                break; // successful response
            } catch (e: any) {
                lastError = e;
                // network-level transient errors: retry once
                const code = e?.code || "";
                if ((code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') && attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, 200 * attempt));
                    continue;
                }
                throw e;
            }
        }

        if (!response) {
            throw lastError || new Error('No response from OpenRouter');
        }

        const data = await response.json();
        // Attempt to extract text from common response shapes
        let extractedText: string | undefined = undefined;
        try {
            // Common GPT-like shape
            extractedText = data?.choices?.[0]?.message?.content;
        } catch (e) {
            // ignore
        }

        // Fallbacks: some endpoints return `text` or `choices[].text`
        if (!extractedText) {
            extractedText = data?.choices?.[0]?.text || undefined;
        }

        // If still no content, log full response for diagnostics and error out
        if (!extractedText) {
            console.error('[AI] Empty OpenRouter content. Full response:', JSON.stringify(data, null, 2));
            throw new Error('No content in OpenRouter response');
        }

        // Parse JSON response using helper to capture/clean malformed output
        let insights: AIInsightExtraction;
        try {
            insights = parseAIResponse(extractedText);
        } catch (parseError) {
            console.error('Error parsing AI response:', parseError);
            // include the raw extracted text for easier debugging
            if (parseError instanceof AIParsingError) {
                console.error('[AI] Raw extractedText:', parseError.raw);
            } else {
                console.error('[AI] Raw extractedText:', extractedText);
            }
            throw parseError;
        }

        // Normalize and validate dates produced by the model. The model may
        // return numeric timestamps (ms or s), numeric strings, or ISO strings.
        if (!Array.isArray(insights.dates)) {
            insights.dates = [];
        }

        const normalizeDateValue = (val: any): string | null => {
            if (!val && val !== 0) return null;
            // Prefer explicit ISO strings
            if (typeof val === 'string') {
                const digitsOnly = /^\d+$/.test(val.trim());
                if (digitsOnly) {
                    // numeric string - determine seconds vs ms
                    const n = Number(val.trim());
                    if (val.trim().length <= 10) return new Date(n * 1000).toISOString();
                    return new Date(n).toISOString();
                }

                const parsed = Date.parse(val);
                if (!isNaN(parsed)) return new Date(parsed).toISOString();
                return null;
            }

            if (typeof val === 'number') {
                // decide seconds vs ms
                if (val.toString().length <= 10) return new Date(val * 1000).toISOString();
                return new Date(val).toISOString();
            }

            return null;
        };

        insights.dates = insights.dates
            .map((d: any) => {
                // support alternate keys like isoDate
                const rawDate = d.date ?? d.isoDate ?? d.datetime ?? null;
                const normalized = normalizeDateValue(rawDate);
                if (!normalized) return null;
                return {
                    type: d.type || 'event',
                    date: normalized,
                    description: d.description || undefined,
                };
            })
            .filter(Boolean) as AIInsightExtraction['dates'];

        // Validate response structure
        if (!insights.intent || !insights.shortSnippet || !Array.isArray(insights.labels)) {
            throw new Error('Invalid insight structure from AI');
        }

        return insights;
    } catch (error) {
        console.error('Error calling OpenRouter API:', error);
        throw error;
    }
};
