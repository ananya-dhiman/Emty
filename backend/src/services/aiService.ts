import { inferActionIntelligence } from "./insightInference";
import { AIResolvedContext, resolveAIContextForUser } from "./aiProviderService";
import { PreExtractedLink } from "./emailBodyService";
import { UserIntentProfileModel } from '../model/UserIntentProfile';
import logger from '../utils/logger';

const OLLAMA_URL = process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL?.trim() || "llama2";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY?.trim();

export interface AIInsightExtraction {
  intent: "action_required" | "event" | "opportunity" | "information" | "waiting" | "noise";
  shortSnippet: string;
  labels: string[];
  suggestedLabel?: string | null;
  dates: Array<{
    type: "deadline" | "event" | "followup";
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
    id?: string;
  }>;
  checklist: Array<{
    task: string;
    status: "pending";
    dueDate?: string;
    reason?: string;
    inferred?: boolean;
  }>;
  labelMode?: 'existing' | 'new';
  confidence?: number;
  labelReason?: string;
}

export interface AIFallbackNotice {
  usedSharedFallback: boolean;
  reason: string;
  fromProvider?: string;
  fromModel?: string;
  toProvider?: string;
  toModel?: string;
}

export interface ExtractInsightOptions {
  userId?: string;
  context?: AIResolvedContext;
  useGroq?: boolean;     // true = route to Groq cloud API
  groqApiKey?: string;   // decrypted key, only present when useGroq=true
  stage2Candidates?: Array<{ name: string; similarityScore: number; labelMode: string }>;
  onFallback?: (notice: AIFallbackNotice) => Promise<void> | void;
}

export class AIParsingError extends Error {
  raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.raw = raw;
    this.name = "AIParsingError";
  }
}

export const parseAIResponse = (text: string): AIInsightExtraction => {
  const sanitizeJson = (input: string): string => {
    let cleaned = input.trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.substring(start, end + 1);
    }
    cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");
    return cleaned;
  };

  try {
    return JSON.parse(text);
  } catch {
    const cleaned = sanitizeJson(text);
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new AIParsingError("Unable to parse AI response as JSON", text);
    }
  }
};

const cleanNoiseText = (text: string): string => {
  if (!text) return text;
  return text
    // Remove common invisible/formatting characters (e.g. zero-width spaces, combining grapheme joiner)
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\u034F\u034f]/g, '')
    // Remove repeated separators (---, ===, ___, ***)
    .replace(/[\-_=~*]{2,}/g, ' ')
    // Remove email quote markers like ">>>" or "> > >"
    .replace(/(^|\s)([>\s]+)(?=\s|$)/g, ' ')
    // Remove common image placeholders like [image: ...]
    .replace(/\[image:[^\]]+\]/gi, '')
    // Remove raw URLs in angle brackets like <https://...>
    .replace(/<https?:\/\/[^>]+>/gi, '')
    // Replace multiple whitespace characters with a single space
    .replace(/\s+/g, ' ')
    .trim();
};

