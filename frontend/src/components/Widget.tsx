import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../styles/Widget.css';
import { API_BASE_URL, initApi } from '../utils/api';
import type { PriorityRankingItem } from './Dashboard';

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

export function WidgetApp() {
  const [items, setItems] = useState<WidgetCardData[]>([]);
  const [submitted, setSubmitted] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncText, setLastSyncText] = useState('synced just now');
  const [filteredCount, setFilteredCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [widgetError, setWidgetError] = useState<string | null>(null);

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

  const fetchData = async () => {
    const token = getToken();
    if (!token) {
      setWidgetError('Not logged in. Open the main Emty window first.');
      setIsLoading(false);
      return;
    }

    try {
      setWidgetError(null);
      const accountId = await resolveAccountId();
      if (!accountId) {
        setWidgetError('No Gmail account found. Connect Gmail in the main Emty window.');
        setIsLoading(false);
        return;
      }

      const rankingRes = await axios.get(
        `${API_BASE_URL}/api/emails/priority-ranking?accountId=${accountId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (rankingRes.data.success) {
        setFilteredCount(rankingRes.data.lowPriorityEmails?.length ?? 0);
        setItems(mapItems(rankingRes.data));
        // Derive completed set from backend — single source of truth, no localStorage
        const completedFromApi = new Set<string>(
          (rankingRes.data.completed || []).map((item: any) => String(item.insightId))
        );
        setSubmitted(completedFromApi);
      } else {
        setWidgetError('Failed to load emails from server.');
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

      const accountId = await resolveAccountId();
      if (!accountId) return;

      await axios.post(
        `${API_BASE_URL}/api/emails/sync`,
        { accountId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Wait for AI workers to complete (same as Dashboard)
      await pollUntilComplete(accountId);

      // Refresh cards after sync is truly done
      await fetchData();
      setLastSyncText('synced just now');
    } catch (e) {
      console.error('[Widget] Sync error', e);
      setLastSyncText('sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    document.body.classList.add('widget-mode');
    const root = document.getElementById('root');
    if (root) root.classList.add('widget-mode');

    // Ensure the API URL is resolved via Tauri IPC before any requests
    const bootstrap = async () => {
      if (!apiReadyRef.current) {
        await initApi();
        apiReadyRef.current = true;
      }
      await fetchData();
    };

    void bootstrap();

    // Background polling — refresh widget cards while a sync is active
    // This mirrors the Dashboard's background progress polling
    let pollInterval: ReturnType<typeof setInterval>;
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
          if (data.progressStage !== 'completed') {
            // A sync is running in main window — silently refresh cards
            await fetchData();
          } else {
            if (lastStage !== 'completed') {
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

    pollInterval = setInterval(bgPoll, 5000);

    return () => {
      document.body.classList.remove('widget-mode');
      if (root) root.classList.remove('widget-mode');
      clearInterval(pollInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSubmit = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isCurrentlyDone = submitted.has(id);
    const newStatus = !isCurrentlyDone;

    // Optimistic visual update
    setSubmitted(prev => {
      const next = new Set(prev);
      newStatus ? next.add(id) : next.delete(id);
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
      // Immediately re-fetch so the list re-sorts authoritatively from the server
      await fetchData();
    } catch (err) {
      console.warn('[Widget] Failed to sync completion status', err);
      // Revert optimistic update on failure
      setSubmitted(prev => {
        const next = new Set(prev);
        isCurrentlyDone ? next.add(id) : next.delete(id);
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
    const sorted = [...items].sort((a, b) => {
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
      const tierCls = isDone ? 'submitted' : t.tier;
      const avCls =
        t.tier === 'overdue' ? 'w-av-red' : t.tier === 'today' ? 'w-av-amber' : 'w-av-muted';

      return (
        <div key={d.id} className={`w-dcard ${tierCls}`} onClick={() => {
           const threadId = d.originalItem.gmailThreadId?.trim() || d.originalItem.messageId?.trim() || '';
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
                      if (links && links.length > 0) {
                        firstLink = links[0].url;
                        break;
                      }
                    }
                  }
                  if (firstLink) {
                    openExternalLink(firstLink);
                  }
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </button>
            )}
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

  const pendingCount = items.filter((d) => !submitted.has(d.id)).length;

  return (
    <div className="w-widget">
      <div className="w-hd">
        <div className="w-drag-region" data-tauri-drag-region />
        <div className="w-hd-top">
          <div className="w-hd-left-group">
            <span className="w-today-lbl">
              TODAY<span style={{ color: 'rgba(255,255,255,0.1)', margin: '0 4px' }}></span>
              <span style={{ color: 'var(--text-2, #A3A3A3)', fontSize: '12px' }}>
                {getDisplayDate()}
              </span>
            </span>
            <span className="w-filtered-lbl">{filteredCount} filtered out</span>
          </div>
          <div className="w-hd-right">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                className="w-sync-btn"
                onClick={doSync}
                disabled={isSyncing}
                aria-label="Sync"
              >
                <svg
                  className={isSyncing ? 'spin' : ''}
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                {isSyncing ? 'SYNCING' : 'SYNC'}
              </button>
            </div>
            <span className="w-sync-time">{lastSyncText}</span>
          </div>
        </div>
      </div>
      <div className="w-scroll">
        <div className="w-sec">
          <span className="w-sec-dot"></span>
          <span className="w-sec-lbl">Action Items</span>
          <span className="w-sec-count">{pendingCount} pending</span>
        </div>
        <div id="w-deadline-list">
          {isLoading ? (
            <div className="w-empty-msg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-empty-icon spin">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
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
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-empty-icon"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>No actionable emails found</span>
            </div>
          ) : (
            renderCards()
          )}
        </div>
      </div>
    </div>
  );
}
