import React, { useState, useEffect } from 'react';
import axios from 'axios';
import '../styles/Dashboard.css';

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
}

interface DashboardProps {
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'profile' | 'onboarding') => void;
}

export function Dashboard({ user, theme, setTheme, onNavigate }: DashboardProps) {
  const [sidebarCol, setSidebarCol] = useState(false);
  const [rightCol, setRightCol] = useState(false);
  const [selectedRow, setSelectedRow] = useState<string | number>(1);
  const [checkedCards, setCheckedCards] = useState<Record<string, boolean>>({});
  const [checkedRows, setCheckedRows] = useState<Record<string, boolean>>({});
  const [checkedCL, setCheckedCL] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusItems, setFocusItems] = useState<PriorityRankingItem[]>([]);
  const [actionItems, setActionItems] = useState<PriorityRankingItem[]>([]);
  const [agendaItems, setAgendaItems] = useState<PriorityRankingItem[]>([]);
  const [sidebarLabels, setSidebarLabels] = useState<{id: string, name: string, color: string, rank: number, count: number}[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notification, setNotification] = useState<{show: boolean, message: string, detail?: string, type: 'success' | 'error' | 'info'} | null>(null);

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
        axios.get(`${API_URL}/api/emails/labels/priority?accountId=${user.gmailAccountId}`, {
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

  const handleSync = async () => {
    if (!user?.gmailAccountId) return;
    
    const API_URL = 'http://localhost:5000';
    const token = localStorage.getItem('firebaseToken');
    
    try {
      setIsSyncing(true);
      setNotification(null);
      // We do not clear existing items so UI remains stable during sync.
      
      const response = await axios.post(`${API_URL}/api/emails/sync`, {
        accountId: user.gmailAccountId
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        const { processed, succeeded, failed } = response.data;
        setNotification({
            show: true,
            type: 'success',
            message: 'Sync completed successfully',
            detail: `Processed: ${processed} | Success: ${succeeded} | Failed: ${failed}`
        });
        // Fetch new results without full page reload, in background mode to keep UI stable
        await fetchInsights(true);
      } else {
        setNotification({
            show: true,
            type: 'error',
            message: 'Sync failed',
            detail: response.data.message
        });
      }
    } catch (err: any) {
        console.error("Error syncing emails:", err);
        setNotification({
            show: true,
            type: 'error',
            message: 'Sync error',
            detail: err.response?.data?.message || 'An error occurred during sync'
        });
    } finally {
        setIsSyncing(false);
        // Hide notification after 5 seconds
        setTimeout(() => setNotification(null), 5000);
    }
  };

  const toggleSidebar = () => setSidebarCol(!sidebarCol);

  const handleCardCheck = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setCheckedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRowCheck = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setCheckedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCLCheck = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setCheckedCL(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
      <div className="shell-dash" style={{ gridTemplateColumns: `${sidebarCol ? '44px' : '176px'} 1fr ${rightCol ? 'minmax(300px, 45vw)' : '0px'}` }}>
        
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
              {isSyncing ? 'Syncing...' : 'Sync'}
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
              <div className="sb-row on">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1.5" width="4.5" height="4.5" fill="currentColor" opacity=".9"/><rect x="7" y="1.5" width="4.5" height="4.5" fill="currentColor" opacity=".3"/><rect x="1.5" y="7" width="4.5" height="4.5" fill="currentColor" opacity=".3"/><rect x="7" y="7" width="4.5" height="4.5" fill="currentColor" opacity=".3"/></svg></div>
                <span className="sb-txt">Today's agenda</span><span className="sb-ct a">7</span>
              </div>
              <div className="sb-row">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="2" y="2.5" width="9" height="8" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2 5h9" stroke="currentColor" strokeWidth="1.1"/><path d="M4.5 1.5v2M8.5 1.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg></div>
                <span className="sb-txt">Upcoming</span><span className="sb-ct g">3</span>
              </div>
              <div className="sb-row">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M4.5 6.5l1.5 1.5 2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                <span className="sb-txt">Waiting on</span><span className="sb-ct g">2</span>
              </div>
              <div className="sb-row">
                <div className="sb-ico"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4h9M2 6.5h7M2 9h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg></div>
                <span className="sb-txt">All mail</span><span className="sb-ct g">124</span>
              </div>
            </div>

            <hr className="sb-div" />

            <div className="sb-grp">
              <span className="sb-grp-lbl">Labels</span>
              {sidebarLabels.length === 0 && !loading && (
                 <div className="lrow" style={{ color: 'var(--text-3)', fontSize: '11px', paddingLeft: '24px' }}>No custom labels</div>
              )}
              {sidebarLabels.map((lbl) => (
                <div className="lrow" key={lbl.id}>
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
                   <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '12px' }}>Inbox zero. Great job!</div>
                )}
                {!loading && focusItems.map((item) => (
                  <div className={`kard ${checkedCards[item.insightId] ? 'done' : ''}`} key={item.insightId} onClick={(e) => handleCardCheck(e, item.insightId)}>
                    <div className="kard-top">
                      <div className="kf">{item.from.name || item.from.email.split('@')[0]}</div>
                      <div className={`chkbox ${checkedCards[item.insightId] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
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
                  <div className={`kard ${checkedCards[item.insightId] ? 'done' : ''}`} key={item.insightId} onClick={(e) => handleCardCheck(e, item.insightId)}>
                    <div className="kard-top">
                      <div className="kf">{item.from.name || item.from.email.split('@')[0]}</div>
                      <div className={`chkbox ${checkedCards[item.insightId] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
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
            <span className="agenda-ttl">All items</span>
            <span className="agenda-meta">sorted by priority</span>
            <span className="agenda-meta-num">{loading ? '...' : agendaItems.length}</span>
          </div>

          <div className="agenda-rows">
            {loading && <div style={{ padding: '20px', color: 'var(--text-3)', fontSize: '13px' }}>Loading agenda...</div>}
            
            {/* We are sorting the Agenda items arbitrarily into Critical / High Priority tags for UI styling sake simply based on their index */}
            {!loading && agendaItems.map((item, index) => {
              const severity = index < 2 ? 'crit' : 'high';
              const color = index < 2 ? 'var(--red)' : 'var(--amber)';
              const prefix = index < 2 ? 'Critical' : 'Priority';

              return (
                <React.Fragment key={item.insightId}>
                  <div className={`pri-hd ${severity}`}>
                    <div className={`pri-bar pr-${severity}`}></div>
                    <span className="pri-lbl" style={{ color }}>{prefix}</span>
                  </div>

                  <div className={`arow ${selectedRow === item.insightId ? 'sel' : ''} ${checkedRows[item.insightId] ? 'done-r' : ''}`} 
                       onClick={() => { setSelectedRow(item.insightId); setRightCol(true); }}>
                    <div className="ar-check-col" onClick={(e) => handleRowCheck(e, item.insightId)}>
                      <div className={`chkbox ${checkedRows[item.insightId] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                    </div>
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
            <div className="det-from">Notion Legal Team</div>
            <div className="det-domain">notion.so</div>
            <div className="det-badge"><div className="badge-sq"></div>ACTION REQUIRED</div>
          </div>

          <div className="det-body">
            <div className="det-blk">
              <span className="blk-lbl">Summary</span>
              <div className="blk-txt">Contract renewal requires your signature on the updated MSA before Oct 31, or account access will be suspended immediately.</div>
            </div>

            <div className="det-blk">
              <span className="blk-lbl">Deadline</span>
              <div className="dl-blk">
                <div className="dlb-left">
                  <div className="dlb-type">Sign deadline</div>
                  <div className="dlb-date">Oct 31, 2025</div>
                  <div className="dlb-remain">4 days remaining</div>
                </div>
                <div className="dlb-badge">4d</div>
              </div>
            </div>

            <div className="det-blk">
              <span className="blk-lbl">Attachment</span>
              <div className="att">
                <div className="att-ext">PDF</div>
                <div className="att-name">MSA_v3_renewal.pdf</div>
                <div className="att-sz">248 KB</div>
              </div>
            </div>

            <div className="det-blk">
              <span className="blk-lbl">Checklist</span>
              <div>
                <div className="cl-item" onClick={(e) => handleCLCheck(e, 'cl1')}>
                  <div className={`cl-box ${checkedCL['cl1'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                  <span className={`cl-txt ${checkedCL['cl1'] ? 'done' : ''}`}>Read the MSA document</span>
                </div>
                <div className="cl-item" onClick={(e) => handleCLCheck(e, 'cl2')}>
                  <div className={`cl-box ${checkedCL['cl2'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                  <span className={`cl-txt ${checkedCL['cl2'] ? 'done' : ''}`}>Sign and return before Oct 31</span>
                </div>
              </div>
            </div>
          </div>

          <div className="det-actions">
            <button className="det-btn">Dismiss</button>
            <button className="det-btn pri">Open in Gmail ↗</button>
          </div>
        </div>
      </div>
    </div>
  );
}
