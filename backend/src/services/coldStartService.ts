import { InsightModel } from "../model/Insight";
import { UserIntentProfileModel } from "../model/UserIntentProfile";

// Configurable limits — change here without a redeploy
export const COLD_START_LIMIT_TEST = 10;
export const COLD_START_LIMIT_PROD = 100;

// Common noise words to exclude from keyword extraction
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "was", "are", "be", "been", "have",
  "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "can", "re", "fw", "fwd", "your", "you", "we", "our",
  "i", "it", "this", "that", "my", "me", "hi", "hello", "hey", "dear",
  "please", "thank", "thanks", "regards", "best", "sincerely",
]);

/**
 * Tokenises a string into cleaned lowercase words, filtering stop words
 * and short tokens.
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

/**
 * Builds a frequency map from a list of tokens.
 */
function buildFrequencyMap(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

/**
 * Returns the top N entries from a frequency map, sorted descending.
 */
function topN(freq: Map<string, number>, n: number): string[] {
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word]) => word);
}

/**
 * Extracts the domain part from an email address string.
 * Handles formats like "Name <email@domain.com>" and "email@domain.com".
 */
function extractDomain(fromField: string): string | null {
  const match = fromField.match(/<([^>]+)>/) ?? fromField.match(/([^\s]+)/);
  if (!match) return null;
  const email = match[1];
  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

export interface ColdStartResult {
  inferredKeywords: string[];
  inferredDomains: string[];
  inferredLabels: string[];
  emailsScanned: number;
}

/**
 * Reads existing Insight records (already processed emails) and extracts
 * recurring keywords, sender domains, and label names to bootstrap the
 * UserIntentProfile.
 *
 * This does NOT save to DB — the caller is responsible for persisting.
 *
 * @param userId   Firebase UID
 * @param accountId  GmailAccount ObjectId string
 * @param limit    Number of emails to scan (default: COLD_START_LIMIT_TEST)
 */
export async function extractColdStartFeatures(
  userId: string,
  accountId: string,
  limit: number = COLD_START_LIMIT_TEST
): Promise<ColdStartResult> {
  const insights = await InsightModel.find({ userId, accountId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const allTokens: string[] = [];
  const domainFreq = new Map<string, number>();
  const labelFreq = new Map<string, number>();

  for (const insight of insights) {
    // Keywords from snippet + intent summary
    const text = [insight.summary?.shortSnippet ?? ""].join(" ");
    const tokens = tokenise(text);
    allTokens.push(...tokens);

    // Sender domains
    const domain = extractDomain(insight.from?.email ?? "");
    if (domain) {
      domainFreq.set(domain, (domainFreq.get(domain) ?? 0) + 1);
    }

    // Labels
    for (const lbl of insight.labels ?? []) {
      if (lbl.name) {
        labelFreq.set(lbl.name, (labelFreq.get(lbl.name) ?? 0) + 1);
      }
    }
  }

  const kwFreq = buildFrequencyMap(allTokens);

  return {
    inferredKeywords: topN(kwFreq, 15),
    inferredDomains: topN(domainFreq, 10),
    inferredLabels: topN(labelFreq, 10),
    emailsScanned: insights.length,
  };
}

/**
 * Runs extractColdStartFeatures and persists the result into
 * UserIntentProfile (upsert). Safe to call multiple times —
 * only updates the inferred fields, does not overwrite user edits.
 *
 * @returns The full ColdStartResult plus the saved profile
 */
export async function runAndPersistColdStart(
  userId: string,
  accountId: string,
  limit: number = COLD_START_LIMIT_TEST
): Promise<ColdStartResult> {
  const result = await extractColdStartFeatures(userId, accountId, limit);

  await UserIntentProfileModel.findOneAndUpdate(
    { userId },
    {
      $set: {
        inferredKeywords: result.inferredKeywords,
        inferredDomains: result.inferredDomains,
        inferredLabels: result.inferredLabels,
        lastUpdated: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  return result;
}
