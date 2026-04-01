/**
 * AI Service
 * Primary: Gemini 1.5 Flash via @google/genai
 * Fallback: OpenRouter on error or rate limit (429)
 */

import { GoogleGenAI } from '@google/genai';
import { inferActionIntelligence } from './insightInference';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export interface AIInsightExtraction {
    intent: 'action_required' | 'event' | 'opportunity' | 'information' | 'waiting' | 'noise';
    shortSnippet: string;
    labels: string[];
    suggestedLabel?: string | null;
    dates: Array<{
        type: 'deadline' | 'event' | 'followup';
        date: string;
        description?: string;
    }>;
    extractedFacts: Record<string, any>;
    importanceScore?: number;
    importantLinks: Array<{
        url: string;
        label?: string;
        reason?: string;
        inferred?: boolean;
    }>;
    checklist: Array<{
        task: string;
        status: 'pending';
        dueDate?: string;
        reason?: string;
        inferred?: boolean;
    }>;
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
// extraneous text). If parsing still fails, throw an AIParsingError.
export const parseAIResponse = (text: string): AIInsightExtraction => {
    const sanitizeJson = (input: string): string => {
        let cleaned = input.trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            cleaned = cleaned.substring(start, end + 1);
        }
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
        return cleaned;
    };

    try {
        return JSON.parse(text);
    } catch (origErr) {
        console.error('[AI] Failed to parse AI output on first attempt. Raw response:', text);
        const cleaned = sanitizeJson(text);
        try {
            return JSON.parse(cleaned);
        } catch (err2) {
            throw new AIParsingError('Unable to parse AI response as JSON', text);
        }
    }
};

// Build the shared prompt used by both providers
const buildPrompt = (emailContent: {
    from: string;
    subject: string;
    body: string;
    internalDate?: string;
    relevantLabels?: Array<{ name: string; description?: string }>;
}): string => {
    const candidates = emailContent.relevantLabels?.length
        ? emailContent.relevantLabels.map((l) => `- ${l.name}: ${l.description || 'No description'}`).join('\n')
        : '- Needs Action: Emails that require a response, deadline, or task\n- Finance: Bills, transactions, payments';

    return `You are an email insight extraction AI. Analyze the following email and extract structured insights.

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
3. labels: Array of 0-3 labels. Use ONLY labels from the provided label candidates when they genuinely fit. Return an empty array if none fit.
4. suggestedLabel: Optional short label name if the email clearly belongs to a repeated category not covered by the provided candidates. Otherwise return null.
5. dates: Array of important dates with type ('deadline', 'event', 'followup') and ISO date string
6. extractedFacts: Object with any important facts (e.g., company, position, salary, event details)
7. importanceScore: A number from 0.0 to 1.0 representing how important this email is
8. importantLinks: Array of important URLs with optional label/reason. Include application links, forms, payment links, meeting links, portals, or docs.
9. checklist: Array of actionable tasks with shape { task, status, dueDate?, reason? }. Keep status as "pending".

Return ONLY valid JSON, no markdown code blocks.`;
};

