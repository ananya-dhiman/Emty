import React, { useState } from 'react';
import '../styles/Dashboard.css';

interface DashboardProps {
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
}

export function Dashboard({ user, theme, setTheme }: DashboardProps) {
  const [sidebarCol, setSidebarCol] = useState(false);
  const [rightCol, setRightCol] = useState(false);
  const [selectedRow, setSelectedRow] = useState(1);
  const [checkedCards, setCheckedCards] = useState<Record<string, boolean>>({});
  const [checkedRows, setCheckedRows] = useState<Record<string, boolean>>({});
  const [checkedCL, setCheckedCL] = useState<Record<string, boolean>>({});

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
            <div className="sync-pill"><div className="sdot"></div>synced now</div>
            <div className="bar-av">{user?.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
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
              <div className="lrow"><div className="ldot" style={{ background: '#C0351A' }}></div><span className="lname">Legal</span><span className="lct">2</span></div>
              <div className="lrow"><div className="ldot" style={{ background: 'var(--text-2)' }}></div><span className="lname">Finance</span><span className="lct">4</span></div>
              <div className="lrow"><div className="ldot" style={{ background: '#1854A0' }}></div><span className="lname">Investors</span><span className="lct">1</span></div>
              <div className="lrow"><div className="ldot" style={{ background: '#186845' }}></div><span className="lname">Engineering</span><span className="lct">7</span></div>
              <div className="lrow"><div className="ldot" style={{ background: '#9A5405' }}></div><span className="lname">Payments</span><span className="lct">3</span></div>
              <div className="lrow" style={{ paddingTop: '8px' }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', cursor: 'pointer' }}>+ add label</span></div>
            </div>

            <hr className="sb-div" />

            <div className="sb-grp">
              <span className="sb-grp-lbl">Accounts</span>
              <div className="sb-row">
                <div className="sb-ico"><div style={{ width: '13px', height: '13px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', fontWeight: 700, color: 'var(--accent-inv)', fontFamily: 'var(--font-mono)' }}>G</div></div>
                <span className="sb-txt" style={{ fontSize: '10.5px' }}>{user?.email || 'user@example.com'}</span>
              </div>
            </div>

            <div className="sb-foot">
              <div className="foot-av">{user?.name ? user.name.charAt(0).toUpperCase() : 'U'}</div>
              <div><div className="foot-name">{user?.name || 'User Name'}</div><div className="foot-email">{user?.email || 'user@example.com'}</div></div>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 'auto', flexShrink: 0 }}><circle cx="5" cy="2" r="1" fill="var(--text-3)"/><circle cx="5" cy="5" r="1" fill="var(--text-3)"/><circle cx="5" cy="8" r="1" fill="var(--text-3)"/></svg>
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div className="main">
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
                <span className="board-badge">5 items</span>
              </div>
              <div className="track">
                
                <div className={`kard ${checkedCards['fc1'] ? 'done' : ''}`} onClick={(e) => handleCardCheck(e, 'fc1')}>
                  <div className="kard-top">
                    <div className="kf">Sarah @ Sequoia</div>
                    <div className={`chkbox ${checkedCards['fc1'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                  </div>
                  <div className="ks">Investor update — excited to see Q3 numbers before Nov 2 sync</div>
                  <div className="kard-tags">
                    <span className="tag tp">Investors</span>
                    <span className="tag tb">Nov 2</span>
                    <span className="kt">9:01am</span>
                  </div>
                </div>

                <div className={`kard ${checkedCards['fc2'] ? 'done' : ''}`} onClick={(e) => handleCardCheck(e, 'fc2')}>
                  <div className="kard-top">
                    <div className="kf">AWS Marketplace</div>
                    <div className={`chkbox ${checkedCards['fc2'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                  </div>
                  <div className="ks">Product listing approval pending — review before it goes live</div>
                  <div className="kard-tags">
                    <span className="tag tb">Engineering</span>
                    <span className="tag tn">1 doc</span>
                    <span className="kt">Mon</span>
                  </div>
                </div>

                {/* More focus cards can be added here mirroring original HTML structure */}
                <div className={`kard ${checkedCards['fc3'] ? 'done' : ''}`} onClick={(e) => handleCardCheck(e, 'fc3')}>
                  <div className="kard-top">
                    <div className="kf">Accel Partners</div>
                    <div className={`chkbox ${checkedCards['fc3'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                  </div>
                  <div className="ks">Prep for Nov 5 partner call — agenda + deck attached</div>
                  <div className="kard-tags">
                    <span className="tag tp">Investors</span>
                    <span className="tag tg">Nov 5</span>
                    <span className="kt">Fri</span>
                  </div>
                </div>

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
                <span className="board-badge">3 urgent</span>
              </div>
              <div className="track">

                <div className={`kard ${checkedCards['ac1'] ? 'done' : ''}`} onClick={(e) => handleCardCheck(e, 'ac1')}>
                  <div className="kard-top">
                    <div className="kf">Notion Legal</div>
                    <div className={`chkbox ${checkedCards['ac1'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
                  </div>
                  <div className="ks">Sign MSA renewal — access suspended if not completed</div>
                  <div className="kard-tags">
                    <span className="tag tr">Deadline Oct 31</span>
                    <span className="tag tn">PDF</span>
                    <span className="kt">9:41am</span>
                  </div>
                </div>

                {/* Additional task cards omitted for brevity but represent original DOM */}
              </div>
            </div>
          </div>

          {/* AGENDA */}
          <div className="agenda-head">
            <span className="agenda-ttl">All items</span>
            <span className="agenda-meta">sorted by priority</span>
            <span className="agenda-meta-num">7</span>
          </div>

          <div className="agenda-rows">
            <div className="pri-hd crit">
              <div className="pri-bar pr-crit"></div>
              <span className="pri-lbl" style={{ color: 'var(--red)' }}>Critical</span>
            </div>

            <div className={`arow ${selectedRow === 1 ? 'sel' : ''} ${checkedRows['r1'] ? 'done-r' : ''}`} onClick={() => { setSelectedRow(1); setRightCol(true); }}>
              <div className="ar-check-col" onClick={(e) => handleRowCheck(e, 'r1')}>
                <div className={`chkbox ${checkedRows['r1'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
              </div>
              <div className="ar-body">
                <div className="ar-from">Notion Legal Team</div>
                <div className="ar-snip">Sign MSA renewal before access suspended</div>
                <div className="ar-tags">
                  <span className="tag tr">Deadline Oct 31</span>
                  <span className="tag tn">Legal</span>
                </div>
              </div>
              <div className="ar-time">9:41am</div>
            </div>
            
            <div className="pri-hd high">
              <div className="pri-bar pr-high"></div>
              <span className="pri-lbl" style={{ color: 'var(--amber)' }}>High priority</span>
            </div>

            <div className={`arow ${selectedRow === 2 ? 'sel' : ''} ${checkedRows['r2'] ? 'done-r' : ''}`} onClick={() => { setSelectedRow(2); setRightCol(true); }}>
              <div className="ar-check-col" onClick={(e) => handleRowCheck(e, 'r2')}>
                <div className={`chkbox ${checkedRows['r2'] ? 'on' : ''}`}><svg className="chk-svg" width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
              </div>
              <div className="ar-body">
                <div className="ar-from">HDFC Bank</div>
                <div className="ar-snip">EMI auto-debit scheduled — update payment method</div>
                <div className="ar-tags">
                  <span className="tag ta">Oct 22</span>
                  <span className="tag tn">Payments</span>
                </div>
              </div>
              <div className="ar-time">Yesterday</div>
            </div>
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
