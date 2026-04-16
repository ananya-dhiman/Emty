import { inferActionIntelligence } from "./insightInference";
import { AIResolvedContext, resolveAIContextForUser } from "./aiProviderService";
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

const buildPrompt = (emailContent: {
  from: string;
  subject: string;
  body: string;
  internalDate?: string;
  relevantLabels?: Array<{ name: string; description?: string }>;
  stage2Candidates?: Array<{ name: string; similarityScore: number; labelMode: string }>;
}): string => {
  let candidatesText = "- Needs Action: Emails that require a response, deadline, or task\n- Finance: Bills, transactions, payments";
  
  if (emailContent.stage2Candidates?.length) {
    candidatesText = "Pre-ranked Vector Similarity Candidates (highly recommended):\n" + 
      emailContent.stage2Candidates
        .map(c => `- ${c.name} (Similarity: ${(c.similarityScore * 100).toFixed(1)}%, Mode: ${c.labelMode})`)
        .join("\n");
  } else if (emailContent.relevantLabels?.length) {
    candidatesText = emailContent.relevantLabels
        .map((l) => `- ${l.name}: ${l.description || "No description"}`)
        .join("\n");
  }

  return `You are an email insight extraction AI. Analyze the following email and extract structured insights.

From: ${emailContent.from}
Subject: ${emailContent.subject}
Date: ${emailContent.internalDate || "Unknown"}

Label candidates:
${candidatesText}

Body:
${emailContent.body.substring(0, 2000)}

Extract and return a JSON object with:
1. intent: One of 'action_required', 'event', 'opportunity', 'information', 'waiting', 'noise'
2. shortSnippet: A 1-2 sentence summary of the email (max 150 chars)
3. labels: Array of 0-3 labels. Use ONLY labels from the provided label candidates when they genuinely fit. Return an empty array if none fit.
4. suggestedLabel: Optional short label name if the email clearly belongs to a repeated category not covered by the provided candidates. Otherwise return null.
5. labelMode: "existing" if you strictly used one of the provided candidates, "new" if you strongly suggest a new label.
6. confidence: Your confidence in the label assignment and insights from 0.0 to 1.0.
7. labelReason: A short internal reason for why you chose the labels and mode.
8. dates: Array of important dates with type ('deadline', 'event', 'followup') and ISO date string
9. extractedFacts: Object with any important facts
10. importanceScore: A number from 0.0 to 1.0
11. importantLinks: Array of important URLs with optional label/reason.
12. checklist: Array of actionable tasks with shape { task, status, dueDate?, reason? }. Keep status as "pending".

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

const extractWithOllama = async (
  prompt: string,
  model: string
): Promise<AIInsightExtraction> => {
  const response = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(OLLAMA_API_KEY ? { Authorization: `Bearer ${OLLAMA_API_KEY}` } : {}),
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
    throw new Error(`Ollama API error: ${response.status} ${txt.slice(0, 500)}`);
  }

  const data: any = await response.json();
  const extractedText: string | undefined =
    data?.choices?.[0]?.message?.content || data?.choices?.[0]?.content || data?.output?.[0]?.content;
  if (!extractedText) throw new Error("No content in Ollama response");

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
  },
  options: ExtractInsightOptions = {}
): Promise<AIInsightExtraction> => {
  const prompt = buildPrompt({ ...emailContent, stage2Candidates: options.stage2Candidates });
  const context =
    options.context || (options.userId ? await resolveAIContextForUser(options.userId) : null);

  if (!context || context.attempts.length === 0) {
    throw new Error("No AI providers configured (neither user key nor shared key available)");
  }

  logger.debug(
    `[AI] Starting extraction | user=${options.userId || context.userId} | attempts=${context.attempts.length} | promptChars=${prompt.length}`
  );
  logger.debug(
    `[AI] Attempt chain: ${context.attempts
      .map((a) => `${a.provider}:${a.model}:${a.source}`)
      .join(" -> ")}`
  );

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
      return enriched;
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


