/**
 * RulesEngine Service
 * Centralized rules and relevance filtering logic
 * Used by both emailController (scan) and incrementalSyncService (sync)
 * Prevents code duplication and ensures consistency
 */

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

export interface UserPreferences {
  // Future: expand to support user-customizable rules
  // For now, use system defaults
}

export class RulesEngine {
  /**
   * Check if email matches inclusion rules
   */
  private isIncluded(metadata: EmailMetadata): boolean {
    const { from, subject, snippet, hasAttachments } = metadata;

    // Extract domain from 'from' (e.g., user@domain.com -> domain.com)
    const domainMatch = from.match(/@(.+)/);
    const domain = domainMatch ? domainMatch[1].toLowerCase() : "";

    // Include rules based on domain
    if (
      domain.includes(".edu") ||
      ["linkedin.com", "indeed.com", "glassdoor.com"].includes(domain)
    ) {
      return true;
    }

    // Include if has attachments
    if (hasAttachments) {
      return true;
    }

    // Include based on keywords in subject/snippet
    const text = `${subject} ${snippet}`.toLowerCase();
    if (/\b(job|interview|application|deadline|event|opportunity)\b/.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Check if email matches exclusion rules
   */
  private isExcluded(metadata: EmailMetadata): boolean {
    const { from, subject, snippet } = metadata;

    // Exclude no-reply emails
    if (
      from.toLowerCase().includes("no-reply@") ||
      from.toLowerCase().includes("noreply@")
    ) {
      return true;
    }

    // Exclude newsletters and promotions
    const text = `${subject} ${snippet}`.toLowerCase();
    if (
      /\b(weekly digest|newsletter|promotion|unsubscribe)\b/i.test(text)
    ) {
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
      if (this.isExcluded(email)) {
        return false;
      }

      // Otherwise, must match inclusion rules
      return this.isIncluded(email);
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
}

export default new RulesEngine();