// Normalize and validate dates in the parsed result
const normalizeDates = (insights: AIInsightExtraction): AIInsightExtraction => {
    if (!Array.isArray(insights.dates)) {
        insights.dates = [];
    }

    const normalizeDateValue = (val: any): string | null => {
        if (!val && val !== 0) return null;
        if (typeof val === 'string') {
            const digitsOnly = /^\d+$/.test(val.trim());
            if (digitsOnly) {
                const n = Number(val.trim());
                if (val.trim().length <= 10) return new Date(n * 1000).toISOString();
                return new Date(n).toISOString();
            }
            const parsed = Date.parse(val);
            if (!isNaN(parsed)) return new Date(parsed).toISOString();
            return null;
        }
        if (typeof val === 'number') {
            if (val.toString().length <= 10) return new Date(val * 1000).toISOString();
            return new Date(val).toISOString();
        }
        return null;
    };

    insights.dates = insights.dates
        .map((d: any) => {
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

    return insights;
};

const normalizeLinksAndChecklist = (insights: AIInsightExtraction): AIInsightExtraction => {
    if (!Array.isArray((insights as any).importantLinks)) {
        (insights as any).importantLinks = [];
    }
    if (!Array.isArray((insights as any).checklist)) {
        (insights as any).checklist = [];
    }

    const normalizeUrl = (value: any): string | null => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim().replace(/[),.;!?]+$/, '');
        if (!trimmed) return null;
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        try {
            const parsed = new URL(withProtocol);
            if (!['http:', 'https:'].includes(parsed.protocol)) return null;
            return parsed.toString();
        } catch {
            return null;
        }
    };

    const dedupedLinks = new Map<string, AIInsightExtraction['importantLinks'][number]>();
    for (const raw of (insights as any).importantLinks) {
        const normalizedUrl = normalizeUrl(raw?.url ?? raw);
        if (!normalizedUrl) continue;
        if (!dedupedLinks.has(normalizedUrl)) {
            dedupedLinks.set(normalizedUrl, {
                url: normalizedUrl,
                label: typeof raw?.label === 'string' ? raw.label.trim().slice(0, 80) : undefined,
                reason: typeof raw?.reason === 'string' ? raw.reason.trim().slice(0, 160) : undefined,
                inferred: raw?.inferred === true,
            });
        }
    }
    insights.importantLinks = Array.from(dedupedLinks.values()).slice(0, 12);

    const dedupedChecklist = new Map<string, AIInsightExtraction['checklist'][number]>();
    for (const raw of (insights as any).checklist) {
        const task = typeof raw?.task === 'string' ? raw.task.trim() : typeof raw === 'string' ? raw.trim() : '';
        if (!task) continue;
        const boundedTask = task.length > 180 ? `${task.slice(0, 177).trim()}...` : task;
        const key = boundedTask.toLowerCase();
        if (!dedupedChecklist.has(key)) {
            dedupedChecklist.set(key, {
                task: boundedTask,
                status: 'pending',
                dueDate: typeof raw?.dueDate === 'string' ? raw.dueDate : undefined,
                reason: typeof raw?.reason === 'string' ? raw.reason.trim().slice(0, 160) : undefined,
                inferred: raw?.inferred === true,
            });
        }
    }
    insights.checklist = Array.from(dedupedChecklist.values()).slice(0, 8);
    return insights;
};

const applyInferenceFallback = (
    insights: AIInsightExtraction,
    emailContent: { body: string }
): AIInsightExtraction => {
    const inferred = inferActionIntelligence({
        body: emailContent.body || '',
        intent: insights.intent,
        dates: Array.isArray(insights.dates) ? insights.dates : [],
    });

    const existingLinkUrls = new Set((insights.importantLinks || []).map((link) => link.url));
    for (const inferredLink of inferred.importantLinks) {
        if (!existingLinkUrls.has(inferredLink.url)) {
            insights.importantLinks.push(inferredLink);
            existingLinkUrls.add(inferredLink.url);
        }
    }

    if (insights.intent === 'action_required' || (insights.checklist || []).length === 0) {
        const existingTaskKeys = new Set((insights.checklist || []).map((item) => item.task.toLowerCase()));
        for (const inferredTask of inferred.checklist) {
            const key = inferredTask.task.toLowerCase();
            if (!existingTaskKeys.has(key)) {
                insights.checklist.push(inferredTask);
                existingTaskKeys.add(key);
            }
        }
    }

    return normalizeLinksAndChecklist(insights);
};

// Validate the insight structure
const validateInsights = (insights: AIInsightExtraction): void => {
    if (!insights.intent || !insights.shortSnippet || !Array.isArray(insights.labels)) {
        throw new Error('Invalid insight structure from AI');
    }
    if (typeof insights.suggestedLabel !== 'string') {
        insights.suggestedLabel = null;
    }
    if (!insights.extractedFacts || typeof insights.extractedFacts !== 'object') {
        insights.extractedFacts = {};
    }
    if (!Array.isArray(insights.importantLinks)) {
        insights.importantLinks = [];
    }
    if (!Array.isArray(insights.checklist)) {
        insights.checklist = [];
    }
};

