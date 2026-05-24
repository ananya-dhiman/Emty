import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Widget.css';
import { API_BASE_URL } from '../utils/api';
import type { PriorityRankingItem } from './Dashboard';


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

// Extracted card mapping type
interface WidgetCardData {
  id: string;
  initials: string;
  from: string;
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

  const loadSubmitted = () => {
    try {
      const stored = localStorage.getItem('emty-widget-submitted');
      if (stored) {
        setSubmitted(new Set(JSON.parse(stored)));
      }
    } catch (e) {
      console.warn('Failed to load submitted tasks', e);
    }
  };

  const saveSubmitted = (newSet: Set<string>) => {
    setSubmitted(newSet);
    localStorage.setItem('emty-widget-submitted', JSON.stringify(Array.from(newSet)));
  };

  useEffect(() => {
    document.body.classList.add('widget-mode');
    const root = document.getElementById('root');
    if (root) root.classList.add('widget-mode');

    loadSubmitted();
    fetchData();

    return () => {
      document.body.classList.remove('widget-mode');
      if (root) root.classList.remove('widget-mode');
    };
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('firebaseToken');
    // Fetch user from auth/session or localstorage. Since we share localstorage we might need to get gmailAccountId
    // Normally Dashboard gets user from App.tsx. We can fetch user profile first if needed, but let's assume we can get it from an endpoint.
    if (!token) return;

    try {
      // First get current user to find gmailAccountId
      const userRes = await axios.get(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const gmailAccountId = userRes.data?.user?.gmailAccountId;
      if (!gmailAccountId) return;

      const rankingRes = await axios.get(`${API_BASE_URL}/api/emails/priority-ranking?accountId=${gmailAccountId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (rankingRes.data.success) {
        const topPriority = rankingRes.data.topPriority || [];
        const actionRequired = rankingRes.data.actionRequired || [];
        const combined = [...topPriority, ...actionRequired];
        
        // Remove duplicates by insightId just in case
        const uniqueItems = Array.from(new Map(combined.map(item => [item.insightId, item])).values());
        
        console.log('[Widget] API response keys:', Object.keys(rankingRes.data));
        console.log('[Widget] lowPriorityEmails count:', rankingRes.data.lowPriorityEmails?.length);
        console.log('[Widget] others count:', rankingRes.data.others?.length);

        // "filtered out" matches the main dashboard Low Priority Inbox count
        const lowPriorityCount = rankingRes.data.lowPriorityEmails?.length ?? 0;
        setFilteredCount(lowPriorityCount);

        const mapped: WidgetCardData[] = uniqueItems.map(item => {
          // Parse due date
          let due: Date | null = null;
          if (Array.isArray(item.dates)) {
            const deadline = item.dates.find((d: any) => d.type === 'deadline');
            if (deadline) {
              due = normalizeDateValue(deadline.date);
            }
          }

          // Initials
          const fromName = item.from.name || item.from.email || '';
          const initials = fromName.split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase();

          // Attachments
          const hasAttach = Array.isArray(item.attachments) && item.attachments.length > 0;
          
          // Links
          const hasLink = item.importantLinksByEmail && Object.keys(item.importantLinksByEmail).length > 0;

          return {
            id: item.insightId,
            initials: initials || '?',
            from: fromName,
            title: item.summary.intent || item.emailContextById?.[item.gmailThreadId]?.subject || 'Action Required',
            summary: item.summary.shortSnippet,
            due,
            label: item.matchedLabels?.[0] || 'Task',
            hasAttach,
            hasLink,
            needsReply: item.isActionRequired,
            originalItem: item
          };
        });

        // Sort: items with deadline closest to now first, then no deadline
        mapped.sort((a, b) => {
          if (a.due && b.due) {
            return a.due.getTime() - b.due.getTime();
          }
          if (a.due && !b.due) return -1;
          if (!a.due && b.due) return 1;
          // Both no deadline, sort by score or keep original order
          return (b.originalItem.score?.totalScore || 0) - (a.originalItem.score?.totalScore || 0);
        });

        setItems(mapped);
      }
    } catch (err) {
      console.error('Failed to fetch widget data', err);
    }
  };

  const doSync = async () => {
    setIsSyncing(true);
    setLastSyncText('syncing...');
    
    try {
      const token = localStorage.getItem('firebaseToken');
      const userRes = await axios.get(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const gmailAccountId = userRes.data?.user?.gmailAccountId;
      
      if (gmailAccountId && token) {
        await axios.post(
          `${API_BASE_URL}/api/emails/sync`,
          { accountId: gmailAccountId },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        // Let's just wait 1.5s for visual feedback since AI sync happens in background
        await new Promise(resolve => setTimeout(resolve, 1500));
        await fetchData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
      setLastSyncText('synced just now');
    }
  };

  const toggleSubmit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSet = new Set(submitted);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    saveSubmitted(newSet);
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

  // Render cards sorted properly: overdue -> today -> week -> no deadline. Submitted at bottom.
  const renderCards = () => {
    const sorted = [...items].sort((a, b) => {
      const aDone = submitted.has(a.id);
      const bDone = submitted.has(b.id);
      if (aDone && !bDone) return 1;
      if (!aDone && bDone) return -1;
      
      const tierOrder = { overdue: 0, today: 1, week: 2 };
      const aTier = getTimeLeftTier(a.due).tier as keyof typeof tierOrder;
      const bTier = getTimeLeftTier(b.due).tier as keyof typeof tierOrder;
      return tierOrder[aTier] - tierOrder[bTier];
    });

    return sorted.map(d => {
      const t = getTimeLeftTier(d.due);
      const isDone = submitted.has(d.id);
      const tierCls = isDone ? 'submitted' : t.tier;
      const avCls = t.tier === 'overdue' ? 'w-av-red' : t.tier === 'today' ? 'w-av-amber' : 'w-av-muted';

      return (
        <div key={d.id} className={`w-dcard ${tierCls}`}>
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
            <span className="w-lbl-tag">{d.label}</span>
            {d.hasAttach && (
              <button className="w-ibtn w-has-attach" title="Has attachment">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
            )}
            {d.hasLink && (
              <button className="w-ibtn w-has-link" title="Has link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </button>
            )}
            {d.needsReply && (
              <button className="w-ibtn w-reply-icon" title="Needs reply">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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

  const pendingCount = items.filter(d => !submitted.has(d.id)).length;

  return (
    <div className="w-widget">
      <div className="w-hd">
        {/* Dedicated drag region - covers the header area, sits behind interactive elements */}
        <div className="w-drag-region" data-tauri-drag-region />
        <div className="w-hd-top">
          <span className="w-today-lbl">
            TODAY<span style={{color:'rgba(255,255,255,0.1)', margin:'0 4px'}}>/</span>
            <span style={{color:'var(--text-2, #A3A3A3)', fontSize:'11px'}}>{getDisplayDate()}</span>
          </span>
          <div className="w-hd-right">
            <span className="w-filtered-lbl">{filteredCount} filtered out</span>
            <div style={{display:'flex', alignItems:'center', gap:'6px'}}>
              <button className="w-sync-btn" onClick={doSync} aria-label="Sync">
                <svg 
                  className={isSyncing ? "spin" : ""}
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                SYNC
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
          {renderCards()}
        </div>
      </div>
    </div>
  );
}
