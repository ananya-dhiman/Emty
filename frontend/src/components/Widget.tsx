/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../styles/Widget.css';
import { API_BASE_URL, initApi } from '../utils/api';
import type { PriorityRankingItem } from './Dashboard';
import { TrackNoteEditor } from './TrackNoteEditor';
import { invoke } from '@tauri-apps/api/core';

const openExternalLink = (url: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const normalizeDateValue = (raw: any): Date | null => {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof raw === 'object' && raw.$date) {
    const nested = typeof raw.$date === 'string' || typeof raw.$date === 'number'
      ? raw.$date
      : raw.$date?.$numberLong;
    if (!nested) return null;
    const parsed = new Date(nested);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

interface WidgetCardData {
  id: string;
  initials: string;
  from: string;
  intent: string;
  title: string;
  summary: string;
  due: Date | null;
  label: string;
  hasAttach: boolean;
  hasLink: boolean;
  needsReply: boolean;
  originalItem: PriorityRankingItem;
}

/**
 * Converts a Date into a short human-readable relative-time string.
 * e.g. 'just now', '2 min ago', '1 hr ago', '3 hrs ago'
 */
function formatSyncTime(date: Date | null): string {
  if (!date) return 'never synced';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return '1 hr ago';
  return `${diffHr} hrs ago`;
}

export function WidgetApp() {
  const [items, setItems] = useState<WidgetCardData[]>([]);
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncText, setLastSyncText] = useState('never synced');
  const [filteredCount, setFilteredCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  // Account switcher
  const [accounts, setAccounts] = useState<Array<{ id: string; emailAddress: string }>>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  // Filter tabs
  const [activeFilter, setActiveFilter] = useState<'all' | 'tracked' | 'urgent'>('all');

  // Tracked section
  const [trackedItems, setTrackedItems] = useState<any[]>([]);
  const [trackedOpen, setTrackedOpen] = useState(true);
  const [trackError, setTrackError] = useState<string | null>(null);
  const trackErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracked follows the active account (tracked/all returns every account's pins)
  const visibleTracked = trackedItems.filter(
    (ti) => !activeAccountId || !ti.accountId || ti.accountId === activeAccountId
  );

  // Stores the actual Date of last completed sync so the ticker can reformat it
  const lastSyncAtRef = useRef<Date | null>(null);

  const openMainApp = async () => {
    try {
      await invoke('open_main_window');
    } catch (e) {
      console.warn('[Widget] Could not open main window', e);
    }
  };

  // Resolved after initApi() runs — shared across fetchData and doSync
  const gmailAccountIdRef = useRef<string | null>(null);
  const emailRef = useRef<string | null>(null);
  const apiReadyRef = useRef(false);


  /**
   * Returns the freshest available token.
   * The main window's Axios interceptor writes the latest Firebase token to
   * localStorage every request, so reading it here is a reliable fallback
   * for the widget window which does not have the Firebase SDK loaded.
   */
  const getToken = (): string | null => localStorage.getItem('firebaseToken');

  /**
   * Resolve the gmailAccountId once and cache it.
   * Correct endpoint: GET /api/auth/verify (not /api/auth/me which does not exist).
   */
  const resolveAccountId = async (): Promise<string | null> => {
    if (gmailAccountIdRef.current) return gmailAccountIdRef.current;

    const token = getToken();
    if (!token) {
      console.warn('[Widget] No firebaseToken in localStorage — user may not be logged in');
      return null;
    }

    try {
      const res = await axios.get(`${API_BASE_URL}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.user?.email) {
        emailRef.current = String(res.data.user.email);
      }
      const accountId = res.data?.user?.gmailAccountId
        ? String(res.data.user.gmailAccountId)
        : null;
      if (!accountId) {
        console.warn('[Widget] gmailAccountId missing from /api/auth/verify response', res.data);
      }
      gmailAccountIdRef.current = accountId;
      return accountId;
    } catch (e: any) {
      console.error('[Widget] Could not resolve gmailAccountId via /api/auth/verify:', e?.response?.status, e?.message);
      return null;
    }
  };

  const mapItems = (rankingData: any): WidgetCardData[] => {
    const topPriority = rankingData.topPriority || [];
    const actionRequired = rankingData.actionRequired || [];
    const combined = [...topPriority, ...actionRequired];
    const uniqueItems = Array.from(
      new Map(combined.map((item: any) => [item.insightId, item])).values()
    );

    const mapped: WidgetCardData[] = uniqueItems.map((item: any) => {
      let due: Date | null = null;
      if (Array.isArray(item.dates)) {
        const deadline = item.dates.find((d: any) => d.type === 'deadline');
        if (deadline) due = normalizeDateValue(deadline.date);
      }

      const fromName = item.from?.name || item.from?.email || '';
      const initials = fromName
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

      const hasAttach = Array.isArray(item.attachments) && item.attachments.length > 0;
      const hasLink =
        item.importantLinksByEmail && 
        Object.values(item.importantLinksByEmail).some((links: any) => Array.isArray(links) && links.length > 0);

      return {
        id: item.insightId,
        initials: initials || '?',
        from: fromName,
        intent: item.summary?.intent || '',
        title:
          item.emailContextById?.[item.gmailThreadId]?.subject ||
          item.summary?.shortSnippet ||
          'No Subject',
        summary: item.summary?.shortSnippet || '',
        due,
        label: item.matchedLabels?.[0] || 'Task',
        hasAttach,
        hasLink,
        needsReply: item.isActionRequired,
        originalItem: item,
      };
    });

    // Sort: closest deadline first, then by score
    mapped.sort((a, b) => {
      if (a.due && b.due) return a.due.getTime() - b.due.getTime();
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      return (
        (b.originalItem.score?.totalScore || 0) -
        (a.originalItem.score?.totalScore || 0)
      );
    });

    return mapped;
  };

  const fetchData = async (overrideAccountId?: string) => {
    const token = getToken();
    if (!token) {
      setWidgetError('Not logged in. Open the main Emty window first.');
      setIsLoading(false);
      return;
    }

    try {
      setWidgetError(null);

      // Refresh the accounts list every fetch so additions/removals made in
      // the main window propagate to the widget's switcher.
      let resolvedAccounts = accounts;
      let reconciledId: string | null = null;
      try {
        const accRes = await axios.get(`${API_BASE_URL}/api/accounts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (accRes.data.success && Array.isArray(accRes.data.accounts) && accRes.data.accounts.length > 0) {
          resolvedAccounts = accRes.data.accounts;
          setAccounts(resolvedAccounts);

          // Restore last active account from localStorage, and reconcile if
          // the current one no longer exists (e.g. it was just removed).
          const currentId = gmailAccountIdRef.current;
          const currentValid = !!currentId && resolvedAccounts.some((a: any) => a.id === currentId);
          if (!currentValid) {
            const saved = localStorage.getItem('emty_active_account_id');
            const match = resolvedAccounts.find((a: any) => a.id === saved);
            const firstId = match ? match.id : resolvedAccounts[0].id;
            setActiveAccountId(firstId);
            gmailAccountIdRef.current = firstId;
            reconciledId = firstId;
          }
        }
      } catch {
        // Non-blocking — fall back to verify endpoint
      }

      // Resolve account id to use for fetching emails (reconciled id wins —
      // the state update above hasn't landed yet within this run)
      const accountId = overrideAccountId ?? reconciledId ?? activeAccountId ?? await resolveAccountId();
      if (!accountId) {
        setWidgetError('No Gmail account found. Connect Gmail in the main Emty window.');
        setIsLoading(false);
        return;
      }

      // Fetch priority ranking for the active account
      const rankingRes = await axios.get(
        `${API_BASE_URL}/api/emails/priority-ranking?accountId=${accountId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (rankingRes.data.success) {
        setFilteredCount(rankingRes.data.lowPriorityEmails?.length ?? 0);
        setItems(mapItems(rankingRes.data));
        const completedFromApi = new Set<string>(
          (rankingRes.data.completed || []).map((item: any) => String(item.insightId))
        );
        setSubmitted(completedFromApi);
      } else {
        setWidgetError('Failed to load emails from server.');
      }

      // Fetch tracked items cross-account
      try {
        const trackedRes = await axios.get(
          `${API_BASE_URL}/api/emails/tracked/all`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (trackedRes.data.success) {
          setTrackedItems(trackedRes.data.tracked || []);
        }
      } catch {
        // Non-blocking
      }

    } catch (err: any) {
      console.error('[Widget] Failed to fetch data', err);
      setWidgetError(`Error: ${err?.response?.status ?? ''} ${err?.message ?? 'Network error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Poll sync-progress until the backend reports completed or error.
   * Mirrors the same logic used by the Dashboard's handleSync.
   */
  const pollUntilComplete = async (accountId: string): Promise<void> => {
    const token = getToken();
    const MAX_WAIT_MS = 5 * 60 * 1000;
    const POLL_INTERVAL_MS = 2500;
    const startedAt = Date.now();

    return new Promise<void>((resolve) => {
      const poll = async () => {
        try {
          const { data } = await axios.get(
            `${API_BASE_URL}/api/emails/sync-progress?accountId=${accountId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const stage = data?.progressStage;
          if (stage === 'completed' || stage === 'error') {
            resolve();
            return;
          }
        } catch {
          // non-blocking, keep polling
        }

        if (Date.now() - startedAt > MAX_WAIT_MS) {
          resolve();
          return;
        }

        setTimeout(poll, POLL_INTERVAL_MS);
      };

      void poll();
    });
  };

  const doSync = async () => {
    setIsSyncing(true);
    setLastSyncText('syncing...');

    try {
      const token = getToken();
      if (!token) return;

      const accountId = activeAccountId ?? await resolveAccountId();
      if (!accountId) return;

      await axios.post(
        `${API_BASE_URL}/api/emails/sync`,
        { accountId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      await pollUntilComplete(accountId);
      await fetchData();

      const now = new Date();
      lastSyncAtRef.current = now;
      setLastSyncText(formatSyncTime(now));
    } catch (e) {
      console.error('[Widget] Sync error', e);
      setLastSyncText('sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  // Switch the active account tab — replaces the card list
  const switchAccount = (accountId: string) => {
    setActiveAccountId(accountId);
    gmailAccountIdRef.current = accountId;
    localStorage.setItem('emty_active_account_id', accountId);
    setIsLoading(true);
    fetchData(accountId);

    // Tell the backend so the sidecar's background sync follows this account
    const token = getToken();
    if (token) {
      axios.put(
        `${API_BASE_URL}/api/accounts/${accountId}/active`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(() => { /* non-blocking */ });
    }
  };

  const flashTrackError = (msg: string) => {
    setTrackError(msg);
    if (trackErrorTimerRef.current) clearTimeout(trackErrorTimerRef.current);
    trackErrorTimerRef.current = setTimeout(() => setTrackError(null), 4000);
  };

  // Toggle tracking state on an insight — optimistic, reverts + surfaces errors
  const toggleTrack = async (id: string, currentlyTracked: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const token = getToken();
    if (!token) {
      flashTrackError('Not logged in — open the main Emty window first.');
      return;
    }

    const prevTracked = trackedItems;
    if (currentlyTracked) {
      setTrackedItems(prevTracked.filter((ti) => ti.insightId !== id));
    } else {
      const item = items.find((d) => d.id === id);
      setTrackedItems([
        {
          insightId: id,
          gmailThreadId: item?.originalItem.gmailThreadId,
          from: item?.originalItem.from,
          summary: item?.originalItem.summary,
          matchedLabels: item?.originalItem.matchedLabels || [],
          trackingNote: null,
          trackedAt: Date.now(),
          accountId: activeAccountId,
        },
        ...prevTracked,
      ]);
    }

    try {
      const res = await axios.put(
        `${API_BASE_URL}/api/emails/insights/${id}/track`,
        { isTracked: !currentlyTracked },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.data?.success) throw new Error(res.data?.message || 'Tracking update failed');
      await fetchData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.warn('[Widget] Failed to toggle tracking', err);
      setTrackedItems(prevTracked);
      flashTrackError(err?.response?.data?.message || err?.message || 'Could not update tracking.');
    }
  };

  // Save / clear the sticky note on a tracked insight
  const saveTrackingNote = async (id: string, note: string) => {
    const token = getToken();
    if (!token) return;
    const trimmed = note.trim();
    const prevTracked = trackedItems;
    setTrackedItems(prevTracked.map((ti) =>
      ti.insightId === id ? { ...ti, trackingNote: trimmed || null } : ti
    ));
    try {
      const res = await axios.put(
        `${API_BASE_URL}/api/emails/insights/${id}/track`,
        { trackingNote: trimmed || null },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.data?.success) throw new Error(res.data?.message || 'Note update failed');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setTrackedItems(prevTracked);
      flashTrackError(err?.response?.data?.message || err?.message || 'Could not save the note.');
    }
  };

  const handleSaveNote = (id: string, note: string) => {
    void saveTrackingNote(id, note);
  };

  useEffect(() => {
    document.body.classList.add('widget-mode');
    const root = document.getElementById('root');
    if (root) root.classList.add('widget-mode');

    // Theme comes from data-mode on <html>; the widget window mirrors the
    // main window's persisted choice and follows live changes via storage events.
    const applyTheme = () => {
      const saved = localStorage.getItem('app-theme');
      document.documentElement.setAttribute('data-mode', saved === 'light' ? 'light' : 'dark');
    };
    applyTheme();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'app-theme') applyTheme();
      // Follow account switches made from the main window
      if (e.key === 'emty_active_account_id' && e.newValue && e.newValue !== gmailAccountIdRef.current) {
        setActiveAccountId(e.newValue);
        gmailAccountIdRef.current = e.newValue;
        setIsLoading(true);
        void fetchData(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);

    // Ensure the API URL is resolved via Tauri IPC before any requests
    const bootstrap = async () => {
      if (!apiReadyRef.current) {
        await initApi();
        apiReadyRef.current = true;
      }
      await fetchData();

      // Seed lastSyncAt from backend so the display is accurate on first open
      try {
        const token = getToken();
        const accountId = gmailAccountIdRef.current;
        if (token && accountId) {
          const { data } = await axios.get(
            `${API_BASE_URL}/api/emails/sync-progress?accountId=${accountId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (data?.updatedAt) {
            const d = new Date(data.updatedAt);
            if (!Number.isNaN(d.getTime())) {
              lastSyncAtRef.current = d;
              setLastSyncText(formatSyncTime(d));
            }
          }
        }
      } catch {
        // non-blocking — display stays at 'never synced'
      }
    };

    void bootstrap();

    // Ticker: update the relative-time label every 30 seconds
    const ticker = setInterval(() => {
      if (!isSyncing) {
        setLastSyncText(formatSyncTime(lastSyncAtRef.current));
      }
    }, 30_000);

    // Background polling — refresh widget cards while a sync is active
    // This mirrors the Dashboard's background progress polling
    let isPolling = false;
    let lastStage = 'completed';

    const bgPoll = async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        const token = getToken();
        let accountId = gmailAccountIdRef.current;
        
        // Recover if we started up before app was logged in
        if (token && !accountId) {
          accountId = await resolveAccountId();
          if (accountId) {
             // Successfully recovered, fetch initial data
             await fetchData();
          }
        }

        if (!token || !accountId) return;

        const { data } = await axios.get(
          `${API_BASE_URL}/api/emails/sync-progress?accountId=${accountId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (data?.success && data.progressStage) {
          const finished =
            ['completed', 'error', 'idle'].includes(data.progressStage) ||
            data.syncState === 'error';
          if (!finished) {
            // A sync is running in main window — silently refresh cards
            await fetchData();
          } else {
            if (!['completed', 'error', 'idle'].includes(lastStage)) {
              // Final fetch to reflect completed state
              await fetchData();
            }
          }
          lastStage = data.progressStage;
        }
      } catch {
        // non-blocking
      } finally {
        isPolling = false;
      }
    };

    const pollInterval = setInterval(bgPoll, 5000);

    return () => {
      document.body.classList.remove('widget-mode');
      if (root) root.classList.remove('widget-mode');
      window.removeEventListener('storage', onStorage);
      clearInterval(pollInterval);
      clearInterval(ticker);
      if (trackErrorTimerRef.current) clearTimeout(trackErrorTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSubmit = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isCurrentlyDone = submitted.has(id);
    const newStatus = !isCurrentlyDone;

    setSubmitted(prev => {
      const next = new Set(prev);
      if (newStatus) { next.add(id); } else { next.delete(id); }
      return next;
    });

    try {
      const token = getToken();
      if (!token) return;
      await axios.put(
        `${API_BASE_URL}/api/emails/insights/${id}/complete`,
        { isCompleted: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchData();
    } catch (err) {
      console.warn('[Widget] Failed to sync completion status', err);
      setSubmitted(prev => {
        const next = new Set(prev);
        if (isCurrentlyDone) { next.add(id); } else { next.delete(id); }
        return next;
      });
    }
  };

  const getTimeLeftTier = (due: Date | null) => {
    if (!due) return { label: 'NO DEADLINE', cls: 'w-due-week', tier: 'week' };
    const diff = due.getTime() - Date.now();
    if (diff < 0) return { label: 'OVERDUE', cls: 'w-due-overdue', tier: 'overdue' };
    const h = Math.floor(diff / 36e5);
    const d = Math.floor(diff / 864e5);
    if (h < 24) return { label: `DUE IN ${h}H`, cls: 'w-due-today', tier: 'today' };
    return { label: `DUE IN ${d}D`, cls: 'w-due-week', tier: 'week' };
  };

  const getDisplayDate = () => {
    const d = new Date();
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const dayNum = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${dayName} ${dayNum} ${month}`;
  };

  const renderCards = () => {
    let sourceItems = [...items];

    // Apply filter tab
    if (activeFilter === 'urgent') {
      sourceItems = sourceItems.filter(
        (d) => d.originalItem.isActionRequired || (d.originalItem.score?.totalScore ?? 0) >= 0.6
      );
    }

    const sorted = sourceItems.sort((a, b) => {
      const aDone = submitted.has(a.id);
      const bDone = submitted.has(b.id);
      if (aDone && !bDone) return 1;
      if (!aDone && bDone) return -1;
      const tierOrder = { overdue: 0, today: 1, week: 2 };
      const aTier = getTimeLeftTier(a.due).tier as keyof typeof tierOrder;
      const bTier = getTimeLeftTier(b.due).tier as keyof typeof tierOrder;
      return (tierOrder[aTier] ?? 3) - (tierOrder[bTier] ?? 3);
    });

    return sorted.map((d) => {
      const t = getTimeLeftTier(d.due);
      const isDone = submitted.has(d.id);
      const isTracked = trackedItems.some((ti) => ti.insightId === d.id);
      const tierCls = isDone ? 'submitted' : isTracked ? 'tracked' : t.tier;
      const avCls =
        t.tier === 'overdue' ? 'w-av-red' : t.tier === 'today' ? 'w-av-amber' : 'w-av-muted';
      const trackingNote = trackedItems.find((ti) => ti.insightId === d.id)?.trackingNote;

      return (
        <div key={d.id} className={`w-dcard ${tierCls}`} onClick={() => {
           const threadId = d.originalItem.gmailThreadId?.trim() || (d.originalItem as any).messageId?.trim() || '';
           if (threadId) {
             const userEmail = emailRef.current || '';
             const url = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(userEmail)}&continue=${encodeURIComponent(`https://mail.google.com/mail/#all/${threadId}`)}`;
             openExternalLink(url);
           }
        }} style={{ cursor: 'pointer' }}>
          <div className="w-dc-top">
            <div className={`w-dc-av ${avCls}`}>{d.initials}</div>
            <div className="w-dc-body">
              <div className="w-dc-from">{d.from}</div>
              <div className="w-dc-title">{d.title}</div>
              <div className="w-dc-summary">{d.summary}</div>
              {isTracked && (
                <TrackNoteEditor
                  insightId={d.id}
                  note={trackingNote ?? null}
                  onSave={handleSaveNote}
                  viewClass="w-tracking-note w-note-btn"
                  editClass="w-tracking-note w-note-editing"
                  emptyClass="w-note-empty"
                />
              )}
            </div>
            <div className="w-dc-meta">
              {isDone ? (
                <span className="w-due-pill w-due-done">SUBMITTED</span>
              ) : (
                <span className={`w-due-pill ${t.cls}`}>{t.label}</span>
              )}
            </div>
          </div>
          <div className="w-dc-actions">
            {d.intent && (
              <span className="w-dc-intent">{d.intent.replace(/_/g, ' ')}</span>
            )}
            <span className="w-lbl-tag">{d.label}</span>
            {d.hasLink && (
              <button
                className="w-ibtn w-has-link"
                title="Open link"
                onClick={(e) => {
                  e.stopPropagation();
                  let firstLink = '';
                  if (d.originalItem.importantLinksByEmail) {
                    for (const sourceId in d.originalItem.importantLinksByEmail) {
                      const links = d.originalItem.importantLinksByEmail[sourceId];
                      if (links && links.length > 0) { firstLink = links[0].url; break; }
                    }
                  }
                  if (firstLink) openExternalLink(firstLink);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </button>
            )}
            {/* Track / Bookmark button */}
            <button
              className={`w-ibtn ${isTracked ? 'w-track-active' : ''}`}
              onClick={(e) => toggleTrack(d.id, isTracked, e)}
              title={isTracked ? 'Untrack' : 'Track this thread'}
            >
              <svg viewBox="0 0 24 24" fill={isTracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button
              className={`w-ibtn ${isDone ? 'w-submit-active' : ''}`}
              onClick={(e) => toggleSubmit(d.id, e)}
              title={isDone ? 'Undo' : 'Mark submitted'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
          </div>
        </div>
      );
    });
  };

  // Render the tracked section (follows the active account)
  const renderTrackedSection = () => {
    if (visibleTracked.length === 0) return null;

    return (
      <>
        <div className="w-tracked-hd" onClick={() => setTrackedOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          Tracked
          <span className="w-tracked-hd-count">{visibleTracked.length}</span>
          <svg className={`w-tracked-chevron ${trackedOpen ? 'open' : ''}`} viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        {trackedOpen && visibleTracked.map((ti, idx) => {
          const fromName = ti.from?.name || ti.from?.email || 'Unknown';
          const snippet = ti.summary?.shortSnippet || '';
          return (
            <div
              key={ti.insightId + idx}
              className="w-dcard tracked"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                const threadId = ti.gmailThreadId?.trim() || '';
                const accEmail = accounts.find((a) => a.id === ti.accountId)?.emailAddress || '';
                if (threadId) {
                  const url = `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(accEmail)}&continue=${encodeURIComponent(`https://mail.google.com/mail/#all/${threadId}`)}`;
                  openExternalLink(url);
                }
              }}
            >
              <div className="w-dc-top">
                <div className="w-dc-av w-av-muted">
                  {fromName.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase() || '?'}
                </div>
                <div className="w-dc-body">
                  <div className="w-dc-from">{fromName}</div>
                  <div className="w-dc-title">{snippet}</div>
                  <TrackNoteEditor
                    insightId={ti.insightId}
                    note={ti.trackingNote ?? null}
                    onSave={handleSaveNote}
                    viewClass="w-tracking-note w-note-btn"
                    editClass="w-tracking-note w-note-editing"
                    emptyClass="w-note-empty"
                  />
                </div>
              </div>
              <div className="w-dc-actions">
                <span className="w-lbl-tag">{ti.matchedLabels?.[0] || 'Tracked'}</span>
                <button
                  className="w-ibtn w-track-active"
                  onClick={(e) => { e.stopPropagation(); toggleTrack(ti.insightId, true, e); }}
                  title="Untrack"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  const pendingCount = items.filter((d) => !submitted.has(d.id)).length;
  const syncedLabel = ['never synced', 'syncing...', 'sync failed'].includes(lastSyncText)
    ? lastSyncText
    : `synced ${lastSyncText}`;

  return (
    <div className="w-widget">
      <div className="w-hd">
        <div className="w-drag-region" data-tauri-drag-region />
        <div className="w-hd-top">
          <div className="w-hd-left-group">
            <span className="w-today-lbl">
              TODAY <span className="w-today-date">{getDisplayDate()}</span>
            </span>
            <span className="w-filtered-lbl">{filteredCount} filtered · {syncedLabel}</span>
          </div>
          <div className="w-hd-right">
            {/* Account switcher — overlapping avatars + add button */}
            <div className="w-acct-stack">
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  className={`w-acct-av ${activeAccountId === acc.id ? '' : 'inactive'}`}
                  onClick={() => switchAccount(acc.id)}
                  title={acc.emailAddress}
                >
                  {acc.emailAddress.charAt(0)}
                </button>
              ))}
              <button className="w-acct-add" onClick={openMainApp} title="Add / switch account">+</button>
            </div>
            <button
              id="widget-open-app-btn"
              className="w-open-btn"
              onClick={openMainApp}
              aria-label="Open Emty app"
              title="Open Emty"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
              OPEN
            </button>
            <button
              className="w-sync-btn"
              onClick={doSync}
              disabled={isSyncing}
              aria-label="Sync"
              title={isSyncing ? 'Syncing' : 'Sync'}
            >
              <svg
                className={isSyncing ? 'spin' : ''}
                width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Filter tab bar */}
      <div className="w-filter-bar">
        <button
          className={`w-filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
          All
        </button>
        <button
          className={`w-filter-tab ${activeFilter === 'tracked' ? 'active' : ''}`}
          onClick={() => setActiveFilter('tracked')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          Tracked
          {visibleTracked.length > 0 && (
            <span className="w-filter-count">{visibleTracked.length}</span>
          )}
        </button>
        <button
          className={`w-filter-tab ${activeFilter === 'urgent' ? 'active' : ''}`}
          onClick={() => setActiveFilter('urgent')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Urgent
        </button>
      </div>

      <div className="w-scroll">
        {/* Tracked-only view */}
        {activeFilter === 'tracked' ? (
          <>
            {visibleTracked.length === 0 ? (
              <div className="w-empty-msg">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-empty-icon">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <span>No tracked threads yet</span>
              </div>
            ) : renderTrackedSection()}
          </>
        ) : (
          <>
            <div className="w-sec">
              <span className="w-sec-dot"></span>
              <span className="w-sec-lbl">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>
                Action Items
              </span>
              <span className="w-sec-count">{pendingCount} pending</span>
            </div>
            <div id="w-deadline-list">
              {isLoading ? (
                <div className="w-empty-msg" style={{ marginTop: '40px' }}>
                  <div className="widget-diamond-loader"></div>
                  <span>Loading...</span>
                </div>
              ) : widgetError ? (
                <div className="w-empty-msg">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-empty-icon" style={{ color: '#FF4D4D' }}>
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span style={{ color: '#FF4D4D', textAlign: 'center', lineHeight: '1.5' }}>{widgetError}</span>
                </div>
              ) : items.length === 0 ? (
                <div className="w-empty-msg">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-empty-icon">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>No actionable emails found</span>
                </div>
              ) : (
                renderCards()
              )}
            </div>
            {/* Tracked section appended below the main list in All/Urgent views */}
            {renderTrackedSection()}
          </>
        )}
      </div>

      {trackError && (
        <div className="w-track-error" role="alert">{trackError}</div>
      )}
    </div>
  );
}
