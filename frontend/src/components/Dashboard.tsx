import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import '../styles/Dashboard.css';
import { CalendarSidebar } from './CalendarSidebar';
import { Logo } from './Logo';
import { TrackNoteEditor } from './TrackNoteEditor';
import { API_BASE_URL } from '../utils/api';
import { startGmailConnect } from '../utils/connectGmail';

/* ── Collapsible section used in the detail panel body ── */
const DetCollapsible: React.FC<{
  label: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}> = ({ label, count, defaultOpen, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  return (
    <div className="det-section">
      <button
        className="det-section-hd"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <svg
          className={`det-section-chev ${open ? 'open' : ''}`}
          width="12" height="12" viewBox="0 0 16 16" fill="none"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="det-section-lbl">{label}</span>
        {count > 0 && <span className="det-section-ct">{count}</span>}
      </button>
      {open && <div className="det-section-body">{children}</div>}
    </div>
  );
};


interface PriorityRankingScoreBreakdown {
  baseScore: number;
  dynamicScore: number;
  totalScore: number;
  importanceNorm: number;
  labelNorm: number;
  recencyNorm: number;
  deadlineBoost: number;
  matchedLabelRank: number;
}

export interface PriorityRankingItem {
  insightId: string;
  messageId?: string;
  gmailThreadId: string;
  summary: {
    shortSnippet: string;
    intent: string;
  };
  from: {
    email: string;
    name?: string;
    domain?: string;
  };
  matchedLabels: string[];
  isActionRequired: boolean;
  isCompleted: boolean;
  score: PriorityRankingScoreBreakdown;
  timestamps: {
    createdAt?: Date;
    updatedAt?: Date;
    lastSignalAt?: Date;
  };
  dates?: Array<{
    type: 'deadline' | 'event' | 'followup';
    date: Date;
    sourceEmailId?: string;
  }>;
  attachments?: Array<{
    filename: string;
    mimeType?: string;
    size?: number;
    sourceEmailId?: string;
  }>;
  emailContextById?: Record<string, {
    subject?: string;
    from?: {
      email?: string;
      name?: string;
      domain?: string;
    };
    internalDate?: Date | string;
    extractedFacts?: Record<string, unknown>;
  }>;
  checklistItems?: Array<{
    task: string;
    status: 'pending';
    dueDate?: Date | string;
    reason?: string;
    inferred?: boolean;
    sourceEmailId?: string;
  }>;
  importantLinksByEmail?: Record<string, Array<{
    url: string;
    label?: string;
    reason?: string;
    inferred?: boolean;
  }>>;
  checklist?: string[];
}

interface LowPriorityEmailItem {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  internalDate?: Date | string;
  score: number;
  extractedFeatures: string[];
}

const normalizeLabelKey = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const parseSenderDisplay = (rawFrom: string): string => {
  const trimmed = (rawFrom || '').trim();
  if (!trimmed) return 'Unknown sender';
  const match = trimmed.match(/^(.*)<(.+)>$/);
  if (match) {
    const name = match[1]?.trim().replace(/^["']|["']$/g, '');
    return name || match[2].trim();
  }
  return trimmed;
};

const hexToRgba = (hex: string, alpha: number): string | null => {
  const clean = hex.replace('#', '').trim();
  if (![3, 6].includes(clean.length)) return null;
  const full = clean.length === 3
    ? clean.split('').map((ch) => ch + ch).join('')
    : clean;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return null;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeDates = (dates: any): Array<{ type: 'deadline' | 'event' | 'followup'; date: Date; sourceEmailId?: string }> => {
  if (!Array.isArray(dates)) return [];
  return dates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any) => {
      const type = item?.type;
      const parsedDate = normalizeDateValue(item?.date);
      if (!parsedDate || !['deadline', 'event', 'followup'].includes(type)) {
        return null;
      }
      return {
        type,
        date: parsedDate,
        sourceEmailId: item?.sourceEmailId,
      };
    })
    .filter(Boolean) as Array<{ type: 'deadline' | 'event' | 'followup'; date: Date; sourceEmailId?: string }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TimelineItem = ({ item, isFirst, selectedEmail, onSourceClick }: any) => {
  const [isOpen, setIsOpen] = useState(isFirst);
  const context = item.sourceEmailId ? selectedEmail?.emailContextById?.[item.sourceEmailId] : null;
  const hasFacts = context && context.extractedFacts;
  const reasonStr = hasFacts ? Object.values(context.extractedFacts).join(' · ') : '';
  const sourceName = context?.subject || item.sourceEmailId || 'Unknown source';

  return (
    <div className="tl-item">
      <div className={`tl-dot ${isFirst ? 'active' : ''}`}></div>
      <div className="tl-card">
        <div className="tl-header" onClick={() => setIsOpen(!isOpen)}>
          <div className="tl-date">{new Date(item.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
          <span className={`tl-type-tag ${item.type}`}>{item.type}</span>
          <svg className={`tl-toggle ${isOpen ? 'open' : ''}`} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className={`tl-body ${isOpen ? 'open' : ''}`}>
          {reasonStr || `Scheduled ${item.type} date.`}
          {item.sourceEmailId && (
            <div
              className="tl-source"
              onClick={(e) => { e.stopPropagation(); onSourceClick(item.sourceEmailId); }}
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
            >
              source: {(sourceName).length > 50 ? (sourceName).slice(0, 50) + '...' : sourceName}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface DashboardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'profile' | 'onboarding' | 'metrics') => void;
}

export function Dashboard({ user, theme, setTheme, onNavigate }: DashboardProps) {
  const [sidebarCol, setSidebarCol] = useState(false);
  const [calendarCol, setCalendarCol] = useState(false);
  const [rightCol, setRightCol] = useState(false);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [selectedLowPriorityMessageId, setSelectedLowPriorityMessageId] = useState<string | null>(null);
  const [selectedSourceMessageId, setSelectedSourceMessageId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [isFocusOpen, setIsFocusOpen] = useState(false);
  const [isActionOpen, setIsActionOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusItems, setFocusItems] = useState<PriorityRankingItem[]>([]);
  const [actionItems, setActionItems] = useState<PriorityRankingItem[]>([]);
  const [agendaItems, setAgendaItems] = useState<PriorityRankingItem[]>([]);
  const [completedItems, setCompletedItems] = useState<PriorityRankingItem[]>([]);
  const [isDoneOpen, setIsDoneOpen] = useState(false);
  // Shape comes from the backend's mapTrackedRow DTO (trackController.ts), which
  // is distinct from PriorityRankingItem. Typed as any pending a shared DTO type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [trackedItems, setTrackedItems] = useState<any[]>([]);
  const [lowPriorityItems, setLowPriorityItems] = useState<LowPriorityEmailItem[]>([]);
  const [isLowPriorityOpen, setIsLowPriorityOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'do' | 'all' | 'tracked' | 'done' | 'ignore'>('do');
  // All Items section: collapse + client-side filtering
  const [isAllItemsOpen, setIsAllItemsOpen] = useState(true);
  const [agendaSort, setAgendaSort] = useState<'priority' | 'newest' | 'sender'>('priority');
  const [agendaFilters, setAgendaFilters] = useState<Set<'action' | 'deadline'>>(new Set());
  const [agendaRange, setAgendaRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const lowPriorityRef = useRef<HTMLDivElement>(null);
  const allItemsRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [sidebarLabels, setSidebarLabels] = useState<{ id: string, name: string, color: string, rank: number, count: number }[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  // True when the backend reports a non-terminal sync whose heartbeat went
  // silent (network drop / crash) — the pill offers Retry instead of spinning.
  const [syncStalled, setSyncStalled] = useState(false);
  const [syncStats, setSyncStats] = useState<{ total: number, processed: number } | null>(null);
  const [notification, setNotification] = useState<{ show: boolean, message: string, detail?: string, type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  // Holds counts from the initial sync HTTP response so the poller can surface them on completion
  const manualSyncCountsRef = React.useRef<{ processed: number; succeeded: number; failed: number } | null>(null);

  // Multi-account: connected accounts + the one all data views follow.
  // The active id is shared with the widget via localStorage.
  const [accounts, setAccounts] = useState<Array<{ id: string; emailAddress: string; isActive?: boolean }>>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(
    () => localStorage.getItem('emty_active_account_id')
  );
  const effectiveAccountId = activeAccountId || user?.gmailAccountId || null;
  const activeAccountEmail =
    accounts.find((a) => a.id === effectiveAccountId)?.emailAddress || user?.email || '';
  // Tracked follows the active account (tracked/all returns every account's pins)
  const visibleTracked = trackedItems.filter(
    (ti) => !effectiveAccountId || !ti.accountId || ti.accountId === effectiveAccountId
  );

  const fetchAccounts = async () => {
    const token = localStorage.getItem('firebaseToken');
    if (!token) return;
    try {
      const res = await axios.get(`${API_BASE_URL}/api/accounts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data.success && Array.isArray(res.data.accounts)) {
        const list = res.data.accounts as Array<{ id: string; emailAddress: string; isActive?: boolean }>;
        setAccounts(list);
        // Reconcile a stale stored id against the real account list
        const stored = localStorage.getItem('emty_active_account_id');
        if (!list.some((a) => a.id === stored)) {
          const fallback = list.find((a) => a.isActive) || list[0];
          if (fallback) {
            setActiveAccountId(fallback.id);
            localStorage.setItem('emty_active_account_id', fallback.id);
          }
        } else if (stored && stored !== activeAccountId) {
          setActiveAccountId(stored);
        }
      }
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    void fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Follow account switches made from the widget window
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'emty_active_account_id' && e.newValue) {
        setActiveAccountId(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const switchAccount = async (accountId: string) => {
    if (!accountId || accountId === effectiveAccountId) return;
    setActiveAccountId(accountId);
    localStorage.setItem('emty_active_account_id', accountId);
    // Reset selection — it belongs to the previous account's data
    setSelectedInsightId(null);
    setSelectedLowPriorityMessageId(null);
    setSelectedSourceMessageId(null);
    setRightCol(false);
    // Clear every per-account view too, not just the selection. The AI Queue
    // counter in particular used to survive the switch, so the header kept
    // reporting the previous account's progress ("6 / 51") over an empty list
    // — which reads as "the app is working but nothing appears" rather than
    // "you are looking at a different account". Null means "unknown until the
    // next poll answers for THIS account", and the banner hides while null.
    setSyncStats(null);
    setSyncStalled(false);
    setFocusItems([]);
    setActionItems([]);
    setAgendaItems([]);
    setCompletedItems([]);
    setTrackedItems([]);
    setLowPriorityItems([]);
    // Tell the backend so the sidecar's background sync follows this account
    const token = localStorage.getItem('firebaseToken');
    if (token) {
      try {
        await axios.put(`${API_BASE_URL}/api/accounts/${accountId}/active`, {}, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // non-blocking — the UI switch still applies
      }
    }
  };

  const handleAddAccount = async () => {
    try {
      await startGmailConnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setNotification({
        show: true,
        type: 'error',
        message: 'Could not start Gmail connect',
        detail: err?.response?.data?.message || err?.message || 'Please try again.',
      });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // feedbackMap: insightId -> 'boost' | 'suppress' | null
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'boost' | 'suppress' | null>>({});

  const sendFeedback = useCallback(async (targetId: string, signal: 'boost' | 'suppress', type: 'insight' | 'message') => {
    const API_URL = API_BASE_URL;
    const token = localStorage.getItem('firebaseToken');
    // Toggle off if same signal clicked again
    const current = feedbackMap[targetId];
    const next = current === signal ? null : signal;
    setFeedbackMap((prev) => ({ ...prev, [targetId]: next }));
    if (!token) return;
    try {
      const payload = type === 'insight' ? { insightId: targetId, signal: next ?? 'none' } : { messageId: targetId, signal: next ?? 'none' };
      await axios.put(
        `${API_URL}/api/intent/feedback`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.warn('[Feedback] Failed to record feedback (non-blocking):', err);
    }
  }, [feedbackMap]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggleCompletion = async (insightId: string, currentStatus: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const token = localStorage.getItem('firebaseToken');
    if (!token) return;

    const newStatus = !currentStatus;

    const removeFromActive = (items: PriorityRankingItem[]) =>
      items.filter(item => item.insightId !== insightId);
    const markInActive = (items: PriorityRankingItem[]) =>
      items.map(item => item.insightId === insightId ? { ...item, isCompleted: newStatus } : item);

    if (newStatus) {
      const allActive = [...focusItems, ...actionItems, ...agendaItems];
      const movingItem = allActive.find(i => i.insightId === insightId);
      setFocusItems(removeFromActive);
      setActionItems(removeFromActive);
      setAgendaItems(removeFromActive);
      if (movingItem) {
        setCompletedItems(prev => [{ ...movingItem, isCompleted: true }, ...prev]);
      }
      setIsDoneOpen(true);
      showToast('Moved to Done. Scroll down to review.');
    } else {
      const movingItem = completedItems.find(i => i.insightId === insightId);
      setCompletedItems(prev => prev.filter(i => i.insightId !== insightId));
      if (movingItem) {
        setAgendaItems(prev => [{ ...movingItem, isCompleted: false }, ...prev]);
      }
      showToast('Moved back to All Items.');
    }
    setFocusItems(prev => markInActive(prev));
    setActionItems(prev => markInActive(prev));
    setAgendaItems(prev => markInActive(prev));

    try {
      await axios.put(
        `${API_BASE_URL}/api/emails/insights/${insightId}/complete`,
        { isCompleted: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchInsights(true);
    } catch (err) {
      console.warn('[Dashboard] Failed to toggle completion', err);
      fetchInsights(true);
    }
  };

  const fetchInsights = async (isBackground = false) => {
    const API_URL = API_BASE_URL;
    const token = localStorage.getItem('firebaseToken');

    if (!effectiveAccountId || !token) {
      if (!isBackground) setLoading(false);
      return;
    }

    try {
      if (!isBackground) setLoading(true);

      const [rankingRes, priorityRes, labelsRes] = await Promise.all([
        axios.get(`${API_URL}/api/emails/priority-ranking?accountId=${effectiveAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(e => ({ data: { success: false, message: e.message } })),
        axios.get(`${API_URL}/api/emails/label-priorities?accountId=${effectiveAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: { success: false } })),
        axios.get(`${API_URL}/api/emails/labels?accountId=${effectiveAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: { success: false } }))
      ]);

      const response = rankingRes;

      if (response.data.success) {
        setFocusItems(response.data.topPriority || []);
        setActionItems(response.data.actionRequired || []);
        setAgendaItems(response.data.others || []);
        setCompletedItems(response.data.completed || []);
        setLowPriorityItems(response.data.lowPriorityEmails || []);

        // Fetch tracked items (non-blocking, cross-account)
        try {
          const trackedRes = await axios.get(
            `${API_BASE_URL}/api/emails/tracked/all`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (trackedRes.data.success) {
            setTrackedItems(trackedRes.data.tracked || []);
          }
        } catch {
          // non-blocking
        }
      } else {
        console.error("API returned success: false", response.data);
        setError(response.data.message);
      }

      // Sidebar Labels integration
      if (priorityRes.data.success && labelsRes.data.success) {
        const activeLabels = labelsRes.data.labels || [];
        const priorities = priorityRes.data.priorities || [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const labelMap = new Map<string, any>(activeLabels.map((l: any) => [l._id, l]));

        const mappedLabels = priorities
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((p: any) => !['Focus', 'Action Required', 'Newsletters'].includes(p.labelNameSnapshot))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((p: any) => {
            const lbl = labelMap.get(p.labelId);
            // Try to derive a deterministic color if none provided
            const defaultColors = ['#C0351A', '#1854A0', '#186845', '#9A5405', 'var(--text-2)'];
            const fallbackColor = defaultColors[p.rank % defaultColors.length];

            return {
              id: p.labelId,
              name: p.labelNameSnapshot,
              color: lbl?.color || fallbackColor,
              rank: p.rank,
              count: 0 // Placeholder
            };
          });

        setSidebarLabels(mappedLabels);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Error fetching priority ranking:", err);
      if (err.response) {
        console.error("Error Response Data:", err.response.data);
      }
      setError("Failed to load dashboard insights");
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    setIsFocusOpen(focusItems.length > 0);
  }, [focusItems.length]);

  useEffect(() => {
    setIsActionOpen(actionItems.length > 0);
  }, [actionItems.length]);

  useEffect(() => {
    fetchInsights(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, effectiveAccountId]);

  // Background polling for live-stream dashboard (Option B)
  // Auto-refreshes the inbox while the background workers are active
  useEffect(() => {
    if (!effectiveAccountId) return;
    const token = localStorage.getItem('firebaseToken');
    if (!token) return;

    let isCurrentlyPolling = false;
    let lastStage = 'completed';

    const checkBackgroundProgress = async () => {
      if (isCurrentlyPolling) return;
      isCurrentlyPolling = true;
      try {
        const { data } = await axios.get(
          `${API_BASE_URL}/api/emails/sync-progress?accountId=${effectiveAccountId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (data?.success) {
          setSyncStats({ total: data.totalCandidates || 0, processed: data.processedCandidates || 0 });
        }

        if (data?.success && data.progressStage) {
          const isFinished =
            ['completed', 'error', 'idle'].includes(data.progressStage) ||
            data.syncState === 'error';
          const stalled = !isFinished && data.isStalled === true;

          setSyncStalled(stalled);

          if (!isFinished && !stalled) {
            // If a background sync is happening, fetch latest inbox items silently
            setIsSyncing(true);
            await fetchInsights(true);
          } else {
            if (!['completed', 'error', 'idle'].includes(lastStage)) {
              // Final fetch to reflect completed state
              await fetchInsights(true);
            }
            setIsSyncing(false);
            // Removed clearInterval so we keep polling for future syncs triggered externally
          }
          lastStage = data.progressStage;
        }
      } catch (err) {
        console.warn('[Dashboard] Background progress poll failed', err);
      } finally {
        isCurrentlyPolling = false;
      }
    };

    checkBackgroundProgress(); // Check immediately on mount
    const pollInterval = setInterval(checkBackgroundProgress, 4000);

    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, effectiveAccountId]);

  const allItems = [...focusItems, ...actionItems, ...agendaItems];

  const now = new Date();
  const topBarDate = `${now.toLocaleDateString('en-US', { weekday: 'short' })} ${now.getDate()} ${now.toLocaleDateString('en-US', { month: 'short' })} ${now.getFullYear()}`.toUpperCase();

  /* ── Board-card helpers ── */
  const getSubject = (item: PriorityRankingItem) =>
    item.emailContextById?.[item.gmailThreadId]?.subject || item.summary.shortSnippet || 'No subject';
  const getInitials = (item: PriorityRankingItem) =>
    (item.from.name || item.from.email || '?')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  const getDomain = (item: PriorityRankingItem) =>
    item.from.domain || item.from.email.split('@')[1] || '';
  const getNearestDeadline = (item: PriorityRankingItem) =>
    item.dates
      ?.filter((d) => d.type === 'deadline')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
  const getDueChip = (item: PriorityRankingItem): { label: string; cls: string } | null => {
    const nearest = getNearestDeadline(item);
    if (!nearest) return null;
    const due = new Date(nearest.date);
    const diff = due.getTime() - Date.now();
    if (diff < 0) {
      const days = Math.floor(-diff / 864e5);
      return { label: days >= 1 ? `OVERDUE ${days}D` : 'OVERDUE', cls: 'tr' };
    }
    const hours = Math.floor(diff / 36e5);
    if (hours < 24) return { label: `DUE IN ${Math.max(hours, 1)}H`, cls: 'ta' };
    return {
      label: `DUE ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()}`,
      cls: 'tb',
    };
  };
  const isItemTracked = (insightId: string) =>
    trackedItems.some((ti) => ti.insightId === insightId);

  const refreshTracked = async () => {
    const token = localStorage.getItem('firebaseToken');
    if (!token) return;
    try {
      const trackedRes = await axios.get(
        `${API_BASE_URL}/api/emails/tracked/all`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (trackedRes.data.success) {
        setTrackedItems(trackedRes.data.tracked || []);
      }
    } catch {
      // non-blocking
    }
  };

  const toggleTrack = async (insightId: string, currentlyTracked: boolean, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const token = localStorage.getItem('firebaseToken');
    if (!token || !insightId) return;

    // Optimistic update
    const prevTracked = trackedItems;
    if (currentlyTracked) {
      setTrackedItems(prevTracked.filter((ti) => ti.insightId !== insightId));
    } else {
      const item = allItems.find((i) => i.insightId === insightId);
      setTrackedItems([
        {
          insightId,
          accountId: effectiveAccountId,
          gmailThreadId: item?.gmailThreadId,
          from: item?.from,
          summary: item?.summary,
          matchedLabels: item?.matchedLabels || [],
          trackingNote: null,
          trackedAt: Date.now(),
        },
        ...prevTracked,
      ]);
    }

    try {
      const res = await axios.put(
        `${API_BASE_URL}/api/emails/insights/${insightId}/track`,
        { isTracked: !currentlyTracked },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.data?.success) throw new Error(res.data?.message || 'Tracking update failed');
      await refreshTracked();
      showToast(currentlyTracked ? 'Removed from Tracked.' : 'Added to Tracked.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setTrackedItems(prevTracked);
      setNotification({
        show: true,
        type: 'error',
        message: 'Tracking failed',
        detail: err?.response?.data?.message || err?.message || 'Could not update tracking.',
      });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  const saveTrackingNote = async (insightId: string, note: string) => {
    const token = localStorage.getItem('firebaseToken');
    if (!token || !insightId) return;
    const trimmed = note.trim();

    const prevTracked = trackedItems;
    setTrackedItems(prevTracked.map((ti) =>
      ti.insightId === insightId ? { ...ti, trackingNote: trimmed || null } : ti
    ));

    try {
      const res = await axios.put(
        `${API_BASE_URL}/api/emails/insights/${insightId}/track`,
        { trackingNote: trimmed || null },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.data?.success) throw new Error(res.data?.message || 'Note update failed');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setTrackedItems(prevTracked);
      setNotification({
        show: true,
        type: 'error',
        message: 'Note not saved',
        detail: err?.response?.data?.message || err?.message || 'Could not save the tracking note.',
      });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  const handleSaveNote = (insightId: string, note: string) => {
    void saveTrackingNote(insightId, note);
  };
  const getLinkCount = (item: PriorityRankingItem) =>
    Object.values(item.importantLinksByEmail || {}).reduce(
      (n, links) => n + (Array.isArray(links) ? links.length : 0), 0
    );
  const getChecklistCount = (item: PriorityRankingItem) =>
    Array.isArray(item.checklistItems) ? item.checklistItems.length : 0;
  const getActionTier = (item: PriorityRankingItem) => {
    if (isItemTracked(item.insightId)) return 'tier-accent';
    const nearest = getNearestDeadline(item);
    if (nearest && new Date(nearest.date).getTime() < Date.now()) return 'tier-red';
    return 'tier-amber';
  };
  const FOCUS_AV_TINTS = ['kav-green', 'kav-purple', 'kav-blue', 'kav-amber'];
  const filteredItems = selectedLabel
    ? allItems.filter(item => item.matchedLabels.includes(selectedLabel))
    : agendaItems;

  /* All Items — quick filters, date range, and sort (all client-side) */
  const toggleAgendaFilter = (f: 'action' | 'deadline') => {
    setAgendaFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  };
  const signalTime = (item: PriorityRankingItem) =>
    item.timestamps.lastSignalAt ? new Date(item.timestamps.lastSignalAt).getTime() : 0;
  let displayedItems = [...filteredItems];
  if (agendaFilters.has('action')) {
    displayedItems = displayedItems.filter((i) => i.isActionRequired);
  }
  if (agendaFilters.has('deadline')) {
    displayedItems = displayedItems.filter(
      (i) => Array.isArray(i.dates) && i.dates.some((d) => d.type === 'deadline')
    );
  }
  if (agendaRange !== 'all') {
    const cutoff = agendaRange === 'today'
      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : agendaRange === 'week'
        ? Date.now() - 7 * 864e5
        : Date.now() - 30 * 864e5;
    displayedItems = displayedItems.filter((i) => signalTime(i) >= cutoff);
  }
  if (agendaSort === 'newest') {
    displayedItems.sort((a, b) => signalTime(b) - signalTime(a));
  } else if (agendaSort === 'sender') {
    displayedItems.sort((a, b) =>
      (a.from.name || a.from.email).localeCompare(b.from.name || b.from.email)
    );
  }

  const selectedLabelKey = selectedLabel ? normalizeLabelKey(selectedLabel) : null;
  const filteredLowPriorityItems = selectedLabelKey
    ? lowPriorityItems.filter((item) =>
      Array.isArray(item.extractedFeatures)
      && item.extractedFeatures.some((feature) => normalizeLabelKey(feature) === selectedLabelKey)
    )
    : lowPriorityItems;
  const agendaLabelColorMap = React.useMemo(
    () => new Map(sidebarLabels.map((label) => [normalizeLabelKey(label.name), label.color])),
    [sidebarLabels]
  );
  const getAgendaLabelStyle = (labelName: string): React.CSSProperties => {
    const labelColor = agendaLabelColorMap.get(normalizeLabelKey(labelName));
    if (!labelColor) {
      return {};
    }
    if (labelColor.startsWith('#')) {
      return {
        color: labelColor,
        borderColor: hexToRgba(labelColor, 0.45) || labelColor,
        background: hexToRgba(labelColor, 0.12) || 'var(--surface-2)',
      };
    }
    return {
      color: labelColor,
      borderColor: labelColor,
      background: 'var(--surface-2)',
    };
  };

  let selectedEmail = allItems.find((item) => item.insightId === selectedInsightId) || null;
  const selectedLowPriorityItem = lowPriorityItems.find((item) => item.messageId === selectedLowPriorityMessageId) || null;

  if (!selectedEmail && selectedLowPriorityItem) {
    selectedEmail = {
      insightId: '', // null insight
      messageId: selectedLowPriorityItem.messageId,
      gmailThreadId: selectedLowPriorityItem.threadId,
      summary: {
        shortSnippet: selectedLowPriorityItem.subject || 'No summary available (filtered)',
        intent: 'noise',
      },
      from: {
        email: selectedLowPriorityItem.from,
      },
      matchedLabels: ['Low Priority'],
      isActionRequired: false,
      isCompleted: false,
      score: {
        baseScore: selectedLowPriorityItem.score,
        dynamicScore: 0,
        totalScore: selectedLowPriorityItem.score,
        importanceNorm: 0,
        labelNorm: 0,
        recencyNorm: 0,
        deadlineBoost: 0,
        matchedLabelRank: 99,
      },
      timestamps: {
        createdAt: new Date(selectedLowPriorityItem.internalDate || Date.now()),
        updatedAt: new Date(selectedLowPriorityItem.internalDate || Date.now()),
      },
      dates: [],
      attachments: [],
      checklistItems: [],
      importantLinksByEmail: {}
    };
  }
  const selectedDomain = selectedEmail
    ? (selectedEmail.from.domain || selectedEmail.from.email.split('@')[1] || '')
    : '';
  const selectedDateLabel = selectedEmail?.timestamps.lastSignalAt
    ? new Date(selectedEmail.timestamps.lastSignalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Recently';
  const summaryText = selectedEmail?.summary.shortSnippet || selectedEmail?.summary.intent || 'No summary available.';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedDates = normalizeDates((selectedEmail as any)?.dates);
  const selectedAttachments = Array.isArray(selectedEmail?.attachments) ? selectedEmail!.attachments : [];
  const selectedChecklist = Array.isArray(selectedEmail?.checklist) ? selectedEmail!.checklist : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedChecklistItems = Array.isArray((selectedEmail as any)?.checklistItems)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? ((selectedEmail as any).checklistItems as Array<any>)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => ({
        task: typeof item?.task === 'string' ? item.task.trim() : '',
        status: 'pending' as const,
        dueDate: normalizeDateValue(item?.dueDate),
        reason: typeof item?.reason === 'string' ? item.reason : undefined,
        inferred: item?.inferred === true,
        sourceEmailId: typeof item?.sourceEmailId === 'string' ? item.sourceEmailId : undefined,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((item: any) => item.task.length > 0)
    : selectedChecklist.map((task) => ({
      task,
      status: 'pending' as const,
      dueDate: null,
      reason: undefined,
      inferred: false,
      sourceEmailId: undefined,
    }));
  const selectedImportantLinksByEmail = (selectedEmail?.importantLinksByEmail && typeof selectedEmail.importantLinksByEmail === 'object')
    ? selectedEmail.importantLinksByEmail
    : {};
  const selectedLinkGroups = Object.entries(selectedImportantLinksByEmail)
    .map(([sourceId, links]) => {
      const seen = new Set<string>();
      const normalizedLinks = (Array.isArray(links) ? links : [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((link: any) => ({
          url: typeof link?.url === 'string' ? link.url.trim() : '',
          label: typeof link?.label === 'string' ? link.label : undefined,
          reason: typeof link?.reason === 'string' ? link.reason : undefined,
          inferred: link?.inferred === true,
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((link: any) => {
          if (!link.url) return false;
          if (seen.has(link.url)) return false;
          seen.add(link.url);
          return true;
        });
      return { sourceId, links: normalizedLinks };
    })
    .filter((group) => group.links.length > 0);

  const attachmentsByEmail = selectedAttachments.reduce((acc, att) => {
    const key = att.sourceEmailId || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(att);
    return acc;
  }, {} as Record<string, typeof selectedAttachments>);

  const selectEmail = (item: PriorityRankingItem) => {
    setSelectedInsightId(item.insightId);
    setSelectedLowPriorityMessageId(null);
    setSelectedSourceMessageId(null);
    setRightCol(true);
  };

  const selectLowPriorityEmail = (item: LowPriorityEmailItem) => {
    setSelectedInsightId(null);
    setSelectedLowPriorityMessageId(item.messageId);
    setSelectedSourceMessageId(null);
    setRightCol(true);
  };

  const handleGmailClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const threadId = selectedEmail?.gmailThreadId?.trim();
    const messageId = selectedEmail?.messageId?.trim();

    if (!threadId && !messageId) {
      e.preventDefault();
      console.warn('[Gmail Open] Missing gmailThreadId and messageId', { selectedEmail });
      setNotification({
        show: true,
        type: 'error',
        message: 'Cannot open in Gmail',
        detail: 'Thread ID not available. Please try selecting the email again.',
      });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Inline component rendered per-email to show thumbs feedback.
  // Visible on hover in list rows, always visible in detail panel.
  const FeedbackButtons = ({ insightId, messageId, alwaysVisible = false }: { insightId?: string, messageId?: string, alwaysVisible?: boolean }) => {
    const targetId = insightId || messageId || '';
    const fb = feedbackMap[targetId] ?? null;
    return (
      <div
        className={alwaysVisible ? 'feedback-row visible' : 'feedback-row'}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: alwaysVisible ? '12px' : '0' }}
      >
        <button
          title="Mark as relevant"
          onClick={(e) => { e.stopPropagation(); void sendFeedback(targetId, 'boost', insightId ? 'insight' : 'message'); }}
          style={{
            background: fb === 'boost' ? 'var(--accent-lt)' : 'none',
            border: `1px solid ${fb === 'boost' ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: '5px',
            padding: '5px 9px',
            cursor: 'pointer',
            color: fb === 'boost' ? 'var(--accent)' : 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            transition: 'border-color 0.15s, color 0.15s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill={fb === 'boost' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
          Relevant
        </button>
        <button
          title="Mark as not relevant"
          onClick={(e) => { e.stopPropagation(); void sendFeedback(targetId, 'suppress', insightId ? 'insight' : 'message'); }}
          style={{
            background: fb === 'suppress' ? 'var(--red-bg)' : 'none',
            border: `1px solid ${fb === 'suppress' ? 'var(--red, #c0351a)' : 'var(--border)'}`,
            borderRadius: '5px',
            padding: '5px 9px',
            cursor: 'pointer',
            color: fb === 'suppress' ? 'var(--red, #c0351a)' : 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            transition: 'border-color 0.15s, color 0.15s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill={fb === 'suppress' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
            <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
          </svg>
          Not relevant
        </button>
      </div>
    );
  };

  const handleSync = async () => {
    if (!effectiveAccountId) return;

    const API_URL = API_BASE_URL;
    const token = localStorage.getItem('firebaseToken');

    setIsSyncing(true);
    setSyncStalled(false);
    setNotification(null);
    manualSyncCountsRef.current = null;

    try {
      // Step 1: Kick off the sync. The backend responds immediately after
      // fetching new email candidates — AI workers run asynchronously after.
      const response = await axios.post(
        `${API_URL}/api/emails/sync`,
        { accountId: effectiveAccountId },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.data.success) {
        setNotification({
          show: true,
          type: 'error',
          message: 'Sync failed',
          detail: response.data.message,
        });
        setIsSyncing(false);
        setTimeout(() => setNotification(null), 5000);
        return;
      }

      // Stash counts from the fetch stage to surface them on AI completion
      manualSyncCountsRef.current = {
        processed: response.data.processed ?? 0,
        succeeded: response.data.succeeded ?? 0,
        failed: response.data.failed ?? 0,
      };

      // Step 2: Poll sync-progress until the backend reports 'completed'.
      // This ensures the button stays in syncing state until AI processing is done.
      const MAX_WAIT_MS = 5 * 60 * 1000; // 5-minute safety cap
      const POLL_INTERVAL_MS = 2000;
      const startedAt = Date.now();
      let finalStage = 'completed';

      await new Promise<void>((resolve) => {
        const poll = async () => {
          try {
            const { data } = await axios.get(
              `${API_URL}/api/emails/sync-progress?accountId=${effectiveAccountId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );

            if (data?.success) {
              setSyncStats({ total: data.totalCandidates || 0, processed: data.processedCandidates || 0 });
            }

            const stage = data?.progressStage;

            if (stage === 'completed' || stage === 'error' || stage === 'idle') {
              finalStage = stage;
              resolve();
              return;
            }

            if (Date.now() - startedAt > MAX_WAIT_MS) {
              console.warn('[Sync] Poller timed out waiting for AI completion.');
              finalStage = 'error';
              resolve();
              return;
            }
          } catch (pollErr) {
            console.warn('[Sync] Progress poll error (non-blocking):', pollErr);
          }

          setTimeout(poll, POLL_INTERVAL_MS);
        };

        // Start first poll immediately
        void poll();
      });

      // Step 3: AI processing is done — refresh insights silently, then notify.
      await fetchInsights(true);

      const counts = manualSyncCountsRef.current;
      try {
        const { data: progress } = await axios.get(
          `${API_URL}/api/emails/sync-progress?accountId=${effectiveAccountId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (progress?.success) {
          setSyncStats({ total: progress.totalCandidates || 0, processed: progress.processedCandidates || 0 });
        }
      } catch {
        // non-blocking
      }

      if (finalStage !== 'error') {
        const detailStr = counts
            ? `Processed: ${counts.processed} | Success: ${counts.succeeded} | Failed: ${counts.failed}`
            : 'Inbox is up to date.';
            
        setNotification({
          show: true,
          type: 'success',
          message: 'Sync completed',
          detail: detailStr,
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error('[Sync] Error:', err);
      const detailStr = err.response?.data?.message || 'An error occurred during sync';
      
      setNotification({
        show: true,
        type: 'error',
        message: 'Sync error',
        detail: detailStr,
      });
    } finally {
      setIsSyncing(false);
      manualSyncCountsRef.current = null;
      setTimeout(() => setNotification(null), 5000);
    }
  };

  const toggleSidebar = () => setSidebarCol(!sidebarCol);
  const selectedSourceContext = selectedEmail && selectedSourceMessageId
    ? selectedEmail.emailContextById?.[selectedSourceMessageId]
    : null;

  return (
    <>

      {/* NOTIFICATION */}
      {notification && notification.show && (
        <div className="sync-notification" style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: notification.type === 'error' ? 'var(--red)' : notification.type === 'warning' ? 'var(--amber)' : notification.type === 'success' ? 'var(--green)' : 'var(--accent)',
          color: '#fff',
          padding: '16px 20px',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          zIndex: 1000,
          display: 'flex',
          gap: '12px',
          minWidth: '320px',
          fontFamily: 'var(--font-sans)'
        }}>
          <div style={{ paddingTop: '2px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <Logo size={20} />
            {notification.type === 'error' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            )}
            {notification.type === 'warning' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            )}
            {notification.type === 'success' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            )}
            {notification.type === 'info' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <strong style={{ fontSize: '15px', fontWeight: 600 }}>{notification.message}</strong>
              <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, opacity: 0.7, marginTop: '2px' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3L11 11M11 3L3 11" /></svg>
              </button>
            </div>
            {notification.detail && <span style={{ fontSize: '13px', opacity: 0.9, lineHeight: 1.4 }}>{notification.detail}</span>}
          </div>
        </div>
      )}

      {/* SHELL */}
      <div className="shell-dash" style={{ gridTemplateColumns: `${sidebarCol ? '44px' : '180px'} ${calendarCol ? '1fr' : '0px'} ${calendarCol ? '0px' : '1fr'} ${rightCol ? 'min(660px, 45vw)' : '0px'}` }}>

        {/* BAR */}
        <div className="bar">
          <div className="bar-logo">
            <Logo size={18} />
            <span className="bar-title">Emty</span>
          </div>
          <span className="bar-date">{topBarDate}</span>
          <div className="bar-r">
            {syncStats && syncStats.total > 0 && (
              <div className="ai-queue">
                <span className="ai-queue-lbl">AI Queue</span>
                <span className="ai-queue-val">{syncStats.processed} / {syncStats.total}</span>
              </div>
            )}
            {/* Theme Toggle within header */}
            <div className="btn-group">
              <button className={`tgl-btn ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>Light</button>
              <button className={`tgl-btn ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
            </div>
            {/* Account switcher stack */}
            <div className="bar-acct-stack">
              {accounts.length > 0 ? (
                accounts.map((acc) => (
                  <button
                    key={acc.id}
                    className={`bar-acct-av ${acc.id === effectiveAccountId ? 'on' : 'inactive'}`}
                    onClick={() => switchAccount(acc.id)}
                    title={acc.emailAddress}
                  >
                    {acc.emailAddress.charAt(0).toUpperCase()}
                  </button>
                ))
              ) : (
                <span className="bar-acct-av" title={user?.email || ''}>{user?.email ? user.email.charAt(0).toUpperCase() : 'U'}</span>
              )}
              <button className="bar-acct-add" onClick={handleAddAccount} title="Add Gmail account">+</button>
            </div>
            <button
              className={`sync-pill ${isSyncing ? 'syncing' : ''} ${syncStalled ? 'stalled' : ''}`}
              onClick={handleSync}
              disabled={isSyncing}
              aria-label={syncStalled ? 'Sync stalled — retry now' : isSyncing ? 'Syncing inbox, please wait' : 'Sync inbox now'}
              title={syncStalled ? 'The last sync stopped making progress (network drop?). Click to retry.' : undefined}
            >
              <svg
                className={isSyncing ? 'spin' : ''}
                width="11" height="11" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {syncStalled ? 'Sync stalled — Retry' : isSyncing ? 'Syncing' : 'Sync'}
            </button>
            <div className="bar-av" onClick={() => onNavigate('profile')}>{user?.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
          </div>
        </div>

        {/* SIDEBAR */}
        <div className={`sidebar ${sidebarCol ? 'col' : ''}`} id="sb">
          <button className="sb-tog" onClick={toggleSidebar}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M7 2L4 5.5L7 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="sb-col-strip">
            <div className="scs-dot on"></div><div className="scs-dot"></div>
            <div className="scs-dot"></div><div className="scs-dot"></div>
          </div>
          <div className="sb-inner">
            <div className="sb-grp" style={{ paddingTop: '12px' }}>
              <span className="sb-grp-lbl">Views</span>
              <div className={`sb-row ${calendarCol ? 'on' : ''}`} onClick={() => setCalendarCol(!calendarCol)}>
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                <span className="sb-txt">Calendar</span>
              </div>
              <div className={`sb-row ${activeSection === 'do' ? 'on' : ''}`} onClick={() => { setActiveSection('do'); setIsActionOpen(true); mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z" fill="currentColor" /></svg></div>
                <span className="sb-txt">Do</span><span className="sb-ct a">{actionItems.length}</span>
              </div>
              <div className={`sb-row ${activeSection === 'all' ? 'on' : ''}`} onClick={() => { setActiveSection('all'); setIsAllItemsOpen(true); setTimeout(() => allItemsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }}>
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg></div>
                <span className="sb-txt">All Items</span><span className="sb-ct">{loading ? '' : filteredItems.length}</span>
              </div>
              <div className={`sb-row ${activeSection === 'tracked' ? 'on' : ''}`} onClick={() => { setActiveSection('tracked'); mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg></div>
                <span className="sb-txt">Tracked</span><span className="sb-ct">{visibleTracked.length}</span>
              </div>
              <div className={`sb-row ${activeSection === 'done' ? 'on' : ''}`} onClick={() => { setActiveSection('done'); setIsDoneOpen(true); setTimeout(() => doneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }}>
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>
                <span className="sb-txt">Done</span><span className="sb-ct g">{completedItems.length}</span>
              </div>

              <div className={`sb-row ${activeSection === 'ignore' ? 'on' : ''}`} onClick={() => { setActiveSection('ignore'); setIsLowPriorityOpen(true); setTimeout(() => lowPriorityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }}>
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M19 5L5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></div>
                <span className="sb-txt">Ignore</span><span className="sb-ct g">{lowPriorityItems.length}</span>
              </div>

              <div className="sb-row" onClick={() => onNavigate('metrics')}>
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 11l3-3 3 3 4-4 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
                <span className="sb-txt">Metrics</span>
              </div>
            </div>

            <hr className="sb-div" />

            <div className="sb-grp">
              <span className="sb-grp-lbl">Labels</span>
              {sidebarLabels.length === 0 && !loading && (
                <div className="lrow" style={{ color: 'var(--text-3)', fontSize: '11px', paddingLeft: '24px' }}>No custom labels</div>
              )}
              {sidebarLabels.map((lbl) => (
                <div
                  className={`lrow ${selectedLabel === lbl.name ? 'on' : ''}`}
                  key={lbl.id}
                  onClick={() => setSelectedLabel(selectedLabel === lbl.name ? null : lbl.name)}
                >
                  <div className="ldot" style={{ background: lbl.color }}></div>
                  <span className="lname">{lbl.name}</span>
                  {lbl.count > 0 && <span className="lct">{lbl.count}</span>}
                </div>
              ))}
              <div className="lrow" style={{ paddingTop: '8px' }} onClick={() => onNavigate('onboarding')}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', cursor: 'pointer' }}>+ edit labels</span>
              </div>
            </div>

            <hr className="sb-div" />

            <div className="sb-grp">
              <span className="sb-grp-lbl">Accounts</span>
              {(accounts.length > 0
                ? accounts
                : (user?.email ? [{ id: user.gmailAccountId || 'primary', emailAddress: user.email }] : [])
              ).map((acc) => (
                <div
                  key={acc.id}
                  className={`sb-row ${acc.id === effectiveAccountId ? 'on' : ''}`}
                  onClick={() => switchAccount(acc.id)}
                  title={acc.emailAddress}
                >
                  <div className="sb-ico"><div style={{ width: '13px', height: '13px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', fontWeight: 700, color: 'var(--accent-inv)', fontFamily: 'var(--font-mono)', borderRadius: '2px' }}>G</div></div>
                  <span className="sb-txt" style={{ fontSize: '10.5px' }}>{acc.emailAddress}</span>
                </div>
              ))}
              <div className="sb-row" onClick={handleAddAccount} title="Connect another Gmail account">
                <div className="sb-ico">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </div>
                <span className="sb-txt" style={{ fontSize: '10.5px', color: 'var(--text-3)' }}>Add account</span>
              </div>
            </div>

            <div className="sb-foot" onClick={() => onNavigate('profile')}>
              <div className="foot-av">{user?.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
              <div style={{ minWidth: 0 }}><div className="foot-name">{user?.name || 'User Name'}</div><div className="foot-email">{user?.email || 'user@example.com'}</div></div>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}><circle cx="5" cy="2" r="1" fill="var(--text-3)" /><circle cx="5" cy="5" r="1" fill="var(--text-3)" /><circle cx="5" cy="8" r="1" fill="var(--text-3)" /></svg>
            </div>
          </div>
        </div>

        {/* CALENDAR SIDEBAR */}
        <CalendarSidebar
          isOpen={calendarCol}
          items={allItems}
          onSelectEmail={selectEmail}
          onClose={() => setCalendarCol(false)}
        />

        {/* MAIN */}
        <div className="main" ref={mainRef}>
          {/* Toast notification */}
          {toast && (
            <div className="done-toast">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              {toast}
            </div>
          )}
          {error && (
            <div style={{ padding: '12px 20px', background: 'var(--red)', color: '#fff', fontSize: '13px', borderRadius: '6px', marginBottom: '20px' }}>
              {error}
            </div>
          )}

          {activeSection === 'tracked' ? (
            /* ── TRACKED — dedicated view (follows the active account) ── */
            <div className="board tracked">
              <div className="board-hd" style={{ cursor: 'default' }}>
                <span className="board-dot"></span>
                <span className="board-name">Tracked</span>
                <span className="board-desc">threads you are monitoring{accounts.length > 1 ? ` — ${activeAccountEmail}` : ''}</span>
                <span className="board-badge">{visibleTracked.length} threads</span>
              </div>
              <div className="track">
                {visibleTracked.length === 0 && (
                  <div className="track-empty">
                    No tracked threads for this account yet — click the bookmark icon on any email to pin it here.
                  </div>
                )}
                {visibleTracked.map((ti, idx) => (
                  <div
                    key={ti.insightId + idx}
                    className={`kard fk tier-accent ${selectedInsightId === ti.insightId ? 'sel' : ''}`}
                    onClick={() => {
                      setSelectedInsightId(ti.insightId);
                      setSelectedLowPriorityMessageId(null);
                      setSelectedSourceMessageId(null);
                      setRightCol(true);
                    }}
                  >
                    <div className="kav kav-accent">
                      {(ti.from?.name || ti.from?.email || '?')
                        .split(' ')
                        .map((w: string) => w[0])
                        .join('')
                        .substring(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="fk-body">
                      <div className="ksub">{ti.summary?.shortSnippet || 'Tracked thread'}</div>
                      <div className="kd">
                        {ti.from?.name || (ti.from?.email ? ti.from.email.split('@')[0] : 'Unknown')}
                      </div>
                      <TrackNoteEditor
                        insightId={ti.insightId}
                        note={ti.trackingNote ?? null}
                        onSave={handleSaveNote}
                        viewClass="kard-note kard-note--btn"
                        editClass="kard-note kard-note--editing"
                        emptyClass="kard-note--empty"
                      />
                      <div className="kard-tags">
                        <span className="tag t-accent">TRACKED</span>
                        {ti.matchedLabels?.slice(0, 1).map((lbl: string) => (
                          <span className="tag tn" key={lbl}>{lbl}</span>
                        ))}
                        <span className="kt">
                          {ti.trackedAt ? new Date(ti.trackedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                        </span>
                      </div>
                    </div>
                    <button
                      className="kard-bm-btn on"
                      onClick={(e) => toggleTrack(ti.insightId, true, e)}
                      title="Untrack"
                      aria-label="Untrack"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <>
          {/* BOARDS */}
          <div className="boards">
            {/* ACTION BOARD */}
            <div className="board action">
              <div className="board-hd" onClick={() => setIsActionOpen(!isActionOpen)}>
                <span className="board-dot"></span>
                <span className="board-name">Action Board</span>
                <span className="board-desc">requires your response</span>
                <span className="board-badge">{loading ? '...' : `${actionItems.length} urgent`}</span>
                <span className={`board-chev ${isActionOpen ? 'open' : ''}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              </div>
              {isActionOpen && (
                <div className="track">
                  {loading && [0, 1, 2].map(i => (
                    <div className="kard kard-skeleton" key={i}>
                      <div className="skel-line skel-line--sender" />
                      <div className="skel-line skel-line--snip" />
                      <div className="skel-line skel-line--snip skel-line--short" />
                      <div className="skel-tags"><div className="skel-tag" /><div className="skel-tag skel-tag--wide" /></div>
                    </div>
                  ))}
                  {!loading && actionItems.length === 0 && (
                    <div className="track-empty">No urgent actions required.</div>
                  )}
                  {!loading && actionItems.map((item) => {
                    const due = getDueChip(item);
                    const tracked = isItemTracked(item.insightId);
                    const linkCount = getLinkCount(item);
                    const checklistCount = getChecklistCount(item);
                    return (
                      <div
                        className={`kard ${getActionTier(item)} ${selectedInsightId === item.insightId ? 'sel' : ''}`}
                        key={item.insightId}
                        onClick={() => selectEmail(item)}
                      >
                        <div className="kard-top">
                          <div className="kav">{getInitials(item)}</div>
                          <div className="kard-id">
                            <div className="kf">{item.from.name || item.from.email.split('@')[0]}</div>
                            <div className="kd">{getDomain(item)}</div>
                          </div>
                          <button
                            className={`kard-bm-btn ${tracked ? 'on' : ''}`}
                            onClick={(e) => toggleTrack(item.insightId, tracked, e)}
                            title={tracked ? 'Untrack' : 'Track this thread'}
                            aria-label={tracked ? 'Untrack' : 'Track this thread'}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill={tracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                            </svg>
                          </button>
                          <button
                            className="kard-check-btn"
                            onClick={(e) => handleToggleCompletion(item.insightId, !!item.isCompleted, e)}
                            title="Mark as done"
                            aria-label="Mark as done"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="ksub">{getSubject(item)}</div>
                        <div className="ks">{item.summary.shortSnippet || 'Action required'}</div>
                        <div className="kard-tags">
                          {due && <span className={`tag ${due.cls}`}>{due.label}</span>}
                          {item.matchedLabels.slice(0, 1).map(lbl => (
                            <span className="tag tn" key={lbl}>{lbl}</span>
                          ))}
                          <span className="kard-tags-right">
                            {tracked && <span className="tag t-accent">TRACKED</span>}
                            {linkCount > 0 && (
                              <span className="kmeta">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                                {linkCount}
                              </span>
                            )}
                            {checklistCount > 0 && (
                              <span className="kmeta">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                                {checklistCount}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* FOCUS BOARD */}
            <div className="board focus">
              <div className="board-hd" onClick={() => setIsFocusOpen(!isFocusOpen)}>
                <span className="board-dot"></span>
                <span className="board-name">Focus Board</span>
                <span className="board-desc">pinned · most relevant today</span>
                <span className="board-badge">{loading ? '...' : `${focusItems.length} items`}</span>
                <span className={`board-chev ${isFocusOpen ? 'open' : ''}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              </div>
              {isFocusOpen && (
                <div className="track">
                  {loading && [0, 1].map(i => (
                    <div className="kard kard-skeleton" key={i}>
                      <div className="skel-line skel-line--sender" />
                      <div className="skel-line skel-line--snip" />
                      <div className="skel-tags"><div className="skel-tag" /><div className="skel-tag skel-tag--wide" /></div>
                    </div>
                  ))}
                  {!loading && focusItems.length === 0 && (
                    <div className="track-empty">
                      {syncStalled
                        ? 'Email processing stalled — click "Sync stalled — Retry" in the top bar to resume.'
                        : isSyncing
                          ? 'Evaluating emails in the background. Your most important emails will pop up here shortly...'
                          : 'Inbox zero. Great job!'}
                    </div>
                  )}
                  {!loading && focusItems.map((item, idx) => {
                    const due = getDueChip(item);
                    return (
                      <div
                        className={`kard fk ${selectedInsightId === item.insightId ? 'sel' : ''}`}
                        key={item.insightId}
                        onClick={() => selectEmail(item)}
                      >
                        <div className={`kav ${FOCUS_AV_TINTS[idx % FOCUS_AV_TINTS.length]}`}>{getInitials(item)}</div>
                        <div className="fk-body">
                          <div className="ksub">{getSubject(item)}</div>
                          <div className="kd">{item.from.name || item.from.email.split('@')[0]} · {item.summary.shortSnippet || 'No summary available'}</div>
                          <div className="kard-tags">
                            {item.matchedLabels.slice(0, 1).map(lbl => (
                              <span className="tag tn" key={lbl}>{lbl}</span>
                            ))}
                            {due && <span className={`tag ${due.cls}`}>{due.label}</span>}
                          </div>
                        </div>
                        <button
                          className={`kard-bm-btn ${isItemTracked(item.insightId) ? 'on' : ''}`}
                          onClick={(e) => toggleTrack(item.insightId, isItemTracked(item.insightId), e)}
                          title={isItemTracked(item.insightId) ? 'Untrack' : 'Track this thread'}
                          aria-label={isItemTracked(item.insightId) ? 'Untrack' : 'Track this thread'}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill={isItemTracked(item.insightId) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                        <button
                          className="kard-check-btn"
                          onClick={(e) => handleToggleCompletion(item.insightId, !!item.isCompleted, e)}
                          title="Mark as done"
                          aria-label="Mark as done"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* AGENDA — collapsible All Items with filter toolbar */}
          <div className="all-items-wrap" ref={allItemsRef}>
            <button
              className="agenda-head agenda-head--btn"
              type="button"
              onClick={() => setIsAllItemsOpen((prev) => !prev)}
            >
              <span className="agenda-ttl">{selectedLabel ? `Label: ${selectedLabel}` : 'All Items'}</span>
              <span className="agenda-meta">{selectedLabel ? 'matching emails' : 'sorted by priority'}</span>
              <span className="agenda-meta-num">{loading ? '...' : displayedItems.length}</span>
              <span className={`done-head-toggle ${isAllItemsOpen ? 'open' : ''}`}>
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>

            {isAllItemsOpen && (
              <>
                <div className="agenda-toolbar">
                  <button
                    className={`af-chip ${agendaFilters.has('action') ? 'on' : ''}`}
                    onClick={() => toggleAgendaFilter('action')}
                  >Action required</button>
                  <button
                    className={`af-chip ${agendaFilters.has('deadline') ? 'on' : ''}`}
                    onClick={() => toggleAgendaFilter('deadline')}
                  >Has deadline</button>
                  {selectedLabel && (
                    <button
                      className="af-chip on"
                      onClick={() => setSelectedLabel(null)}
                      title="Clear label filter"
                    >{selectedLabel} ✕</button>
                  )}
                  <span className="af-spacer" />
                  <label className="af-select-wrap">
                    <span className="af-select-lbl">Sort</span>
                    <select
                      className="af-select"
                      value={agendaSort}
                      onChange={(e) => setAgendaSort(e.target.value as 'priority' | 'newest' | 'sender')}
                    >
                      <option value="priority">Priority</option>
                      <option value="newest">Newest</option>
                      <option value="sender">Sender A–Z</option>
                    </select>
                  </label>
                  <label className="af-select-wrap">
                    <span className="af-select-lbl">Range</span>
                    <select
                      className="af-select"
                      value={agendaRange}
                      onChange={(e) => setAgendaRange(e.target.value as 'all' | 'today' | 'week' | 'month')}
                    >
                      <option value="all">All time</option>
                      <option value="today">Today</option>
                      <option value="week">This week</option>
                      <option value="month">This month</option>
                    </select>
                  </label>
                </div>

          <div className="agenda-rows">
            {loading && <div className="track-empty">Loading agenda...</div>}

            {!loading && displayedItems.length === 0 && (
              <div className="empty-fallback">
                {selectedLabel ? 'No emails found for this label.' : 'No emails match the current filters.'}
              </div>
            )}

            {!loading && displayedItems.map((item) => (
              <div
                className={`arow ${selectedInsightId === item.insightId ? 'sel' : ''}`}
                key={item.insightId}
                onClick={() => selectEmail(item)}
              >
                <button
                  className="ar-check-btn"
                  onClick={(e) => handleToggleCompletion(item.insightId, !!item.isCompleted, e)}
                  title="Mark as done"
                  aria-label="Mark as done"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <span className="ar-time">
                  {item.timestamps.lastSignalAt ? new Date(item.timestamps.lastSignalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently'}
                </span>
                <span className="ar-snip">{getSubject(item)}</span>
                <span className="ar-from">{item.from.name || item.from.email.split('@')[0]}</span>
                <button
                  className={`ar-bm-btn ${isItemTracked(item.insightId) ? 'on' : ''}`}
                  onClick={(e) => toggleTrack(item.insightId, isItemTracked(item.insightId), e)}
                  title={isItemTracked(item.insightId) ? 'Untrack' : 'Track this thread'}
                  aria-label={isItemTracked(item.insightId) ? 'Untrack' : 'Track this thread'}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill={isItemTracked(item.insightId) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <span className="ar-tags">
                  {item.matchedLabels.slice(0, 1).map((lbl) => (
                    <span className="ar-label-chip" key={lbl} style={getAgendaLabelStyle(lbl)}>{lbl}</span>
                  ))}
                </span>
              </div>
            ))}
          </div>
              </>
            )}
          </div>

            {/* DONE SECTION */}
            {!loading && (
              <div className="done-wrap" ref={doneRef}>
                <button
                  className="done-head"
                  type="button"
                  onClick={() => setIsDoneOpen((prev) => !prev)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span className="done-head-title">Done</span>
                  <span className="done-head-count">{completedItems.length}</span>
                  <span className={`done-head-toggle ${isDoneOpen ? 'open' : ''}`}>
                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
                {isDoneOpen && (
                  <div className="done-list">
                    {completedItems.length === 0 && (
                      <div className="done-empty">No completed items yet.</div>
                    )}
                    {completedItems.map((item) => (
                      <div
                        className={`arow done-row ${selectedInsightId === item.insightId ? 'sel' : ''}`}
                        key={item.insightId}
                        onClick={() => selectEmail(item)}
                      >
                        <button
                          className="ar-check-btn ar-check-btn--done"
                          onClick={(e) => handleToggleCompletion(item.insightId, true, e)}
                          title="Undo"
                          aria-label="Undo"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                        <span className="ar-time">
                          {item.timestamps.lastSignalAt ? new Date(item.timestamps.lastSignalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently'}
                        </span>
                        <span className="ar-snip struck">{getSubject(item)} — {item.from.name || item.from.email.split('@')[0]}</span>
                        <span className="ar-tags">
                          {item.matchedLabels.slice(0, 1).map((lbl) => (
                            <span className="ar-label-chip" key={lbl} style={getAgendaLabelStyle(lbl)}>{lbl}</span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}


            {!loading && (
              <div className="low-priority-wrap" ref={lowPriorityRef}>
                <button
                  className="low-priority-head"
                  type="button"
                  onClick={() => setIsLowPriorityOpen((prev) => !prev)}
                >
                  <span className="low-priority-title">
                    Low Priority Inbox
                  </span>
                  <span className="low-priority-desc">
                    filtered out - <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{filteredLowPriorityItems.length} emails</span>
                  </span>
                  <span className={`low-priority-toggle ${isLowPriorityOpen ? 'open' : ''}`}>
                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>

                {isLowPriorityOpen && (
                  <div className="low-priority-list">
                    {filteredLowPriorityItems.length === 0 && (
                      <div className="low-priority-empty">No low-priority emails for this filter.</div>
                    )}
                    {filteredLowPriorityItems.map((item) => (
                      <div className={`low-priority-row ${selectedLowPriorityMessageId === item.messageId ? 'sel' : ''}`} key={item.messageId} onClick={() => selectLowPriorityEmail(item)}>
                        <div className="low-priority-body">
                          <div className="low-priority-from">{parseSenderDisplay(item.from)}</div>
                          <div className="low-priority-subject">{item.subject || 'No subject'}</div>
                          <FeedbackButtons messageId={item.messageId} />
                        </div>
                        <div className="low-priority-time">
                          {item.internalDate
                            ? new Date(item.internalDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                            : 'Recently'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
          )}
        </div>

        {/* DETAIL */}
        <div className={`detail ${!rightCol ? 'col' : ''}`}>

          {/* ── HEADER ── */}
          <div className="det-top">
            <div className="det-top-row">
              <div className="det-from">
                {selectedEmail ? (selectedEmail.from.name || selectedEmail.from.email) : 'Select an email'}
              </div>
              {selectedEmail && selectedEmail.insightId && (
                <button
                  className={`det-bm-btn ${isItemTracked(selectedEmail.insightId) ? 'on' : ''}`}
                  onClick={(e) => toggleTrack(selectedEmail!.insightId, isItemTracked(selectedEmail!.insightId), e)}
                  title={isItemTracked(selectedEmail.insightId) ? 'Untrack' : 'Track this thread'}
                  aria-label={isItemTracked(selectedEmail.insightId) ? 'Untrack' : 'Track this thread'}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={isItemTracked(selectedEmail.insightId) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              )}
              <button
                className="det-close"
                onClick={() => setRightCol(false)}
                aria-label="Close detail panel"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2L10 10M10 2L2 10" />
                </svg>
              </button>
            </div>
            <div className="det-domain">{selectedEmail ? selectedDomain : 'No email selected'}</div>
            {selectedEmail && (
              <div className="det-meta-row">
                <div className="det-badge">
                  <div className="badge-sq"></div>
                  {selectedEmail.isActionRequired ? 'ACTION REQUIRED' : 'INFORMATION'}
                </div>
                {selectedEmail.matchedLabels.slice(0, 2).map(lbl => (
                  <span className="tag tn" key={lbl}>{lbl}</span>
                ))}
              </div>
            )}
            {selectedEmail && selectedEmail.insightId && isItemTracked(selectedEmail.insightId) && (
              <div className="det-note-row">
                <TrackNoteEditor
                  insightId={selectedEmail.insightId}
                  note={trackedItems.find((ti) => ti.insightId === selectedEmail!.insightId)?.trackingNote ?? null}
                  onSave={handleSaveNote}
                  viewClass="kard-note kard-note--btn"
                  editClass="kard-note kard-note--editing"
                  emptyClass="kard-note--empty"
                />
              </div>
            )}
          </div>


          {/* ── BODY ── */}
          <div className="det-body">

            {!selectedEmail && (
              <div className="det-empty-state">
                <div className="det-empty-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <polyline points="2,4 12,13 22,4" />
                  </svg>
                </div>
                <div className="det-empty-title">No email selected</div>
                <div className="det-empty-desc">Click any email in the list to view its details, action items, and important links here.</div>
              </div>
            )}

            {selectedEmail && (
              <>
                {/* Summary — always visible */}
                <div className="det-blk">
                  <span className="blk-lbl">Summary</span>
                  <div className="blk-txt">{summaryText}</div>
                </div>

                {/* Last Signal */}
                <div className="det-blk det-blk--inline">
                  <span className="blk-lbl">Last Signal</span>
                  <div className="blk-txt blk-txt--mono">{selectedDateLabel}</div>
                </div>

                {/* Action Checklist — only shown if items exist, else plain not-found */}
                {selectedChecklistItems.length > 0 ? (
                  <DetCollapsible
                    label="Action Checklist"
                    count={selectedChecklistItems.length}
                    defaultOpen={true}
                  >
                    <div className="task-list">
                      {selectedChecklistItems.map((item, idx) => {
                        const dueDateLabel = item.dueDate
                          ? new Date(item.dueDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                          : null;
                        const sourceTitle = item.sourceEmailId
                          ? (selectedEmail?.emailContextById?.[item.sourceEmailId]?.subject || item.sourceEmailId)
                          : null;
                        return (
                          <div className="task-item" key={`${item.task}-${idx}`}>
                            <div className="task-dot" />
                            <div className="task-content">
                              <div className="task-text">{item.task}</div>
                              <div className="task-meta">
                                {dueDateLabel && <span className="task-chip due">Due {dueDateLabel}</span>}
                                {item.inferred && <span className="task-chip inf">Inferred</span>}
                                {sourceTitle && (
                                  <span
                                    className="task-chip src"
                                    onClick={() => setSelectedSourceMessageId(item.sourceEmailId || null)}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    {sourceTitle}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DetCollapsible>
                ) : (
                  <div className="det-blk">
                    <span className="blk-lbl">Action Checklist</span>
                    <div className="det-not-found">No action items found for this thread.</div>
                  </div>
                )}

                {/* Dates & Deadlines — only shown if items exist */}
                {selectedDates.length > 0 ? (
                  <DetCollapsible
                    label="Dates & Deadlines"
                    count={selectedDates.length}
                    defaultOpen={true}
                  >
                    <div className="timeline">
                      <div className="tl-line"></div>
                      {selectedDates.map((item, idx) => (
                        <TimelineItem
                          key={`${item.type}-${item.date}-${idx}`}
                          item={item}
                          isFirst={idx === 0}
                          selectedEmail={selectedEmail}
                          onSourceClick={(id: string) => setSelectedSourceMessageId(id)}
                        />
                      ))}
                    </div>
                  </DetCollapsible>
                ) : (
                  <div className="det-blk">
                    <span className="blk-lbl">Dates &amp; Deadlines</span>
                    <div className="det-not-found">No dates or deadlines found.</div>
                  </div>
                )}

                {/* Important Links — only shown if items exist */}
                {selectedLinkGroups.length > 0 ? (
                  <DetCollapsible
                    label="Important Links"
                    count={selectedLinkGroups.reduce((n, g) => n + g.links.length, 0)}
                    defaultOpen={true}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {selectedLinkGroups.map(({ sourceId, links }) => {
                        const context = selectedEmail?.emailContextById?.[sourceId];
                        const sourceTitle = context?.subject || sourceId;
                        return (
                          <div className="link-group" key={sourceId}>
                            {sourceId !== 'unknown' && (
                              <div
                                className="link-group-title"
                                onClick={() => setSelectedSourceMessageId(sourceId)}
                                style={{ cursor: 'pointer' }}
                                title="Show source email context"
                              >
                                {sourceTitle}
                              </div>
                            )}
                            <div className="link-list">
                              {links.map((link, idx) => {
                                let host = '';
                                try { host = new URL(link.url).hostname; } catch { host = 'link'; }
                                return (
                                  <a
                                    className="link-item"
                                    key={`${sourceId}-${link.url}-${idx}`}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={link.url}
                                  >
                                    <div className="link-main">
                                      <div className="link-label">{link.label || host}</div>
                                      <div className="link-url">{link.url}</div>
                                    </div>
                                    <div className="link-meta">
                                      {link.reason && <span className="link-badge">{link.reason}</span>}
                                      {link.inferred && <span className="link-badge inf">inferred</span>}
                                    </div>
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DetCollapsible>
                ) : (
                  <div className="det-blk">
                    <span className="blk-lbl">Important Links</span>
                    <div className="det-not-found">No important links detected.</div>
                  </div>
                )}

                {/* Attachments — only shown if items exist */}
                {selectedAttachments.length > 0 ? (
                  <DetCollapsible
                    label="Attachments"
                    count={selectedAttachments.length}
                    defaultOpen={true}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {Object.entries(attachmentsByEmail).map(([sourceId, atts], groupIdx) => {
                        const emailContext = selectedEmail?.emailContextById?.[sourceId];
                        const emailTitle = emailContext?.subject || sourceId;
                        return (
                          <div key={sourceId || groupIdx} className="att-group">
                            {sourceId !== 'unknown' && (
                              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-1)', paddingBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: '1px solid var(--border-lt)' }}>
                                {emailTitle}
                              </div>
                            )}
                            <div className="attachments-grid">
                              {atts.map((attachment, idx) => {
                                const ext = attachment.filename.split('.').pop()?.toUpperCase() || 'FILE';
                                return (
                                  <div
                                    className="att-card"
                                    key={`${attachment.filename}-${idx}`}
                                    onClick={() => setSelectedSourceMessageId(attachment.sourceEmailId || null)}
                                  >
                                    <div className="att-icon">
                                      <svg viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="0.5" y="0.5" width="35" height="43" rx="4" fill="var(--surface-2)" stroke="var(--border)" />
                                        <rect x="4" y="30" width="28" height="3" rx="1.5" fill="var(--accent)" />
                                        <rect x="4" y="35" width="18" height="3" rx="1.5" fill="var(--border-lt)" />
                                        <rect x="4" y="10" width="28" height="14" rx="2" fill="var(--surface-2)" />
                                        <text x="18" y="20" textAnchor="middle" fontSize="7" fontWeight="600" fill="var(--text-3)" fontFamily="var(--font-mono)">{ext.substring(0, 4)}</text>
                                      </svg>
                                    </div>
                                    <div className="att-name">{attachment.filename}</div>
                                    <div className="att-size">{typeof attachment.size === 'number' ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : '-'}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DetCollapsible>
                ) : (
                  <div className="det-blk">
                    <span className="blk-lbl">Attachments</span>
                    <div className="det-not-found">No attachments in this thread.</div>
                  </div>
                )}

                {selectedSourceContext && (
                  <div className="det-blk">
                    <span className="blk-lbl">Source Email</span>
                    <div className="blk-txt" style={{ marginBottom: '6px' }}>{selectedSourceContext.subject || 'No subject'}</div>
                    <div className="blk-txt" style={{ fontSize: '11px', opacity: 0.8 }}>
                      {selectedSourceContext.from?.name || selectedSourceContext.from?.email || 'Unknown sender'}
                      {selectedSourceContext.internalDate
                        ? ` • ${new Date(selectedSourceContext.internalDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                        : ''}
                    </div>
                  </div>
                )}

                {/* Feedback — always at bottom */}
                <div className="det-blk det-feedback-row">
                  <span className="blk-lbl" style={{ marginBottom: 0 }}>Feedback</span>
                  <FeedbackButtons insightId={selectedEmail.insightId} messageId={selectedEmail.messageId} alwaysVisible />
                </div>
              </>
            )}
          </div>

          {/* -- BOTTOM ACTIONS -- */}
          <div className="det-actions">
            <button
              className="det-btn"
              onClick={() => setRightCol(false)}
              aria-label="Dismiss and close detail panel"
            >
              Dismiss
            </button>
            <a
              className="det-btn pri"
              href={
                selectedEmail
                  ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(activeAccountEmail)}&continue=${encodeURIComponent(`https://mail.google.com/mail/#all/${selectedEmail.gmailThreadId?.trim() || selectedEmail.messageId?.trim() || ''}`)}`
                  : undefined
              }
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleGmailClick}
              aria-label="Open this thread in Gmail"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: !selectedEmail ? 'none' : 'auto',
                opacity: !selectedEmail ? 0.6 : 1,
                cursor: !selectedEmail ? 'not-allowed' : 'pointer',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open in Gmail
            </a>
          </div>
        </div>
      </div>
    </>
  );
}


