/**
 * Simple error classification helper for processing failures.
 * Determines if an error is transient (retryable) or permanent (non-retryable).
 */
import { AIParsingError } from "./aiService";

export type ErrorType = "transient" | "permanent" | "unknown";

export const classifyError = (err: any): ErrorType => {
  if (!err) return "unknown";

  // Node/network errors -> transient
  if (err.code) {
    const c = String(err.code);
    if (c === "ECONNRESET" || c === "ETIMEDOUT" || c === "ENOTFOUND") {
      return "transient";
    }
  }

  const msg = (err.message || "").toLowerCase();

  // Rate limit, timeout -> transient
  if (
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("429") ||
    msg.includes("timeout") ||
    msg.includes("timed out")
  ) {
    return "transient";
  }

  // 5xx errors -> transient
  if (msg.includes("5") && (msg.includes("00") || msg.includes("server error"))) {
    return "transient";
  }

  // AI parsing error: ambiguous—treat as unknown so it can be retried
  if (err instanceof AIParsingError || err.name === "AIParsingError") {
    return "unknown";
  }

  // 4xx / bad request -> permanent
  if (
    msg.includes("400") ||
    msg.includes("invalid request") ||
    msg.includes("invalid")
  ) {
    return "permanent";
  }

  // Default: unknown (will be retried up to MAX_RETRIES)
  return "unknown";
};

export default classifyError;
