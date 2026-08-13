import { Request, Response } from 'express';
import * as insightRepository from '../db/repositories/insightRepository';
import * as accountLocalRepository from '../db/repositories/accountLocalRepository';
import logger from '../utils/logger';

const mapTrackedRow = (row: insightRepository.InsightRow, accountEmail?: string) => ({
  insightId: row.id,
  gmailThreadId: row.gmail_thread_id,
  isTracked: true,
  trackingNote: row.tracking_note,
  trackedAt: row.tracked_at,
  isCompleted: row.is_completed === 1,
  accountId: row.account_id,
  ...(accountEmail !== undefined ? { accountEmail } : {}),
  from: {
    email: row.from_email,
    name: row.from_name,
    domain: row.from_domain,
  },
  summary: (() => {
    try { return JSON.parse(row.summary_snippet); }
    catch { return { shortSnippet: row.summary_snippet, intent: row.summary_intent }; }
  })(),
  matchedLabels: (() => {
    try {
      const labels = JSON.parse(row.labels || '[]');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return labels.map((l: any) => l?.name || '').filter(Boolean);
    } catch { return []; }
  })(),
  dates: (() => {
    try { return JSON.parse(row.dates || '[]'); } catch { return []; }
  })(),
  isActionRequired: row.summary_intent === 'action_required',
});

/**
 * PUT /api/emails/insights/:insightId/track
 * Body — at least one of:
 *   { isTracked: boolean }            toggle; tracking PRESERVES an existing note
 *   { trackingNote: string | null }   note-only update (insight must be tracked)
 *   { isTracked: true, trackingNote } both at once
 * Responds with the full tracking state so callers can update optimistically.
 */
export const toggleTracking = async (req: Request, res: Response): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uid = (req as any).user?.uid;
  const insightId = String(req.params.insightId || '');
  const body = req.body || {};
  const hasIsTracked = 'isTracked' in body;
  const hasNote = 'trackingNote' in body;

  if (!uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  if (!insightId) {
    res.status(400).json({ success: false, message: 'insightId is required' });
    return;
  }
  if (hasIsTracked && typeof body.isTracked !== 'boolean') {
    res.status(400).json({ success: false, message: 'isTracked must be a boolean' });
    return;
  }
  if (hasNote && body.trackingNote !== null && typeof body.trackingNote !== 'string') {
    res.status(400).json({ success: false, message: 'trackingNote must be a string or null' });
    return;
  }
  if (!hasIsTracked && !hasNote) {
    res.status(400).json({ success: false, message: 'isTracked or trackingNote is required' });
    return;
  }

  try {
    const insight = insightRepository.findById(insightId);
    if (!insight || insight.user_id !== uid) {
      res.status(404).json({ success: false, message: 'Insight not found or unauthorized' });
      return;
    }

    if (hasIsTracked) {
      insightRepository.setTracked(insightId, body.isTracked);
    }

    const nowTracked = hasIsTracked ? body.isTracked : insight.is_tracked === 1;
    if (hasNote) {
      if (!nowTracked) {
        res.status(400).json({ success: false, message: 'Cannot set a tracking note on an untracked insight' });
        return;
      }
      const note = typeof body.trackingNote === 'string' && body.trackingNote.trim() !== ''
        ? body.trackingNote.trim()
        : null;
      insightRepository.setTrackingNote(insightId, note);
    }

    const updated = insightRepository.findById(insightId);
    res.status(200).json({
      success: true,
      insightId,
      isTracked: updated?.is_tracked === 1,
      trackingNote: updated?.tracking_note ?? null,
      trackedAt: updated?.tracked_at ?? null,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    logger.info('Error toggling tracking:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update tracking: ' + error.message });
  }
};

/**
 * GET /api/emails/tracked?accountId=...
 * Returns all tracked insights for one of the authenticated user's accounts.
 */
export const getTrackedInsights = async (req: Request, res: Response): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uid = (req as any).user?.uid;
  const accountId = String(req.query.accountId || '');

  if (!uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  if (!accountId) {
    res.status(400).json({ success: false, message: 'accountId is required' });
    return;
  }

  try {
    const account = accountLocalRepository
      .findAllByUser(uid)
      .find((a) => a.id === accountId);
    if (!account) {
      res.status(403).json({ success: false, message: 'Unauthorized: Invalid account' });
      return;
    }

    const rows = insightRepository.findAllTracked(accountId);
    res.json({ success: true, tracked: rows.map((row) => mapTrackedRow(row)) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    logger.info('Error fetching tracked insights:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch tracked insights: ' + error.message });
  }
};

/**
 * GET /api/emails/tracked/all
 * Returns tracked insights across ALL accounts for the authenticated user.
 * Used by the widget Tracked filter tab and the dashboard Tracked board.
 */
export const getAllTrackedInsights = async (req: Request, res: Response): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uid = (req as any).user?.uid;
  if (!uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  try {
    const userAccounts = accountLocalRepository.findAllByUser(uid);
    const emailByAccountId = new Map(userAccounts.map((a) => [a.id, a.email_address]));

    const allTracked = insightRepository
      .findTrackedByUserId(uid)
      .filter((row) => emailByAccountId.has(row.account_id))
      .map((row) => mapTrackedRow(row, emailByAccountId.get(row.account_id)));

    // Already ordered tracked_at DESC by the query; keep explicit for safety
    allTracked.sort((a, b) => (b.trackedAt || 0) - (a.trackedAt || 0));

    res.json({ success: true, tracked: allTracked });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    logger.info('Error fetching all tracked insights:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch tracked insights: ' + error.message });
  }
};