const buildPrompt = (emailContent: {
  from: string;
  subject: string;
  body: string;
  internalDate?: string;
  relevantLabels?: Array<{ name: string; description?: string }>;
  stage2Candidates?: Array<{ name: string; similarityScore: number; labelMode: string }>;
  preExtractedLinks?: PreExtractedLink[];
  promptLinks?: Array<{ id: string; displayString: string }>;
}): string => {
  let candidatesText = "- Needs Action: Emails that require a response, deadline, or task\n- Finance: Bills, transactions, payments";

  if (emailContent.stage2Candidates?.length) {
    candidatesText = "Pre-ranked Vector Similarity Candidates (highly recommended):\n" +
      emailContent.stage2Candidates
        .slice(0, 7)
        .map(c => `- ${c.name} (Similarity: ${(c.similarityScore * 100).toFixed(1)}%)`)
        .join("\n");
  } else if (emailContent.relevantLabels?.length) {
    candidatesText = emailContent.relevantLabels
      .slice(0, 7)
      .map((l) => `- ${l.name}: ${l.description || "No description"}`)
      .join("\n");
  }

  const linksBlock = emailContent.promptLinks && emailContent.promptLinks.length > 0
    ? `\nPre-extracted links found in this email:\n` +
    emailContent.promptLinks
      .map((l) => `${l.id}: ${l.displayString}`)
      .join('\n')
    : `\nNo links were pre-extracted from this email.`;

  return `You are an email insight extraction AI. Analyze the following email and extract structured insights.

From: ${emailContent.from}
Subject: ${emailContent.subject}
Date: ${emailContent.internalDate || "Unknown"}

Label candidates:
${candidatesText}
${linksBlock}

Body:
${cleanNoiseText(emailContent.body).split(/\s+/).slice(0, 600).join(' ')}

Extract and return a JSON object with:
1. intent: One of 'action_required', 'event', 'opportunity', 'information', 'waiting', 'noise'
2. shortSnippet: A summary under 15 words.
3. labels: Array of 0-3 labels. Use ONLY from candidates. Empty array if none fit.
4. suggestedLabel: Short label name if it strongly needs a new category. Otherwise null.
5. labelMode: "existing" or "new".
6. confidence: Number 0.0 to 1.0.
7. labelReason: Short internal reason.
8. dates: Array of max 2 dates (type: 'deadline', 'event', 'followup', date: ISO string).
9. importanceScore: Number 0.0 to 1.0.
10. importantLinks: Review ONLY the pre-extracted links listed above. For each link, include it if ANY positive signal applies:
    INCLUDE if: the surrounding context tells the recipient to act on it (click, join, review, pay, submit, approve, sign, confirm, download, fill); OR it is explicitly referenced or described in the body (not just in a footer or boilerplate).
    EXCLUDE if: it appears in a footer block (unsubscribe, manage preferences, privacy policy, terms of service, view in browser, update email preferences); OR the anchor text is generic branding (Visit our website, Follow us, View online, Learn more).
    For each included link return: id (the exact ID like L1), reason (one sentence: why the recipient specifically needs this link).
    Return empty array if no links qualify. Do NOT return urls, only the ID and reason.
11. checklist: Array of max 2 tasks { task, status: "pending" }.

Return ONLY valid JSON, no markdown code blocks.`;
};

const normalizeDates = (insights: AIInsightExtraction): AIInsightExtraction => {
  if (!Array.isArray(insights.dates)) insights.dates = [];

  const normalizeDateValue = (val: any): string | null => {
    if (!val && val !== 0) return null;
    if (typeof val === "string") {
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
    if (typeof val === "number") {
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
        type: d.type || "event",
        date: normalized,
        description: d.description || undefined,
      };
    })
    .filter(Boolean) as AIInsightExtraction["dates"];

  return insights;
};

