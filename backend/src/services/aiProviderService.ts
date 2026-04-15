export type AIProvider = "ollama";

export interface AIUserSettings {}

export interface AIProviderAttempt {
  provider: AIProvider;
  model: string;
  apiKey: string;
  source: "local";
  hasFallback: false;
  transport: "ollama";
}

export interface AIResolvedContext {
  userId: string;
  settings: AIUserSettings;
  hasByokKey: false;
  preferredProvider: AIProvider;
  attempts: AIProviderAttempt[];
}

const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL?.trim() || "llama2";

export const resolveAIContextForUser = async (userId: string): Promise<AIResolvedContext> => ({
  userId,
  settings: {},
  hasByokKey: false,
  preferredProvider: "ollama",
  attempts: [
    {
      provider: "ollama",
      model: DEFAULT_OLLAMA_MODEL,
      apiKey: "",
      source: "local",
      hasFallback: false,
      transport: "ollama",
    },
  ],
});
