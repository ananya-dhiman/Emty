import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import '../styles/Dashboard.css';
import { CalendarSidebar } from './CalendarSidebar';

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
    extractedFacts?: Record<string, any>;
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

const normalizeDates = (dates: any): Array<{ type: 'deadline' | 'event' | 'followup'; date: Date; sourceEmailId?: string }> => {
  if (!Array.isArray(dates)) return [];
  return dates
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
          <span className="tl-type-tag">{item.type}</span>
          <svg className={`tl-toggle ${isOpen ? 'open' : ''}`} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'profile' | 'onboarding') => void;
}

export function Dashboard({ user, theme, setTheme, onNavigate }: DashboardProps) {
  const [sidebarCol, setSidebarCol] = useState(false);
  const [calendarCol, setCalendarCol] = useState(false);
  const [rightCol, setRightCol] = useState(false);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [selectedSourceMessageId, setSelectedSourceMessageId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusItems, setFocusItems] = useState<PriorityRankingItem[]>([]);
  const [actionItems, setActionItems] = useState<PriorityRankingItem[]>([]);
  const [agendaItems, setAgendaItems] = useState<PriorityRankingItem[]>([]);
  const [sidebarLabels, setSidebarLabels] = useState<{id: string, name: string, color: string, rank: number, count: number}[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notification, setNotification] = useState<{show: boolean, message: string, detail?: string, type: 'success' | 'error' | 'info'} | null>(null);
  // Holds counts from the initial sync HTTP response so the poller can surface them on completion
  const manualSyncCountsRef = React.useRef<{processed: number; succeeded: number; failed: number} | null>(null);

  // feedbackMap: insightId -> 'boost' | 'suppress' | null
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'boost' | 'suppress' | null>>({});

  const sendFeedback = useCallback(async (insightId: string, signal: 'boost' | 'suppress') => {
    const API_URL = 'http://localhost:5000';
    const token = localStorage.getItem('firebaseToken');
    // Toggle off if same signal clicked again
    const current = feedbackMap[insightId];
    const next = current === signal ? null : signal;
    setFeedbackMap((prev) => ({ ...prev, [insightId]: next }));
    if (!token) return;
    try {
      await axios.put(
        `${API_URL}/api/intent/feedback`,
        { insightId, signal: next ?? 'none' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.warn('[Feedback] Failed to record feedback (non-blocking):', err);
    }
  }, [feedbackMap]);

  const fetchInsights = async (isBackground = false) => {
    const API_URL = 'http://localhost:5000';
    const token = localStorage.getItem('firebaseToken');
      
      console.log("Dashboard mount check:", { hasGmailAccountId: !!user?.gmailAccountId, hasToken: !!token, user });

      if (!user?.gmailAccountId || !token) {
      console.log("Bailing out of fetchInsights due to missing gmailAccountId or token.");
      if (!isBackground) setLoading(false);
      return;
    }
    
    try {
      if (!isBackground) setLoading(true);
      console.log(`Fetching from: ${API_URL}/api/emails/priority-ranking?accountId=${user.gmailAccountId}`);
      
      const [rankingRes, priorityRes, labelsRes] = await Promise.all([
        axios.get(`${API_URL}/api/emails/priority-ranking?accountId=${user.gmailAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(e => ({ data: { success: false, message: e.message } })),
        axios.get(`${API_URL}/api/emails/label-priorities?accountId=${user.gmailAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: { success: false } })),
        axios.get(`${API_URL}/api/emails/labels?accountId=${user.gmailAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: { success: false } }))
      ]);

      const response = rankingRes;
      
      console.log("Priority Ranking Response Data:", response.data);

      if (response.data.success) {
        console.log("Setting Focus Items:", response.data.topPriority);
        console.log("Setting Action Items:", response.data.actionRequired);
        console.log("Setting Agenda Items:", response.data.others);
        setFocusItems(response.data.topPriority || []);
        setActionItems(response.data.actionRequired || []);
        setAgendaItems(response.data.others || []);
      } else {
        console.error("API returned success: false", response.data);
        setError(response.data.message);
      }

        // Sidebar Labels integration
      if (priorityRes.data.success && labelsRes.data.success) {
        const activeLabels = labelsRes.data.labels || [];
        const priorities = priorityRes.data.priorities || [];
        
        const labelMap = new Map<string, any>(activeLabels.map((l: any) => [l._id, l]));
        
        const mappedLabels = priorities
            .filter((p: any) => !['Focus', 'Action Required', 'Newsletters'].includes(p.labelNameSnapshot))
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
    fetchInsights(false);
  }, [user]);

  // Background polling for live-stream dashboard (Option B)
  // Auto-refreshes the inbox while the background workers are active
  useEffect(() => {
    if (!user?.gmailAccountId) return;
    const token = localStorage.getItem('firebaseToken');
    if (!token) return;

    let pollInterval: ReturnType<typeof setInterval>;
    let isCurrentlyPolling = false;

    const checkBackgroundProgress = async () => {
      if (isCurrentlyPolling) return;
      isCurrentlyPolling = true;
      try {
        const { data } = await axios.get(
          `http://localhost:5000/api/emails/sync-progress?accountId=${user.gmailAccountId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        
        if (data?.success && data.progressStage && data.progressStage !== 'completed') {
          // If a background sync is happening, fetch latest inbox items silently
          setIsSyncing(true);
          await fetchInsights(true);
        } else if (data?.success && data.progressStage === 'completed') {
           setIsSyncing(false);
           clearInterval(pollInterval);
        }
      } catch (err) {
        console.warn('[Dashboard] Background progress poll failed', err);
      } finally {
        isCurrentlyPolling = false;
      }
    };

    checkBackgroundProgress(); // Check immediately on mount
    pollInterval = setInterval(checkBackgroundProgress, 4000);

    return () => clearInterval(pollInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const allItems = [...focusItems, ...actionItems, ...agendaItems];
  const filteredItems = selectedLabel 
    ? allItems.filter(item => item.matchedLabels.includes(selectedLabel))
    : agendaItems;

  const selectedEmail = allItems.find((item) => item.insightId === selectedInsightId) || null;
  const selectedDomain = selectedEmail
    ? (selectedEmail.from.domain || selectedEmail.from.email.split('@')[1] || '')
    : '';
  const selectedDateLabel = selectedEmail?.timestamps.lastSignalAt
    ? new Date(selectedEmail.timestamps.lastSignalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Recently';
  const summaryText = selectedEmail?.summary.shortSnippet || selectedEmail?.summary.intent || 'No summary available.';
  const selectedDates = normalizeDates((selectedEmail as any)?.dates);
  const selectedAttachments = Array.isArray(selectedEmail?.attachments) ? selectedEmail!.attachments : [];
  const selectedChecklist = Array.isArray(selectedEmail?.checklist) ? selectedEmail!.checklist : [];
  const selectedChecklistItems = Array.isArray((selectedEmail as any)?.checklistItems)
    ? ((selectedEmail as any).checklistItems as Array<any>)
        .map((item: any) => ({
          task: typeof item?.task === 'string' ? item.task.trim() : '',
          status: 'pending' as const,
          dueDate: normalizeDateValue(item?.dueDate),
          reason: typeof item?.reason === 'string' ? item.reason : undefined,
          inferred: item?.inferred === true,
          sourceEmailId: typeof item?.sourceEmailId === 'string' ? item.sourceEmailId : undefined,
        }))
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
        .map((link: any) => ({
          url: typeof link?.url === 'string' ? link.url.trim() : '',
          label: typeof link?.label === 'string' ? link.label : undefined,
          reason: typeof link?.reason === 'string' ? link.reason : undefined,
          inferred: link?.inferred === true,
        }))
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
    setSelectedSourceMessageId(null);
    setRightCol(true);
  };

  const openSelectedInGmail = () => {
    if (!selectedEmail?.gmailThreadId) return;
    window.open(`https://mail.google.com/mail/u/0/#all/${selectedEmail.gmailThreadId}`, '_blank', 'noopener,noreferrer');
  };

  // Inline component rendered per-email to show thumbs feedback.
  // Visible on hover in list rows, always visible in detail panel.
  const FeedbackButtons = ({ insightId, alwaysVisible = false }: { insightId: string; alwaysVisible?: boolean }) => {
    const fb = feedbackMap[insightId] ?? null;
    return (
      <div
        className={alwaysVisible ? 'feedback-row visible' : 'feedback-row'}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: alwaysVisible ? '12px' : '0' }}
      >
        <button
          title="Mark as relevant"
          onClick={(e) => { e.stopPropagation(); void sendFeedback(insightId, 'boost'); }}
          style={{
            background: 'none',
            border: `1px solid ${fb === 'boost' ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: '4px',
            padding: '4px 7px',
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
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
          Relevant
        </button>
        <button
          title="Mark as not relevant"
          onClick={(e) => { e.stopPropagation(); void sendFeedback(insightId, 'suppress'); }}
          style={{
            background: 'none',
            border: `1px solid ${fb === 'suppress' ? 'var(--red, #c0351a)' : 'var(--border)'}`,
            borderRadius: '4px',
            padding: '4px 7px',
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
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
            <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
          </svg>
          Not relevant
        </button>
      </div>
    );
  };

  const handleSync = async () => {
    if (!user?.gmailAccountId) return;

    const API_URL = 'http://localhost:5000';
    const token = localStorage.getItem('firebaseToken');

    setIsSyncing(true);
    setNotification(null);
    manualSyncCountsRef.current = null;

    try {
      // Step 1: Kick off the sync. The backend responds immediately after
      // fetching new email candidates — AI workers run asynchronously after.
      const response = await axios.post(
        `${API_URL}/api/emails/sync`,
        { accountId: user.gmailAccountId },
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

      await new Promise<void>((resolve) => {
        const poll = async () => {
          try {
            const { data } = await axios.get(
              `${API_URL}/api/emails/sync-progress?accountId=${user.gmailAccountId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );

            const stage = data?.progressStage;

            if (stage === 'completed' || stage === 'error') {
              resolve();
              return;
            }

            if (Date.now() - startedAt > MAX_WAIT_MS) {
              console.warn('[Sync] Poller timed out waiting for AI completion.');
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
      setNotification({
        show: true,
        type: 'success',
        message: 'Sync completed',
        detail: counts
          ? `Processed: ${counts.processed} | Success: ${counts.succeeded} | Failed: ${counts.failed}`
          : 'Inbox is up to date.',
      });
    } catch (err: any) {
      console.error('[Sync] Error:', err);
      setNotification({
        show: true,
        type: 'error',
        message: 'Sync error',
        detail: err.response?.data?.message || 'An error occurred during sync',
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
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* NOTIFICATION */}
      {notification && notification.show && (
        <div className="sync-notification" style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: notification.type === 'error' ? 'var(--red)' : 'var(--accent)',
            color: notification.type === 'error' ? '#fff' : 'var(--accent-inv)',
            padding: '16px 20px',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minWidth: '280px',
            fontFamily: 'var(--font-sans)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <strong style={{ fontSize: '14px', fontWeight: 600 }}>{notification.message}</strong>
               <button onClick={() => setNotification(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, opacity: 0.7 }}>
                 <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3L11 11M11 3L3 11"/></svg>
               </button>
            </div>
            {notification.detail && <span style={{ fontSize: '13px', opacity: 0.9 }}>{notification.detail}</span>}
        </div>
      )}

      {/* SHELL */}
      <div className="shell-dash" style={{ gridTemplateColumns: `${sidebarCol ? '44px' : '176px'} ${calendarCol ? '280px' : '0px'} 1fr ${rightCol ? 'minmax(300px, 45vw)' : '0px'}` }}>
        
        {/* BAR */}
        <div className="bar">
          <div className="bar-logo" style={{margin: '0 16px'}}>
            <div className="logo-block">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="1" y="1" width="9" height="1.8" fill="var(--accent-inv)"/>
                <rect x="1" y="4.6" width="9" height="1.8" fill="var(--accent-inv)"/>
                <rect x="1" y="8.2" width="5.5" height="1.8" fill="var(--accent-inv)"/>
              </svg>
            </div>
            Emty
          </div>
          <div className="bar-date" style={{ flex: 1 }}>SAT 21 MAR 2026</div>
          <div className="bar-r">
            {/* Theme Toggle within header */}
            <div className="btn-group" style={{ display: 'flex', alignItems: 'center', marginRight: '16px' }}>
              <button className={`tgl-btn ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>Light</button>
              <button className={`tgl-btn ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
            </div>
            <button 
              className="sync-pill" 
              onClick={handleSync} 
              disabled={isSyncing}
              style={{ cursor: isSyncing ? 'default' : 'pointer', background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
            >
              <div className={`sdot ${isSyncing ? 'pulse' : ''}`} style={isSyncing ? { background: 'var(--amber)' } : {}}></div>
              {isSyncing ? 'Syncing Inbox...' : 'Sync'}
            </button>
            <div className="bar-av" onClick={() => onNavigate('profile')}>{user?.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
          </div>
        </div>

        {/* SIDEBAR */}
        <div className={`sidebar ${sidebarCol ? 'col' : ''}`} id="sb">
          <button className="sb-tog" onClick={toggleSidebar}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M7 2L4 5.5L7 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
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
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                <span className="sb-txt">Calendar</span>
              </div>
              <div className="sb-row on">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z" fill="currentColor"/></svg></div>
                <span className="sb-txt">Do</span><span className="sb-ct a">7</span>
              </div>
              <div className="sb-row">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 5l8 7-8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 5l8 7-8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                <span className="sb-txt">Defer</span><span className="sb-ct g">3</span>
              </div>
              <div className="sb-row">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.6"/><path d="M8 12h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></div>
                <span className="sb-txt">Track</span><span className="sb-ct g">2</span>
              </div>
              <div className="sb-row">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M19 5L5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>
                <span className="sb-txt">Ignore</span><span className="sb-ct g">124</span>
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
              <div className="sb-row">
                <div className="sb-ico"><div style={{ width: '13px', height: '13px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', fontWeight: 700, color: 'var(--accent-inv)', fontFamily: 'var(--font-mono)' }}>G</div></div>
                <span className="sb-txt" style={{ fontSize: '10.5px' }}>{user?.email || 'user@example.com'}</span>
              </div>
            </div>

            <div className="sb-foot" onClick={() => onNavigate('profile')}>
              <div className="foot-av">{user?.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
              <div style={{ minWidth: 0 }}><div className="foot-name">{user?.name || 'User Name'}</div><div className="foot-email">{user?.email || 'user@example.com'}</div></div>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}><circle cx="5" cy="2" r="1" fill="var(--text-3)"/><circle cx="5" cy="5" r="1" fill="var(--text-3)"/><circle cx="5" cy="8" r="1" fill="var(--text-3)"/></svg>
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
        <div className="main">
          {error && (
            <div style={{ padding: '12px 20px', background: 'var(--red)', color: '#fff', fontSize: '13px', borderRadius: '6px', marginBottom: '20px' }}>
              {error}
            </div>
          )}
          {/* BOARDS */}
          <div className="boards">
            {/* FOCUS BOARD */}
            <div className="board focus">
              <div className="board-hd">
                <div className="board-bar"></div>
                <span className="board-name">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 6, verticalAlign: 'text-bottom'}}><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                  Focus Board
                </span>
                <span className="board-desc">&nbsp;— pinned · most relevant today</span>
                <span className="board-badge">{loading ? '...' : `${focusItems.length} items`}</span>
              </div>
              <div className="track">
                {loading && <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '12px' }}>Loading insights...</div>}
                {!loading && focusItems.length === 0 && (
                   <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '13px', lineHeight: 1.5 }}>
                     {isSyncing ? 'Evaluating emails in the background. Your most important emails will pop up here shortly...' : 'Inbox zero. Great job!'}
                   </div>
                )}
                {!loading && focusItems.map((item) => (
                  <div
                    className={`kard ${selectedInsightId === item.insightId ? 'sel' : ''}`}
                    key={item.insightId}
                    onClick={() => selectEmail(item)}
                  >
                    <div className="kard-top">
                      <div className="kf">{item.from.name || item.from.email.split('@')[0]}</div>
                    </div>
                    <div className="ks">{item.summary.shortSnippet || "No summary available"}</div>
                    <div className="kard-tags">
                      {item.matchedLabels.slice(0, 2).map(lbl => (
                        <span className="tag" key={lbl}>{lbl}</span>
                      ))}
                      <span className="kt">
                        {item.timestamps.lastSignalAt ? new Date(item.timestamps.lastSignalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ACTION BOARD */}
            <div className="board action">
              <div className="board-hd">
                <div className="board-bar"></div>
                <span className="board-name">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: 6, verticalAlign: 'text-bottom'}}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  Action Board
                </span>
                <span className="board-desc">&nbsp;— requires your response</span>
                <span className="board-badge">{loading ? '...' : `${actionItems.length} urgent`}</span>
              </div>
              <div className="track">
                {loading && <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '12px' }}>Loading tasks...</div>}
                {!loading && actionItems.length === 0 && (
                   <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '12px' }}>No urgent actions required.</div>
                )}
                {!loading && actionItems.map((item) => (
                  <div
                    className={`kard ${selectedInsightId === item.insightId ? 'sel' : ''}`}
                    key={item.insightId}
                    onClick={() => selectEmail(item)}
                  >
                    <div className="kard-top">
                      <div className="kf">{item.from.name || item.from.email.split('@')[0]}</div>
                    </div>
                    <div className="ks">{item.summary.shortSnippet || "Action required"}</div>
                    <div className="kard-tags">
                      <span className="tag tr">Action Required</span>
                      {item.matchedLabels.slice(0, 1).map(lbl => (
                        <span className="tag tn" key={lbl}>{lbl}</span>
                      ))}
                      <span className="kt">
                        {item.timestamps.lastSignalAt ? new Date(item.timestamps.lastSignalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AGENDA */}
          <div className="agenda-head">
            <span className="agenda-ttl">{selectedLabel ? `Label: ${selectedLabel}` : 'All items'}</span>
            <span className="agenda-meta">{selectedLabel ? 'matching emails' : 'sorted by priority'}</span>
            <span className="agenda-meta-num">{loading ? '...' : filteredItems.length}</span>
          </div>

          <div className="agenda-rows">
            {loading && <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '13px' }}>Loading agenda...</div>}
            
            {!loading && selectedLabel && filteredItems.length === 0 && (
              <div className="empty-fallback">No emails found for this label.</div>
            )}
            
            {/* We are sorting the Agenda items arbitrarily into Critical / High Priority tags for UI styling sake simply based on their index */}
            {!loading && filteredItems.map((item, index) => {
              const severity = index < 2 ? 'crit' : 'high';
              const color = index < 2 ? 'var(--red)' : 'var(--amber)';
              const prefix = index < 2 ? 'Critical' : 'Priority';

              return (
                <React.Fragment key={item.insightId}>
                  <div className={`pri-hd ${severity}`}>
                    <div className={`pri-bar pr-${severity}`}></div>
                    <span className="pri-lbl" style={{ color }}>{prefix}</span>
                  </div>

                  <div
                    className={`arow ${selectedInsightId === item.insightId ? 'sel' : ''}`}
                    onClick={() => selectEmail(item)}
                  >
                    <div className="ar-body">
                      <div className="ar-from">{item.from.name || item.from.email}</div>
                      <div className="ar-snip">{item.summary.shortSnippet}</div>
                      <div className="ar-tags">
                        {item.matchedLabels.slice(0, 2).map(lbl => (
                          <span className="tag" key={lbl}>{lbl}</span>
                        ))}
                      </div>
                    </div>
                    <div className="ar-time">
                       {item.timestamps.lastSignalAt ? new Date(item.timestamps.lastSignalAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently'}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* DETAIL */}
        <div className={`detail ${!rightCol ? 'col' : ''}`}>
          <div className="det-top" style={{ position: 'relative' }}>
            <button 
              onClick={() => setRightCol(false)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 2L10 10M10 2L2 10" />
              </svg>
            </button>
            <div className="det-from">
              {selectedEmail ? (selectedEmail.from.name || selectedEmail.from.email) : 'Select an email'}
            </div>
            <div className="det-domain">{selectedEmail ? selectedDomain : 'No email selected'}</div>
            {selectedEmail && (
              <div className="det-badge"><div className="badge-sq"></div>{selectedEmail.isActionRequired ? 'ACTION REQUIRED' : 'INFORMATION'}</div>
            )}
          </div>

          <div className="det-body">
            <div className="det-blk">
              <span className="blk-lbl">Summary</span>
              <div className="blk-txt">{summaryText}</div>
            </div>

            <div className="det-blk">
              <span className="blk-lbl">Labels</span>
              <div className="ar-tags">
                {selectedEmail?.matchedLabels.length ? (
                  selectedEmail.matchedLabels.map((lbl) => (
                    <span className="tag tn" key={lbl}>{lbl}</span>
                  ))
                ) : (
                  <div className="blk-txt">No labels available.</div>
                )}
              </div>
            </div>

            <div className="det-blk">
              <span className="blk-lbl">Last Signal</span>
              <div className="blk-txt">{selectedDateLabel}</div>
            </div>

            {selectedDates.length > 0 && (
              <div className="det-blk">
                <span className="blk-lbl">Dates</span>
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
              </div>
            )}

            <div className="det-blk">
              <span className="blk-lbl">Important Links</span>
              {selectedLinkGroups.length > 0 ? (
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
                            try {
                              host = new URL(link.url).hostname;
                            } catch {
                              host = 'link';
                            }
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
              ) : (
                <div className="blk-txt">No important links detected.</div>
              )}
            </div>

            <div className="det-blk">
              <span className="blk-lbl">Action Checklist</span>
              {selectedChecklistItems.length > 0 ? (
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
              ) : (
                <div className="blk-txt">No action checklist detected for this thread.</div>
              )}
            </div>

            {selectedAttachments.length > 0 && (
              <div className="det-blk">
                <span className="blk-lbl">Attachments</span>
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
                                    <rect x="0.5" y="0.5" width="35" height="43" rx="4" fill="var(--surface-2)" stroke="var(--border)"/>
                                    <rect x="4" y="30" width="28" height="3" rx="1.5" fill="var(--accent)"/>
                                    <rect x="4" y="35" width="18" height="3" rx="1.5" fill="var(--border-lt)"/>
                                    <rect x="4" y="10" width="28" height="14" rx="2" fill="var(--surface-2)"/>
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
              </div>
            )}

            {selectedSourceContext && (
              <div className="det-blk">
                <span className="blk-lbl">Source Email</span>
                <div className="blk-txt" style={{ marginBottom: '6px' }}>
                  {selectedSourceContext.subject || 'No subject'}
                </div>
                <div className="blk-txt" style={{ fontSize: '11px', opacity: 0.8 }}>
                  {selectedSourceContext.from?.name || selectedSourceContext.from?.email || 'Unknown sender'}
                  {selectedSourceContext.internalDate
                    ? ` • ${new Date(selectedSourceContext.internalDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                    : ''}
                </div>
              </div>
            )}

            {selectedEmail && (
              <div className="det-blk">
                <span className="blk-lbl">Feedback</span>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', margin: '0 0 8px' }}>
                  Tell us if this email is relevant to you.
                </p>
                <FeedbackButtons insightId={selectedEmail.insightId} alwaysVisible />
              </div>
            )}
          </div>

          <div className="det-actions">
            <button className="det-btn" onClick={() => setRightCol(false)}>Dismiss</button>
            <button className="det-btn pri" onClick={openSelectedInGmail} disabled={!selectedEmail}>Open in Gmail</button>
          </div>
        </div>
      </div>
    </div>
  );
}