const normalizeLinksAndChecklist = (insights: AIInsightExtraction): AIInsightExtraction => {
  if (!Array.isArray((insights as any).importantLinks)) (insights as any).importantLinks = [];
  if (!Array.isArray((insights as any).checklist)) (insights as any).checklist = [];

  const normalizeUrl = (value: any): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().replace(/[),.;!?]+$/, "");
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withProtocol);
      if (!["http:", "https:"].includes(parsed.protocol)) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const dedupedLinks = new Map<string, AIInsightExtraction["importantLinks"][number]>();
  for (const raw of (insights as any).importantLinks) {
    if (raw?.id && typeof raw.id === "string") {
      const idKey = raw.id.trim().toUpperCase();
      if (!dedupedLinks.has(idKey)) {
        dedupedLinks.set(idKey, {
          id: idKey,
          url: "", // placeholder, will be replaced during resolution
          reason: typeof raw?.reason === "string" ? raw.reason.trim().slice(0, 160) : undefined,
          inferred: raw?.inferred === true,
        });
      }
      continue;
    }
    const normalizedUrl = normalizeUrl(raw?.url ?? raw);
    if (!normalizedUrl) continue;
    if (!dedupedLinks.has(normalizedUrl)) {
      dedupedLinks.set(normalizedUrl, {
        url: normalizedUrl,
        label: typeof raw?.label === "string" ? raw.label.trim().slice(0, 80) : undefined,
        reason: typeof raw?.reason === "string" ? raw.reason.trim().slice(0, 160) : undefined,
        inferred: raw?.inferred === true,
      });
    }
  }
  insights.importantLinks = Array.from(dedupedLinks.values()).slice(0, 12);

  const dedupedChecklist = new Map<string, AIInsightExtraction["checklist"][number]>();
  for (const raw of (insights as any).checklist) {
    const task =
      typeof raw?.task === "string" ? raw.task.trim() : typeof raw === "string" ? raw.trim() : "";
    if (!task) continue;
    const boundedTask = task.length > 180 ? `${task.slice(0, 177).trim()}...` : task;
    const key = boundedTask.toLowerCase();
    if (!dedupedChecklist.has(key)) {
      dedupedChecklist.set(key, {
        task: boundedTask,
        status: "pending",
        dueDate: typeof raw?.dueDate === "string" ? raw.dueDate : undefined,
        reason: typeof raw?.reason === "string" ? raw.reason.trim().slice(0, 160) : undefined,
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
    body: emailContent.body || "",
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

  if (insights.intent === "action_required" || (insights.checklist || []).length === 0) {
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

const validateInsights = (insights: AIInsightExtraction): void => {
  if (!insights.intent || !insights.shortSnippet || !Array.isArray(insights.labels)) {
    throw new Error("Invalid insight structure from AI");
  }
  if (typeof insights.suggestedLabel !== "string") insights.suggestedLabel = null;
  if (!insights.extractedFacts || typeof insights.extractedFacts !== "object") insights.extractedFacts = {};
  if (!Array.isArray(insights.importantLinks)) insights.importantLinks = [];
  if (!Array.isArray(insights.checklist)) insights.checklist = [];
};

const extractWithOllama = async (
  prompt: string,
  model: string,
  attemptFallback = true
): Promise<AIInsightExtraction> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000); // 5-minute hard timeout

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OLLAMA_API_KEY ? { Authorization: `Bearer ${OLLAMA_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 600,
        stream: true,
        options: {
          num_ctx: 8192
        }
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const txt = await response.text();

    // Dynamic Fallback if model is not found (happens if backend hits api before full provisioning is done)
    if (response.status === 404 && txt.includes("not found") && attemptFallback) {
      logger.info(`[AI] Requested model ${model} not found, attempting dynamic fallback...`);
      try {
        const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
        if (tagsRes.ok) {
          const tagsData: any = await tagsRes.json();
          const availableModels = tagsData?.models || [];
          const validFallbackModels = availableModels.filter((m: any) => !m.name.includes('embed'));
          if (validFallbackModels.length > 0) {
            const fallbackModel = (
              validFallbackModels.find((m: any) => m.name.includes('qwen')) ||
              validFallbackModels.find((m: any) => m.name.includes('llama')) ||
              validFallbackModels[0]
            ).name;
            logger.info(`[AI] Successfully located fallback model: ${fallbackModel}. Retrying extraction.`);
            return await extractWithOllama(prompt, fallbackModel, false);
          } else {
            throw new Error(`AIPendingProvisioningError: No chat-capable models are available currently. Ollama is likely still downloading the primary model.`);
          }
        }
      } catch (e) {
        logger.debug(`[AI] Failed to fetch fallback models from /api/tags: ${e}`);
      }
    }

    throw new Error(`Ollama API error: ${response.status} ${txt.slice(0, 500)}`);
  }

  let extractedText = "";

  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // The last chunk might be incomplete

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const payload = JSON.parse(trimmed.slice(6));
            const delta = payload.choices?.[0]?.delta?.content;
            if (delta) {
              extractedText += delta;
            }
          } catch (e) {
            // Wait for next chunk if JSON is fragmented
          }
        }
      }
    }
  } else {
    const data: any = await response.json();
    extractedText = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.content || data?.output?.[0]?.content || "";
  }

  if (!extractedText) throw new Error("No content in Ollama response");

  const insights = parseAIResponse(extractedText);
  normalizeDates(insights);
  normalizeLinksAndChecklist(insights);
  validateInsights(insights);
  return insights;
};

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

/**
 * Groq retires hosted models on a rolling basis — roughly every couple of
 * months — and a name that works today can be gone tomorrow. That already bit
 * us once: llama-3.3-70b-versatile was hardcoded here, Groq decommissioned it,
 * every request failed, and the silent Ollama fallback made it look like a
 * broken API key.
 *
 * Emty ships as a desktop app with no updater, so a hardcoded model name means
 * the next rotation breaks AI processing for every installed copy until each
 * user reinstalls. Instead we resolve against the live model list at runtime
 * and take the best one actually available, so the app heals itself.
 *
 * Ordered best-first. Every entry must be verified to return parseable JSON
 * for the extraction prompt before being added — a model that "works" but
 * emits prose would silently poison every insight.
 *
 * qwen/qwen3.6-27b is deliberately NOT here despite being one of Groq's
 * suggested replacements: it emits inline <think> blocks into content, blows
 * the token budget and does not parse as JSON.
 */
const GROQ_MODEL_PREFERENCE = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
];

const GROQ_MODEL_CACHE_TTL_MS = 60 * 60 * 1000;
let groqModelCache: { model: string; at: number } | null = null;

export class GroqNoModelError extends Error {
  constructor(available: string[]) {
    super(
      `No supported Groq chat model available. Tried [${GROQ_MODEL_PREFERENCE.join(', ')}], ` +
      `account offers [${available.join(', ')}]`
    );
    this.name = 'GroqNoModelError';
  }
}

export function invalidateGroqModelCache(): void {
  groqModelCache = null;
}

/**
 * Records a failure that will not fix itself with a retry — no usable model on
 * the account, or a rejected key. Surfaced in Profile > cloud LLM so the user
 * learns about it the same day rather than noticing the queue is slow weeks
 * later. Transient failures (429 / 5xx / timeouts) must not come through here;
 * they have their own retry and groqTpdExhaustedAt handling.
 */
export async function recordGroqPermanentError(
  userId: string | undefined,
  code: 'no_model' | 'invalid_key' | 'key_unreadable',
  message: string
): Promise<void> {
  if (!userId) return;
  try {
    await UserIntentProfileModel.updateOne(
      { userId },
      { $set: { groqLastError: { code, message, at: new Date() } } }
    );
  } catch (err: any) {
    logger.info(`[AI] Could not record Groq error state: ${err?.message}`);
  }
}

/** Clears the marker above once Groq answers successfully again. */
async function clearGroqPermanentError(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    await UserIntentProfileModel.updateOne(
      { userId, groqLastError: { $ne: null } },
      { $set: { groqLastError: null } }
    );
  } catch {
    // Non-critical: the marker clears on the next successful call.
  }
}

/**
 * Resolves which Groq model to call. Cached, so this is one request per hour
 * rather than one per email.
 *
 * Deliberately does NOT fall back to "whatever the account lists first" — that
 * list includes whisper-large-v3, canopylabs/orpheus-* and
 * meta-llama/llama-prompt-guard-*, none of which are chat models. Better to
 * fail clearly and let the caller fall back to Ollama.
 */
export const resolveGroqModel = async (groqApiKey: string): Promise<string> => {
  // Escape hatch: pin a model without a code change.
  const pinned = process.env.GROQ_MODEL?.trim();
  if (pinned) return pinned;

  if (groqModelCache && Date.now() - groqModelCache.at < GROQ_MODEL_CACHE_TTL_MS) {
    return groqModelCache.model;
  }

  const res = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${groqApiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  const body = await res.json() as { data?: Array<{ id: string }> };
  const available = (body.data ?? []).map(m => m.id);

  const chosen = GROQ_MODEL_PREFERENCE.find(m => available.includes(m));
  if (!chosen) throw new GroqNoModelError(available);

  if (groqModelCache?.model !== chosen) {
    logger.info(`[AI] Resolved Groq model: ${chosen}`);
  }
  groqModelCache = { model: chosen, at: Date.now() };
  return chosen;
};

/**
 * Calls the Groq cloud API (OpenAI-compatible endpoint).
 * Captures rate-limit headers and persists them back to the user profile.
 */
const extractWithGroq = async (
  prompt: string,
  groqApiKey: string,
  userId?: string,
  model?: string
): Promise<AIInsightExtraction> => {
  const GROQ_MODEL = model ?? await resolveGroqModel(groqApiKey);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        // The gpt-oss models reason before answering, and those hidden tokens
        // are billed against max_tokens. At the default effort a single email
        // burns ~326 reasoning tokens and can crowd out the JSON entirely,
        // leaving empty content and finish_reason 'length'. 'low' cuts that to
        // ~36 with no loss of extraction quality, and the raised ceiling keeps
        // a long email from truncating mid-object. Ignored by non-reasoning
        // models, so it is safe across the preference list.
        reasoning_effort: 'low',
        max_tokens: 1200,
        stream: true,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Groq API error: ${response.status} ${txt.slice(0, 400)}`);
  }

  // Capture rate-limit headers before streaming body
  const remaining = parseInt(response.headers.get('x-ratelimit-remaining-requests') || '-1', 10);
  const limit = parseInt(response.headers.get('x-ratelimit-limit-requests') || '-1', 10);

  // Persist rate limits back to MongoDB asynchronously (non-blocking)
  if (userId && remaining >= 0 && limit > 0) {
    UserIntentProfileModel.updateOne(
      { userId },
      { $set: { groqRateLimits: { remaining, limit, lastUpdated: Date.now() } } }
    ).catch((err: any) => logger.debug('[Groq] Failed to persist rate limits:', err.message));
  }

  // Stream response body (same reader pattern as extractWithOllama)
  let extractedText = '';
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const payload = JSON.parse(trimmed.slice(6));
            const delta = payload.choices?.[0]?.delta?.content;
            if (delta) extractedText += delta;
          } catch {
            // Fragmented chunk — wait for next
          }
        }
      }
    }
  }

  if (!extractedText) throw new Error('No content in Groq response');

  const insights = parseAIResponse(extractedText);
  normalizeDates(insights);
  normalizeLinksAndChecklist(insights);
  validateInsights(insights);
  return insights;
};

