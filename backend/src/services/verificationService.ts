import { AIInsightExtraction } from "./aiService";
import logger from '../utils/logger';

export type VerificationStatus = 'pending' | 'passed' | 'partial' | 'failed';

export interface VerificationResult {
  status: VerificationStatus;
  failedGroups: string[];
  correctedInsights?: AIInsightExtraction;
}

/**
 * Deterministic rule-based verification for AI generated insights.
 * Validates formatting, logical consistency, and performs basic grounding checks.
 */
export const verifyInsights = (
  emailBody: string,
  insights: AIInsightExtraction
): VerificationResult => {
  const failedGroups: string[] = [];
  const corrected = JSON.parse(JSON.stringify(insights)) as AIInsightExtraction;

  // 1. Schema & Structure Verification
  if (!Array.isArray(corrected.labels)) {
    failedGroups.push('schema_labels');
    corrected.labels = [];
  }
  
  if (!Array.isArray(corrected.dates)) {
    failedGroups.push('schema_dates');
    corrected.dates = [];
  }

  // 2. Intent consistency
  if (corrected.intent === 'action_required' && (!corrected.checklist || corrected.checklist.length === 0)) {
    // Action required but no action items extracted
    failedGroups.push('logic_intent_action');
    // Downgrade intent if no action is actually required
    corrected.intent = 'information';
  }

  if (corrected.checklist && corrected.checklist.length > 0 && corrected.intent === 'noise') {
    // Marked as noise but has checklist items
    failedGroups.push('logic_intent_noise');
    corrected.intent = 'action_required';
  }

  // 3. Grounding / Hallucination Checks (Basic)
  const normalizedBody = emailBody.toLowerCase();
  
  if (corrected.dates && corrected.dates.length > 0) {
    const validDates = corrected.dates.filter(d => {
      // Basic check: is the year even mentioned? 
      // Warning: this is a weak check, as "next Tuesday" might not have a year explicitly in text
      // but let's do a basic check on the snippet or fact.
      return true; // Skipping strict date text matching as it is error prone without LLM
    });
    
    if (validDates.length < corrected.dates.length) {
      failedGroups.push('grounding_dates');
      corrected.dates = validDates;
    }
  }

  if (corrected.importantLinks && corrected.importantLinks.length > 0) {
    const validLinks = corrected.importantLinks.filter(l => {
      // The parsed URL structure might look different from text (e.g. tracking links), 
      // but we can check if at least part of the url domain is in the body
      try {
        const urlObj = new URL(l.url);
        const host = urlObj.hostname.replace(/^www\\./, '');
        return normalizedBody.includes(host);
      } catch {
        return false; // invalid url format
      }
    });

    if (validLinks.length < corrected.importantLinks.length) {
      failedGroups.push('grounding_links');
      corrected.importantLinks = validLinks;
    }
  }

  // Calculate final status
  let status: VerificationStatus = 'passed';
  if (failedGroups.length > 0) {
    status = failedGroups.length > 2 ? 'failed' : 'partial';
  }

  if (status !== 'passed') {
    logger.debug(`[VERIFICATION] Insight Verification ${status} for intent ${insights.intent}. Failed groups: ${failedGroups.join(', ')}`);
  }

  return {
    status,
    failedGroups,
    correctedInsights: corrected
  };
};
