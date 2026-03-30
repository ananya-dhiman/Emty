/**
 * RulesEngine Service
 * Centralized rules and relevance filtering logic
 * Used by both emailController (scan) and incrementalSyncService (sync)
 * Prevents code duplication and ensures consistency
 */

import { IUserIntentProfile } from "../model/UserIntentProfile";

export interface EmailMetadata {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  internalDate: string;
  hasAttachments: boolean;
  labels?: string[];
}

export type UserPreferences = Partial<Pick<
  IUserIntentProfile,
  'includeKeywords' | 'preferredDomains' | 'excludeKeywords' | 'blockedDomains'
>>;

export interface RelevantLabelCandidate {
  name: string;
  description: string;
  source: string;
  score: number;
}

export class RulesEngine {
  /**
   * Check if email matches inclusion rules
   */
  private isIncluded(metadata: EmailMetadata, preferences?: UserPreferences): boolean {
    const { from, subject, snippet, hasAttachments } = metadata;

    // Extract domain from 'from' (e.g., user@domain.com -> domain.com)
    const domainMatch = from.match(/@([^>]+)/);
    let domain = domainMatch ? domainMatch[1].toLowerCase() : "";
    domain = domain.replace(/^["']|["']$/g, '').trim();

    // Include rules based on domain
    const preferred = preferences?.preferredDomains?.length 
      ? preferences.preferredDomains 
      : [".edu", "linkedin.com", "indeed.com", "glassdoor.com"];
    
    if (preferred.some(d => domain.includes(d.toLowerCase()))) {
      return true;
    }

    // Include if has attachments
    if (hasAttachments) {
      return true;
    }

    // Include based on keywords in subject/snippet
    const text = `${subject} ${snippet}`.toLowerCase();
    const keywords = preferences?.includeKeywords?.length 
      ? preferences.includeKeywords 
      : ["job", "interview", "application", "deadline", "event", "opportunity"];

    if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
      return true;
    }

    return false;
  }

  /**
   * Check if email matches exclusion rules
   */
  private isExcluded(metadata: EmailMetadata, preferences?: UserPreferences): boolean {
    const { from, subject, snippet } = metadata;

    const domainMatch = from.match(/@([^>]+)/);
    let domain = domainMatch ? domainMatch[1].toLowerCase() : "";
    domain = domain.replace(/^["']|["']$/g, '').trim();

    // Blocked Domains
    if (preferences?.blockedDomains?.length) {
      if (preferences.blockedDomains.some(d => domain.includes(d.toLowerCase()))) {
        return true;
      }
    }

    // Exclude no-reply emails
    if (
      from.toLowerCase().includes("no-reply@") ||
      from.toLowerCase().includes("noreply@")
    ) {
      return true;
    }

    // Exclude newsletters and promotions
    const text = `${subject} ${snippet}`.toLowerCase();
    const exclusions = preferences?.excludeKeywords?.length 
      ? preferences.excludeKeywords 
      : ["weekly digest", "newsletter", "promotion", "unsubscribe"];

    if (exclusions.some(ex => text.includes(ex.toLowerCase()))) {
      return true;
    }

    return false;
  }

  /**
   * Apply rules and relevance scoring
   * Returns filtered emails that pass both inclusion and exclusion checks
   */
  applyRulesAndRelevance(
    emails: EmailMetadata[],
    preferences?: UserPreferences
  ): EmailMetadata[] {
    return emails.filter((email) => {
      // If excluded, reject immediately
      if (this.isExcluded(email, preferences)) {
        return false;
      }

      // Otherwise, must match inclusion rules
      return this.isIncluded(email, preferences);
    });
  }

  /**
   * Compute relevance score for an email (0-100, for future use)
   * Currently simple, can be extended with ML scoring
   */
  computeRelevanceScore(metadata: EmailMetadata): number {
    let score = 0;

    // Domain matching: +30
    const domainMatch = metadata.from.match(/@(.+)/);
    const domain = domainMatch ? domainMatch[1].toLowerCase() : "";
    if (
      domain.includes(".edu") ||
      ["linkedin.com", "indeed.com", "glassdoor.com"].includes(domain)
    ) {
      score += 30;
    }

    // Attachments: +25
    if (metadata.hasAttachments) {
      score += 25;
    }

    // Keyword matching: +20
    const text = `${metadata.subject} ${metadata.snippet}`.toLowerCase();
    const keywordMatches = (text.match(/\b(job|interview|event|opportunity)\b/g) || []).length;
    if (keywordMatches > 0) {
      score += Math.min(keywordMatches * 10, 20);
    }

    // Has snippet text: +10
    if (metadata.snippet && metadata.snippet.length > 20) {
      score += 10;
    }

    return Math.min(score, 100);
  }

  getRelevantLabels(
    emailText: string,
    userLabels: Array<{ name: string; description?: string }> = []
  ): RelevantLabelCandidate[] {
    const DEFAULT_LABELS = [
      {
        name: "Needs Action",
        description: "Emails that require a response, deadline, or task",
        source: "system",
      },
      {
        name: "Finance",
        description: "Bills, transactions, payments",
        source: "system",
      },
    ];

    const normalizedEmailText = emailText.toLowerCase();
    const allLabels = [
      ...DEFAULT_LABELS,
      ...userLabels.map((l) => ({
        name: l.name,
        description: l.description || "",
        source: "user",
      })),
    ];

    const seen = new Set<string>();
    const uniqueLabels = allLabels.filter((label) => {
      const key = label.name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const scored: RelevantLabelCandidate[] = uniqueLabels.map((label) => {
      const text = `${label.name} ${label.description}`.toLowerCase();
      const words = text.split(/\W+/).filter(Boolean);
      let score = 0;
      for (const word of words) {
        if (normalizedEmailText.includes(word)) {
          score += 1;
        }
      }
      return { ...label, score };
    });

    const matches = scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    if (matches.length === 0) {
      return [];
    }

    return matches.slice(0, 5);
  }
}

export default new RulesEngine();