const runAttempt = async (
  attempt: AIResolvedContext["attempts"][number],
  prompt: string
): Promise<AIInsightExtraction> => {
  return extractWithOllama(prompt, attempt.model);
};

export const extractInsightsFromEmail = async (
  emailContent: {
    from: string;
    subject: string;
    body: string;
    internalDate?: string;
    relevantLabels?: Array<{ name: string; description?: string }>;
    preExtractedLinks?: PreExtractedLink[];
  },
  options: ExtractInsightOptions = {}
): Promise<AIInsightExtraction> => {
  const linkMap = new Map<string, string>();
  const linkMapAnchors = new Map<string, string>();
  const promptLinks: Array<{ id: string; displayString: string }> = [];

  const noiseRegex = /unsubscribe|report a problem|terms and conditions|privacy policy|security advice|view online|manage preferences|get app/i;

  for (const link of emailContent.preExtractedLinks || []) {
    const rawAnchor = link.anchorText || '';
    const anchor = cleanNoiseText(rawAnchor);
    if (noiseRegex.test(anchor) || noiseRegex.test(rawAnchor)) continue;

    const id = link.id;
    linkMap.set(id, link.url);
    linkMapAnchors.set(id, rawAnchor);

    const displayParts = [];
    if (anchor) displayParts.push(`Anchor: "${anchor}"`);
    if (link.context) {
      const urlStrippedContext = link.context.replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, '');
      const cleanedContext = cleanNoiseText(urlStrippedContext);
      if (cleanedContext) displayParts.push(`Context: "${cleanedContext}"`);
    }

    promptLinks.push({
      id,
      displayString: displayParts.length > 0 ? displayParts.join(' | ') : 'No anchor or context available'
    });
  }

  const prompt = buildPrompt({ ...emailContent, stage2Candidates: options.stage2Candidates, promptLinks });
  const context =
    options.context || (options.userId ? await resolveAIContextForUser(options.userId) : null);

  if (!context || context.attempts.length === 0) {
    throw new Error('No AI providers configured (neither user key nor shared key available)');
  }

  logger.debug(
    `[AI] Starting extraction | user=${options.userId || context.userId} | attempts=${context.attempts.length} | promptChars=${prompt.length} | useGroq=${!!options.useGroq}`
  );
  logger.debug(`[AI] Raw prompt being sent:\n${prompt}`);
  logger.debug(
    `[AI] Attempt chain: ${context.attempts
      .map((a) => `${a.provider}:${a.model}:${a.source}`)
      .join(' -> ')}`
  );

  const resolveLinks = (insights: AIInsightExtraction) => {
    const resolvedLinks: AIInsightExtraction["importantLinks"] = [];
    for (const link of insights.importantLinks) {
      if (link.id) {
        const originalUrl = linkMap.get(link.id);
        if (originalUrl) {
          resolvedLinks.push({
            url: originalUrl,
            label: linkMapAnchors.get(link.id) || undefined,
            reason: link.reason,
            inferred: link.inferred,
          });
        }
      } else if (link.url) {
        resolvedLinks.push(link);
      }
    }
    insights.importantLinks = resolvedLinks;
    return insights;
  };

  // Route to Groq cloud first if enabled for this email
  if (options.useGroq && options.groqApiKey && options.userId) {
    // 1. Fetch user profile to check the exhausted flag
    const profile = await UserIntentProfileModel.findOne({ userId: options.userId }).lean();
    let isExhausted = false;

    if (profile?.groqTpdExhaustedAt) {
      const exhaustedDate = new Date(profile.groqTpdExhaustedAt);
      const now = new Date();
      
      // Check if we have crossed UTC midnight since the exhaustion time
      const isSameUtcDay = 
        exhaustedDate.getUTCFullYear() === now.getUTCFullYear() &&
        exhaustedDate.getUTCMonth() === now.getUTCMonth() &&
        exhaustedDate.getUTCDate() === now.getUTCDate();

      if (isSameUtcDay) {
        logger.info(`[AI] Groq TPD exhausted today (UTC). Skipping Groq, falling back to Ollama.`);
        isExhausted = true;
      } else {
        logger.info(`[AI] Passed UTC midnight since Groq TPD exhausted. Resetting flag in DB.`);
        await UserIntentProfileModel.updateOne({ userId: options.userId }, { $set: { groqTpdExhaustedAt: null } });
      }
    }

    // 2. Only attempt Groq if flag is clear (or just got cleared)
    if (!isExhausted) {
      let groqAttemptCount = 0;
      let groqSuccess = false;
      let groqResult: any;

      while (groqAttemptCount < 2 && !groqSuccess) {
        try {
          groqAttemptCount++;
          const groqModel = await resolveGroqModel(options.groqApiKey);
          logger.debug(`[AI] Routing to Groq | model=${groqModel} (Attempt ${groqAttemptCount})`);
          groqResult = await extractWithGroq(prompt, options.groqApiKey, options.userId, groqModel);
          const enriched = applyInferenceFallback(groqResult, emailContent);
          logger.debug('[AI] Groq extraction succeeded');
          await clearGroqPermanentError(options.userId);
          return resolveLinks(enriched);
        } catch (groqErr: any) {
          const errMsg = groqErr?.message?.toLowerCase() || "";

          // No usable chat model on this account — permanent until Emty ships a
          // new preference list or Groq adds one back. Record it so the UI can
          // say so instead of silently degrading to Ollama forever.
          if (groqErr instanceof GroqNoModelError) {
            logger.info(`[AI] ${groqErr.message}`);
            await recordGroqPermanentError(options.userId, 'no_model', groqErr.message);
            break;
          }

          // A model that vanished mid-run: drop the cached choice, re-resolve
          // once, and try again before giving up.
          if (
            (errMsg.includes('model_not_found') || errMsg.includes('does not exist') ||
             errMsg.includes('decommissioned')) && groqAttemptCount === 1
          ) {
            logger.info('[AI] Groq model no longer available — re-resolving and retrying once');
            invalidateGroqModelCache();
            continue;
          }

          if (errMsg.includes('401') || errMsg.includes('invalid_api_key')) {
            logger.info('[AI] Groq rejected the API key');
            await recordGroqPermanentError(options.userId, 'invalid_key', 'Groq rejected the API key');
            break;
          }

          // Check if it's a 429 error
          if (errMsg.includes("429")) {
            // Case 1: Tokens Per Day (TPD) exhausted
            if (errMsg.includes("tokens per day") || errMsg.includes("tpd")) {
              logger.debug(`[AI] Groq TPD exhausted. Saving flag to DB and falling back to Ollama immediately.`);
              await UserIntentProfileModel.updateOne(
                { userId: options.userId },
                { $set: { groqTpdExhaustedAt: Date.now() } }
              );
              break; // Do not retry Groq, break out of while loop
            }

            // Case 2: Tokens Per Minute (TPM) exhausted
            if (errMsg.includes("tokens per minute") || errMsg.includes("tpm") || errMsg.includes("please try again in")) {
              if (groqAttemptCount === 1) {
                // Parse wait time, e.g., "please try again in 7.195s"
                const match = errMsg.match(/try again in ([\d\.]+)s/);
                const waitSeconds = match ? parseFloat(match[1]) : 5;
                const waitMs = (waitSeconds + 1.5) * 1000;

                logger.debug(`[AI] Groq TPM exhausted. Waiting ${waitMs}ms before retrying once...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
                continue; // Retry once
              } else {
                logger.debug(`[AI] Groq TPM retry failed. Falling back to Ollama.`);
                break; // Fall through
              }
            }
          }

          logger.info(`[AI] Groq attempt failed (${groqErr?.message}), falling back to Ollama`);
          break; // Break on any non-429 error or if retries exhausted
        }
      }
    }
  } else if (options.useGroq && options.groqApiKey) {
    // Fallback for when userId is not provided (just one attempt)
    try {
      const groqModel = await resolveGroqModel(options.groqApiKey);
      logger.debug(`[AI] Routing to Groq | model=${groqModel}`);
      const result = await extractWithGroq(prompt, options.groqApiKey, options.userId, groqModel);
      const enriched = applyInferenceFallback(result, emailContent);
      logger.debug('[AI] Groq extraction succeeded');
      return resolveLinks(enriched);
    } catch (groqErr: any) {
      logger.info(`[AI] Groq attempt failed (${groqErr?.message}), falling back to Ollama`);
    }
  }

  let firstFailure: { provider: string; model: string; message: string } | null = null;
  let finalError: any = null;

  for (const attempt of context.attempts) {
    try {
      logger.debug(
        `[AI] Attempting provider=${attempt.provider} model=${attempt.model} source=${attempt.source} transport=${attempt.transport}`
      );
      const result = await runAttempt(attempt, prompt);
      logger.debug(
        `[AI] Attempt success provider=${attempt.provider} model=${attempt.model} source=${attempt.source}`
      );
      const enriched = applyInferenceFallback(result, emailContent);
      logger.debug(`[AI] Extraction completed successfully`);
      return resolveLinks(enriched);
    } catch (err: any) {
      logger.debug(
        `[AI] Attempt failed provider=${attempt.provider} model=${attempt.model} source=${attempt.source} reason=${err?.message || err}`
      );
      finalError = err;
      if (!firstFailure) {
        firstFailure = {
          provider: attempt.provider,
          model: attempt.model,
          message: err?.message || "AI provider attempt failed",
        };
      }
      continue;
    }
  }

  logger.info(`[AI] All provider attempts failed`);
  throw finalError || new Error("All AI providers failed");
};


