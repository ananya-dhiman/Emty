import { UserIntentProfile } from "../model/UserIntentProfile";
import * as emailMessageRepository from "../db/repositories/emailMessageRepository";

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
 * Reads existing EmailMessage records (staged candidate emails) and extracts
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
  // Use EmailMessage instead of InsightModel since AI Insights aren't generated
  // until AFTER onboarding in the new decoupled async pipeline.
  const emails = emailMessageRepository.findByAccountId(accountId);
  // Sort descending by internal_date and take `limit`
  const latestEmails = emails
    .sort((a, b) => b.internal_date - a.internal_date)
    .slice(0, limit);

  const allTokens: string[] = [];
  const domainFreq = new Map<string, number>();
  const labelFreq = new Map<string, number>();

  for (const email of latestEmails) {
    // Keywords from snippet + subject
    const text = [email.subject ?? "", email.snippet ?? ""].join(" ");
    const tokens = tokenise(text);
    allTokens.push(...tokens);

    // Sender domains
    const domain = extractDomain(email.from ?? "");
    if (domain) {
      domainFreq.set(domain, (domainFreq.get(domain) ?? 0) + 1);
    }

    // Generic extracted labels from RulesEngine phase 1
    let extractedFeatures: string[] = [];
    try {
      extractedFeatures = email.extracted_features ? JSON.parse(email.extracted_features) : [];
    } catch (e) {}
    for (const lblName of extractedFeatures) {
      if (lblName) {
        labelFreq.set(lblName, (labelFreq.get(lblName) ?? 0) + 1);
      }
    }
  }

  const kwFreq = buildFrequencyMap(allTokens);

  return {
    inferredKeywords: topN(kwFreq, 15),
    inferredDomains: topN(domainFreq, 10),
    inferredLabels: topN(labelFreq, 10),
    emailsScanned: latestEmails.length,
  };
}

/**
 * Runs extractColdStartFeatures and persists the result into
 * UserIntentProfile (upsert). Safe to call multiple times —
 * seeds keyword/domain preferences for fresh profiles and stores inferred labels.
 * Existing user-edited keyword/domain preferences are never overwritten.
 *
 * @returns The full ColdStartResult plus the saved profile
 */
export async function runAndPersistColdStart(
  userId: string,
  accountId: string,
  limit: number = COLD_START_LIMIT_TEST
): Promise<ColdStartResult> {
  const result = await extractColdStartFeatures(userId, accountId, limit);
  const existingProfile = await UserIntentProfile.findUnique({
    where: { userId },
    select: { includeKeywords: true, preferredDomains: true },
  });

  const setPayload: Record<string, any> = {
    inferredLabels: result.inferredLabels,
    lastUpdated: new Date(),
  };

  if (!Array.isArray(existingProfile?.includeKeywords) || existingProfile.includeKeywords.length === 0) {
    setPayload.includeKeywords = result.inferredKeywords;
  }
  if (!Array.isArray(existingProfile?.preferredDomains) || existingProfile.preferredDomains.length === 0) {
    setPayload.preferredDomains = result.inferredDomains;
  }

  await UserIntentProfile.upsert({
    where: { userId },
    create: {
      userId,
    },
    update: {
      ...setPayload,
    },
  });

  return result;
}
