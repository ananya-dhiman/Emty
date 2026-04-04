import { GoogleGenAI } from "@google/genai";
import { inferActionIntelligence } from "./insightInference";
import { AIResolvedContext, resolveAIContextForUser } from "./aiProviderService";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
  }>;
  checklist: Array<{
    task: string;
    status: "pending";
    dueDate?: string;
    reason?: string;
    inferred?: boolean;
  }>;
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

const buildPrompt = (emailContent: {
  from: string;
  subject: string;
  body: string;
  internalDate?: string;
  relevantLabels?: Array<{ name: string; description?: string }>;
}): string => {
  const candidates = emailContent.relevantLabels?.length
    ? emailContent.relevantLabels
        .map((l) => `- ${l.name}: ${l.description || "No description"}`)
        .join("\n")
    : "- Needs Action: Emails that require a response, deadline, or task\n- Finance: Bills, transactions, payments";

  return `You are an email insight extraction AI. Analyze the following email and extract structured insights.

From: ${emailContent.from}
Subject: ${emailContent.subject}
Date: ${emailContent.internalDate || "Unknown"}

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
6. extractedFacts: Object with any important facts
7. importanceScore: A number from 0.0 to 1.0
8. importantLinks: Array of important URLs with optional label/reason.
9. checklist: Array of actionable tasks with shape { task, status, dueDate?, reason? }. Keep status as "pending".

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

const extractWithGemini = async (
  prompt: string,
  model: string,
  apiKey: string
): Promise<AIInsightExtraction> => {
  const genai = new GoogleGenAI({ apiKey });
  const result = await genai.models.generateContent({
    model,
    contents: prompt,
  });
  const text = result.text;
  if (!text) throw new Error("Gemini returned empty response");
  const insights = parseAIResponse(text);
  normalizeDates(insights);
  normalizeLinksAndChecklist(insights);
  validateInsights(insights);
  return insights;
};

const extractWithOpenAI = async (
  prompt: string,
  model: string,
  apiKey: string
): Promise<AIInsightExtraction> => {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${txt.slice(0, 500)}`);
  }

  const data: any = await response.json();
  const extractedText: string | undefined = data?.choices?.[0]?.message?.content;
  if (!extractedText) throw new Error("No content in OpenAI response");

  const insights = parseAIResponse(extractedText);
  normalizeDates(insights);
  normalizeLinksAndChecklist(insights);
  validateInsights(insights);
  return insights;
};

const extractWithOpenRouter = async (
  prompt: string,
  model: string,
  apiKey: string
): Promise<AIInsightExtraction> => {
  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "openrouter/auto",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${txt.slice(0, 500)}`);
  }

  const data: any = await response.json();
  const extractedText: string | undefined =
    data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
  if (!extractedText) throw new Error("No content in OpenRouter response");

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
  if (attempt.transport === "gemini") {
    return extractWithGemini(prompt, attempt.model, attempt.apiKey);
  }
  if (attempt.transport === "openrouter") {
    return extractWithOpenRouter(prompt, attempt.model, attempt.apiKey);
  }
  return extractWithOpenAI(prompt, attempt.model, attempt.apiKey);
};

export const extractInsightsFromEmail = async (
  emailContent: {
    from: string;
    subject: string;
    body: string;
    internalDate?: string;
    relevantLabels?: Array<{ name: string; description?: string }>;
  },
  options: ExtractInsightOptions = {}
): Promise<AIInsightExtraction> => {
  const prompt = buildPrompt(emailContent);
  const context =
    options.context || (options.userId ? await resolveAIContextForUser(options.userId) : null);

  if (!context || context.attempts.length === 0) {
    throw new Error("No AI providers configured (neither user key nor shared key available)");
  }

  console.log(
    `[AI] Starting extraction | user=${options.userId || context.userId} | attempts=${context.attempts.length} | promptChars=${prompt.length}`
  );
  console.log(
    `[AI] Attempt chain: ${context.attempts
      .map((a) => `${a.provider}:${a.model}:${a.source}`)
      .join(" -> ")}`
  );

  let firstFailure: { provider: string; model: string; message: string } | null = null;
  let finalError: any = null;

  for (const attempt of context.attempts) {
    try {
      console.log(
        `[AI] Attempting provider=${attempt.provider} model=${attempt.model} source=${attempt.source} transport=${attempt.transport}`
      );
      const result = await runAttempt(attempt, prompt);
      console.log(
        `[AI] Attempt success provider=${attempt.provider} model=${attempt.model} source=${attempt.source}`
      );
      if (attempt.source === "shared" && firstFailure && options.onFallback) {
        console.warn(
          `[AI] Fallback triggered from ${firstFailure.provider}:${firstFailure.model} to ${attempt.provider}:${attempt.model}`
        );
        await options.onFallback({
          usedSharedFallback: true,
          reason: firstFailure.message,
          fromProvider: firstFailure.provider,
          fromModel: firstFailure.model,
          toProvider: attempt.provider,
          toModel: attempt.model,
        });
      }
      const enriched = applyInferenceFallback(result, emailContent);
      console.log(`[AI] Extraction completed successfully`);
      return enriched;
    } catch (err: any) {
      console.warn(
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

  console.error(`[AI] All provider attempts failed`);
  throw finalError || new Error("All AI providers failed");
};
