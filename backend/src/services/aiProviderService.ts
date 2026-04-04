import { UserModel } from "../model/User";

export type AIProvider = "gemini" | "openai";

const GEMINI_ALLOWLIST = [  "gemini-2.0-flash-lite",   // cheapest + fastest (great for bulk)
  "gemini-1.5-flash-8b",     // ultra cheap, very high throughput
  "gemini-2.0-flash",        // fast + better quality
  "gemini-1.5-flash",        // strong balance + large context
  "gemini-2.5-flash",        // newer, slightly heavier
  "gemini-1.5-pro",          // HUGE context (1M tokens)
  "gemini-2.5-pro"           // best quality, most expensive
];
const OPENAI_ALLOWLIST = [
  "gpt-4o-mini",             // best cost/performance
  "gpt-4.1-mini",            // slightly smarter, still cheap
  "o1-mini",                 // reasoning fallback
  "o3-mini",                 // stronger reasoning fallback
  "gpt-4o",                  // higher quality, higher cost
  "gpt-4.1",                 // heavier + expensive
  "gpt-4o-realtime-preview" 
];

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-8b";
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SHARED_GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const SHARED_OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const SHARED_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";

export interface AIUserSettings {
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
  preferredProvider?: AIProvider;
  preferredModel?: string | null;
}

export interface AIProviderAttempt {
  provider: AIProvider;
  model: string;
  apiKey: string;
  source: "user" | "shared";
  hasFallback: boolean;
  transport: "gemini" | "openai" | "openrouter";
}

export interface AIResolvedContext {
  userId: string;
  settings: AIUserSettings;
  hasByokKey: boolean;
  preferredProvider: AIProvider;
  attempts: AIProviderAttempt[];
}

const normalizeProvider = (val?: string | null): AIProvider =>
  val === "openai" ? "openai" : "gemini";

const normalizeModelForProvider = (
  provider: AIProvider,
  requestedModel?: string | null
): string => {
  const model = (requestedModel || "").trim();
  if (provider === "gemini") {
    if (model && GEMINI_ALLOWLIST.includes(model)) return model;
    return DEFAULT_GEMINI_MODEL;
  }
  if (model && OPENAI_ALLOWLIST.includes(model)) return model;
  return DEFAULT_OPENAI_MODEL;
};

export const maskKey = (raw?: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length <= 4) return "****";
  return `****${trimmed.slice(-4)}`;
};

export const resolveAIContextForUser = async (userId: string): Promise<AIResolvedContext> => {
  const user = await UserModel.findOne({ firebaseId: userId });
  const settings = (user?.aiSettings || {}) as AIUserSettings;
  const preferredProvider = normalizeProvider(settings.preferredProvider);

  const userGeminiKey = settings.geminiApiKey?.trim() || "";
  const userOpenAIKey = settings.openaiApiKey?.trim() || "";
  const hasByokKey = Boolean(userGeminiKey || userOpenAIKey);

  const attempts: AIProviderAttempt[] = [];

  const addAttempt = (
    provider: AIProvider,
    source: "user" | "shared",
    apiKey: string,
    requestedModel?: string | null,
    transportOverride?: "gemini" | "openai" | "openrouter"
  ) => {
    if (!apiKey) return;
    const model = normalizeModelForProvider(provider, requestedModel);
    const exists = attempts.some((a) => a.provider === provider && a.source === source && a.model === model);
    if (exists) return;
    attempts.push({
      provider,
      model,
      apiKey,
      source,
      hasFallback: source === "shared",
      transport: transportOverride || (provider === "gemini" ? "gemini" : "openai"),
    });
  };

  if (preferredProvider === "gemini") {
    addAttempt("gemini", "user", userGeminiKey, settings.preferredModel);
    addAttempt("openai", "user", userOpenAIKey, settings.preferredModel);
  } else {
    addAttempt("openai", "user", userOpenAIKey, settings.preferredModel);
    addAttempt("gemini", "user", userGeminiKey, settings.preferredModel);
  }

  // Shared fallbacks: first preferred provider then alternate.
  if (preferredProvider === "gemini") {
    addAttempt("gemini", "shared", SHARED_GEMINI_KEY, DEFAULT_GEMINI_MODEL);
    if (SHARED_OPENAI_KEY) {
      addAttempt("openai", "shared", SHARED_OPENAI_KEY, DEFAULT_OPENAI_MODEL, "openai");
    } else if (SHARED_OPENROUTER_KEY) {
      addAttempt("openai", "shared", SHARED_OPENROUTER_KEY, "openrouter/auto", "openrouter");
    }
  } else {
    if (SHARED_OPENAI_KEY) {
      addAttempt("openai", "shared", SHARED_OPENAI_KEY, DEFAULT_OPENAI_MODEL, "openai");
    } else if (SHARED_OPENROUTER_KEY) {
      addAttempt("openai", "shared", SHARED_OPENROUTER_KEY, "openrouter/auto", "openrouter");
    }
    addAttempt("gemini", "shared", SHARED_GEMINI_KEY, DEFAULT_GEMINI_MODEL);
  }

  return {
    userId,
    settings,
    hasByokKey,
    preferredProvider,
    attempts,
  };
};