/**
 * Call Gemini 1.5 Flash to extract insights from email content.
 * Returns null if GEMINI_API_KEY is not set or on rate limit / error (caller should fallback).
 */
const extractWithGemini = async (prompt: string): Promise<AIInsightExtraction | null> => {
    if (!GEMINI_API_KEY) {
        console.log('[AI] GEMINI_API_KEY not configured, skipping Gemini provider');
        return null;
    }

    try {
        console.log(`[AI] Calling Gemini model: ${GEMINI_MODEL}`);
        const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const result = await genai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
        });

        const text = result.text;
        if (!text) {
            console.error('[AI] Gemini returned empty response');
            return null;
        }

        const insights = parseAIResponse(text);
        normalizeDates(insights);
        normalizeLinksAndChecklist(insights);
        validateInsights(insights);
        console.log('[AI] Gemini extraction successful');
        return insights;
    } catch (err: any) {
        const status = err?.status ?? err?.httpErrorCode ?? 0;
        const isRateLimit = status === 429 || (err?.message || '').toLowerCase().includes('rate limit') || (err?.message || '').toLowerCase().includes('quota');
        if (isRateLimit) {
            console.warn('[AI] Gemini rate limit hit, will fallback to OpenRouter');
        } else {
            console.error('[AI] Gemini error, will fallback to OpenRouter:', err?.message || err);
        }
        return null;
    }
};

/**
 * Call OpenRouter API to extract insights from email content (fallback provider).
 */
const extractWithOpenRouter = async (prompt: string): Promise<AIInsightExtraction> => {
    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not configured');
    }

    const requestPayload = {
        model: 'openrouter/auto',
        messages: [
            {
                role: 'user',
                content: prompt,
            },
        ],
        temperature: 0.3,
        max_tokens: 1000,
    };

    console.log(`[AI] Calling OpenRouter (fallback) with model: ${requestPayload.model}`);

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

                if ((status === 429 || status >= 500) && attempt < maxAttempts) {
                    const backoffMs = 500 * attempt;
                    await new Promise((r) => setTimeout(r, backoffMs));
                    continue;
                }

                const err = new Error(`OpenRouter API error: ${status} ${response.statusText}`);
                (err as any).status = status;
                throw err;
            }

            break;
        } catch (e: any) {
            lastError = e;
            const code = e?.code || '';
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
    let extractedText: string | undefined = data?.choices?.[0]?.message?.content;

    if (!extractedText) {
        extractedText = data?.choices?.[0]?.text || undefined;
    }

    if (!extractedText) {
        console.error('[AI] Empty OpenRouter content. Full response:', JSON.stringify(data, null, 2));
        throw new Error('No content in OpenRouter response');
    }

    let insights: AIInsightExtraction;
    try {
        insights = parseAIResponse(extractedText);
    } catch (parseError) {
        if (parseError instanceof AIParsingError) {
            console.error('[AI] Raw extractedText:', parseError.raw);
        } else {
            console.error('[AI] Raw extractedText:', extractedText);
        }
        throw parseError;
    }

    normalizeDates(insights);
    normalizeLinksAndChecklist(insights);
    validateInsights(insights);
    console.log('[AI] OpenRouter extraction successful');
    return insights;
};

/**
 * Extract insights from email content.
 * Tries Gemini 1.5 Flash first; falls back to OpenRouter on any error or rate limit.
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
    const prompt = buildPrompt(emailContent);
    console.log(`[AI] Prompt length: ${prompt.length} chars`);

    // Try Gemini first
    const geminiResult = await extractWithGemini(prompt);
    if (geminiResult) {
        return applyInferenceFallback(geminiResult, emailContent);
    }

    // Fallback to OpenRouter
    console.log('[AI] Falling back to OpenRouter provider');
    const result = await extractWithOpenRouter(prompt);
    return applyInferenceFallback(result, emailContent);
};
