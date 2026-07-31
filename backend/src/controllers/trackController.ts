import { Request, Response } from 'express';
import * as insightRepository from '../db/repositories/insightRepository';
import * as accountLocalRepository from '../db/repositories/accountLocalRepository';

/**
 * PUT /api/emails/insights/:insightId/track
 * Toggles the tracked state of an insight.
 * Body: { isTracked: boolean, trackingNote?: string }
 */
export const toggleTracking = async (req: Request, res: Response): Promise<void> => {
  const insightId = String(req.params.insightId || '');
  const isTracked = Boolean(req.body.isTracked);
  const trackingNote: string | null = typeof req.body.trackingNote === 'string' ? req.body.trackingNote : null;

  if (!insightId) {
    res.status(400).json({ success: false, message: 'insightId is required' });
    return;
  }

  const insight = insightRepository.findById(insightId);
  if (!insight) {
    res.status(404).json({ success: false, message: 'Insight not found' });
    return;
  }

  insightRepository.updateTrackingStatus(insightId, isTracked, trackingNote);
  res.json({ success: true, isTracked });
};

/**
 * GET /api/emails/tracked?accountId=...
 * Returns all tracked insights for a given account.
 * Used by the widget and dashboard tracked section.
 */
export const getTrackedInsights = async (req: Request, res: Response): Promise<void> => {
  const accountId = String(req.query.accountId || '');

  if (!accountId) {
    res.status(400).json({ success: false, message: 'accountId is required' });
    return;
  }

  const rows = insightRepository.findAllTracked(accountId);

  const items = rows.map((row) => ({
    insightId: row.id,
    gmailThreadId: row.gmail_thread_id,
    isTracked: true,
    trackingNote: row.tracking_note,
    trackedAt: row.tracked_at,
    isCompleted: row.is_completed === 1,
    accountId: row.account_id,
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
        return labels.map((l: any) => l?.name || '').filter(Boolean);
      } catch { return []; }
    })(),
    dates: (() => {
      try { return JSON.parse(row.dates || '[]'); } catch { return []; }
    })(),
    isActionRequired: row.summary_intent === 'action_required',
  }));

  res.json({ success: true, tracked: items });
};

/**
 * GET /api/emails/tracked/all
 * Returns tracked insights across ALL accounts for the authenticated user.
 * Used by the widget Tracked filter tab when an account switcher is active.
 */
export const getAllTrackedInsights = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).user?.uid;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }

  const userAccounts = accountLocalRepository.findAllByUser(userId);
  const allTracked: any[] = [];

  for (const account of userAccounts) {
    const rows = insightRepository.findAllTracked(account.id);
    for (const row of rows) {
      allTracked.push({
        insightId: row.id,
        gmailThreadId: row.gmail_thread_id,
        isTracked: true,
        trackingNote: row.tracking_note,
        trackedAt: row.tracked_at,
        isCompleted: row.is_completed === 1,
        accountId: row.account_id,
        accountEmail: account.email_address,
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
            return labels.map((l: any) => l?.name || '').filter(Boolean);
          } catch { return []; }
        })(),
        dates: (() => {
          try { return JSON.parse(row.dates || '[]'); } catch { return []; }
        })(),
        isActionRequired: row.summary_intent === 'action_required',
      });
    }
  }

  // Sort all tracked items by tracked_at descending
  allTracked.sort((a, b) => (b.trackedAt || 0) - (a.trackedAt || 0));

  res.json({ success: true, tracked: allTracked });
};
