
import React, { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/LandingPage.css';
import { LogoMark } from './Logo';

interface LandingPageProps {
  theme: 'light' | 'dark';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
}

/* ════════════════════════════════════════════════
   LandingPage.tsx
   - Reads/writes data-mode="dark|light" on <html>
     to stay in sync with your existing theme system
   - Uses --font-ui, --font-mono, --accent, --text-1
     --text-2, --text-3, --bg, --surface, --panel,
     --border-lt, --accent-lt, --accent-inv from globals.css
   - No new CSS variables introduced
════════════════════════════════════════════════ */

/* ─── LOGO MARK – Imported from Logo.tsx ─── */

/* ─── TAPE DATA ─── */
const TAPE_ITEMS = [
  { text: 'KEEP IT EMTY',       dim: false },
  { text: ' — ',                dim: true  },
  { text: 'YOUR INBOX KNOWS',   dim: true  },
  { text: ' — ',                dim: true  },
  { text: 'LESS INBOX MORE YOU',dim: false },
  { text: ' — ',                dim: true  },
  { text: 'INBOX ZERO ALWAYS',  dim: true  },
  { text: ' — ',                dim: true  },
];
const TAPE_DOUBLED = [...TAPE_ITEMS, ...TAPE_ITEMS];

/* ─── DOWNLOADS ───
   GitHub resolves /releases/latest/ to the newest published release at
   request time, so these URLs never need updating when we ship. CI uploads
   these fixed filenames alongside Tauri's versioned ones. */
const DL_BASE   = 'https://github.com/ananya-dhiman/Emty/releases/latest/download';
const DL_WINDOWS = `${DL_BASE}/Emty-windows-x64-setup.exe`;
const DL_MAC     = `${DL_BASE}/Emty-macos-aarch64.dmg`;
const RELEASE_API = 'https://api.github.com/repos/ananya-dhiman/Emty/releases/latest';

/* Generic "Download App" buttons should hand Mac visitors the .dmg. */
const isMac = typeof navigator !== 'undefined' &&
  /Mac/i.test(navigator.userAgent || '');
const DL_PRIMARY = isMac ? DL_MAC : DL_WINDOWS;

/* ─── FAQ DATA ─── */
const FAQ_ITEMS = [
  {
    tag: '01 · ACCESS',
    q:   'Does emty have access to my full Gmail?',
    a:   "emty connects via Gmail's standard OAuth. It reads your inbox to understand what matters — it does not store, forward, or modify your emails. Revoke access anytime from your Google account settings.",
  },
  {
    tag: '02 · COST',
    q:   'Is emty free to use?',
    a:   'Early access is free. Pricing will be announced before launch. Everyone on the early access list gets a founder rate — the lowest price emty will ever be.',
  },
  {
    tag: '03 · WORKS WITH',
    q:   'Does it work with Outlook or other inboxes?',
    a:   "Right now emty is built for Gmail. Outlook and other providers are on the roadmap. Gmail first because that's where the pain is most acute.",
  },
  {
    tag: '04 · SMART',
    q:   'How does emty know what matters to me?',
    a:   'You tell it. On setup you define custom labels, arrange them by priority, and write plain-text preferences — like "anything from my manager is always urgent" or "ignore newsletters unless I mark them." emty then uses your rules to sort and surface what matters. It improves when you flag something it got wrong.',
  },
  {
    tag: '05 · MISSING',
    q:   'What if emty misses something important?',
    a:   "You're always in control. You can see everything emty filtered, correct it, and it learns from your feedback. The goal is zero missed signals — and it improves with every correction.",
  },
  {
    tag: '06 · CANCEL',
    q:   'How do I cancel or disconnect?',
    a:   "One click. Disconnect from inside emty or directly from your Google account. No dark patterns, no confirmation loops. We believe you should be able to leave instantly — and cleanly.",
  },
];

/* ─── FEATURES DATA ─── */
const FEATURES = [
  {
    n:   '01 · FOCUS BOARD',
    t:   'Only what needs your attention.',
    d:   "emty pins what's actually relevant today. Not everything — just what matters. The rest is handled silently.",
    tag: 'PINNED · MOST RELEVANT',
  },
  {
    n:   '02 · ACTION BOARD',
    t:   'Requires a response. Nothing else.',
    d:   'Two urgent things rise to the top. emty knows the difference between noise and something that actually needs you.',
    tag: 'URGENT · FLAGGED',
  },
  {
    n:   '03 · MEMORY',
    t:   "Remembers so you don't have to.",
    d:   'Important details recalled when relevant. Stop re-reading old threads. emty already did that for you.',
    tag: 'CONTEXT · RECALLED',
  },
];

/* ─── PRIVACY CARDS DATA ─── */
const PRIVACY_CARDS = [
  { icon: '[ 01 · READ ONLY ]',    t: "We read. We don't store.",         d: "emty reads your inbox to surface what matters. It does not store your email content. Ever." },
  { icon: '[ 02 · NO TRAINING ]',  t: "Your emails don't train AI.",      d: "Your inbox is private. It is never used to train any model — ours or anyone else's." },
  { icon: '[ 03 · YOUR CONTROL ]', t: 'Disconnect in one click.',         d: "Remove emty's access anytime. Your Gmail permissions are yours. Revocation is instant and clean." },
  { icon: '[ 04 · TRANSPARENCY ]', t: 'We tell you exactly what we do.',  d: "No buried terms. No surprise data uses. emty operates on one principle: your inbox is yours." },
];

/* ─── STATUS STRIP DATA ─── */
const STATUS_CELLS = [
  { k: 'EMAILS READ',      v: '2,847' },
  { k: 'NOISE CLEARED',    v: '✓'     },
  { k: 'ACTIONS SURFACED', v: '2'     },
  { k: 'INBOX STATUS',     v: 'emty.' },
];

/* ─── FOOTER COLUMNS ─── */
const FOOTER_COLS = [
  { title: 'PRODUCT', links: ['Features', 'How it works', 'Pricing', 'Changelog'] },
  { title: 'COMPANY', links: ['About', 'Blog', 'Contact', 'Download App'] },
  { title: 'LEGAL',   links: ['Privacy policy', 'Terms of service', 'Data handling', 'Security'] },
];

/* ─── LOG ROWS DATA ─── */
const LOG_ROWS = [
  { ts: '09:14', msg: 'Wellfound · 5 new roles matched',     hi: false, fin: false },
  { ts: '09:15', msg: 'Coding Ninjas · action required ↗',   hi: true,  fin: false },
  { ts: '09:16', msg: 'Scarlet Ink newsletter · summarised', hi: false, fin: false },
  { ts: '09:17', msg: '46 threads · marked irrelevant',       hi: false, fin: false },
  { ts: '09:17', msg: 'Quora Digest · 1 thread kept',         hi: false, fin: false },
  { ts: '09:18', msg: 'Inbox → emty.',                        hi: true,  fin: true  },
];

/* ════════════════════════════════════════════════
   HOOKS
════════════════════════════════════════════════ */

/* Typewriter — cycles through phrases */
const PHRASES = ['emty.', 'empty.', 'quiet.', 'yours.', 'emty.'];

function useTypewriter(startDelay = 2000): string {
  const [text, setText]   = useState('emty');
  const phraseIdx         = useRef(0);
  const charIdx           = useRef(4);   // start after 'emty'
  const deleting          = useRef(false);
  const timer             = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const tick = useCallback(function tickFn() {
    const phrase = PHRASES[phraseIdx.current];
    if (!deleting.current) {
      charIdx.current++;
      setText(phrase.slice(0, charIdx.current));
      if (charIdx.current === phrase.length) {
        deleting.current = true;
        timer.current = setTimeout(tickFn, 2400);
        return;
      }
      timer.current = setTimeout(tickFn, 100);
    } else {
      charIdx.current--;
      setText(phrase.slice(0, charIdx.current));
      if (charIdx.current === 0) {
        deleting.current = false;
        phraseIdx.current = (phraseIdx.current + 1) % PHRASES.length;
        timer.current = setTimeout(tickFn, 400);
        return;
      }
      timer.current = setTimeout(tickFn, 50);
    }
  }, []);

  useEffect(() => {
    timer.current = setTimeout(tick, startDelay);
    return () => clearTimeout(timer.current);
  }, [tick, startDelay]);

  return text;
}

/* Animated counter on scroll into view */
function useCountUp(target: number, isFloat = false) {
  const [val, setVal]   = useState<string>('—');
  const ref             = useRef<HTMLDivElement>(null);
  const animated        = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !animated.current) {
          animated.current = true;
          const duration  = 1800;
          let startTime: number | null = null;
          const step = (ts: number) => {
            if (!startTime) startTime = ts;
            const progress = Math.min((ts - startTime) / duration, 1);
            const ease     = 1 - Math.pow(1 - progress, 3);
            const current  = isFloat
              ? (target * ease).toFixed(1)
              : Math.floor(target * ease).toLocaleString();
            setVal(current);
            if (progress < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.6 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, isFloat]);

  return { val, ref };
}

/* Reads current data-mode from <html> */

/* ════════════════════════════════════════════════
   SUB-COMPONENTS
════════════════════════════════════════════════ */

const Tape: React.FC<{ reversed?: boolean }> = ({ reversed = false }) => (
  <div className="lp-tape">
    <div className={`lp-tape-inner${reversed ? ' rev' : ''}`}>
      {TAPE_DOUBLED.map((item, i) => (
        <span key={i} className={`lp-ti${item.dim ? ' d' : ''}`}>
          {item.text}
        </span>
      ))}
    </div>
  </div>
);

/* ════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════ */
const LandingPage: React.FC<LandingPageProps> = ({ theme, setTheme }) => {
  const mode = theme;
  const toggle = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const twText = useTypewriter(2000);

  /* Live version from the latest GitHub release. Purely cosmetic — the
     unauthenticated API allows 60 req/hr per IP, so on failure we simply
     omit the label rather than blocking anything. */
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(RELEASE_API)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.tag_name) setVersion(d.tag_name); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { val: val1, ref: ref1 } = useCountUp(2847);
  const { val: val2, ref: ref2 } = useCountUp(12);
  const { val: val3, ref: ref3 } = useCountUp(6.4, true);

  const toggleFaq = (i: number) =>
    setOpenFaq(prev => (prev === i ? null : i));

  return (
    <div className="lp-root">

      {/* ══ NAV ══ */}
      <nav className="lp-nav">
        <a className="lp-nav-logo" href="#">
          <LogoMark size={26} />
          <span className="lp-logo-text">emty</span>
        </a>

        <ul className="lp-nav-links">
          {['Features', 'How it works', 'Privacy', 'Download', 'FAQ'].map(label => (
            <li key={label}>
              <a href={`#${label.toLowerCase().replace(/\s+/g, '-')}`}>{label}</a>
            </li>
          ))}
        </ul>

        <div className="lp-nav-right">
          <button className="lp-theme-toggle" onClick={toggle}>
            {mode === 'dark' ? '☼ LIGHT' : '☾ DARK'}
          </button>
          <a className="lp-btn-primary" href={DL_PRIMARY}>Download App</a>
        </div>
      </nav>

      {/* ══ HERO ══ */}
      <section className="lp-hero">
        <div className="lp-hero-grid">

          {/* Headline */}
          <div className="lp-hero-left">
            <div className="lp-hero-tag">YOUR INBOX · NOW</div>
            <div className="lp-hero-hl">
              KEEP IT<br />
              <span className="lp-orange">{twText}</span>
              <span className="lp-cursor" />
            </div>
            <div className="lp-hero-sub">
              <span className="lp-lit">// reads everything</span><br />
              <span>// bothers you with nothing</span><br />
              <span className="lp-lit">// your inbox knows.</span>
            </div>
            <div className="lp-hero-actions">
              <a
                className="lp-btn-primary"
                href={DL_PRIMARY}
                style={{ fontSize: 14, padding: '14px 28px' }}
              >
                Download App →
              </a>
              <a className="lp-btn-outline" href="#how-it-works">
                See how it works
              </a>
            </div>
            <div className="lp-hero-progress">
              <span className="lp-prog-label">CLEARING INBOX</span>
              <div className="lp-prog-track">
                <div className="lp-prog-fill" />
              </div>
              <span className="lp-prog-status">emty.</span>
            </div>
          </div>

          {/* Log feed */}
          <div className="lp-hero-right">
            <div className="lp-log-title">INBOX LOG · LIVE</div>
            <div className="lp-log-feed">
              {LOG_ROWS.map((row, i) => (
                <div
                  key={i}
                  className={[
                    'lp-log-row',
                    row.hi  ? 'hi'  : '',
                    row.fin ? 'fin' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="lp-lt">{row.ts}</span>
                  <span className="lp-lm">{row.msg}</span>
                </div>
              ))}
            </div>
            <div className="lp-log-summary">
              <div className="lp-ls-title">TODAY'S SUMMARY</div>
              <div className="lp-ls-line">emails processed <span className="lp-v">......... 2,847</span></div>
              <div className="lp-ls-line">surfaced for you <span className="lp-vo">......... 12</span></div>
              <div className="lp-ls-line">actions required <span className="lp-vo">......... 2</span></div>
              <div className="lp-ls-line">inbox status     <span className="lp-vo">......... emty</span></div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="lp-stats-row">
          <div className="lp-stat-cell">
            <div className="lp-stat-lbl">EMAILS READ</div>
            <div
              className="lp-stat-num"
              ref={ref1 as React.RefObject<HTMLDivElement>}
            >
              {val1}
            </div>
          </div>
          <div className="lp-stat-cell">
            <div className="lp-stat-lbl">SURFACED</div>
            <div
              className="lp-stat-num lp-o"
              ref={ref2 as React.RefObject<HTMLDivElement>}
            >
              {val2}
            </div>
          </div>
          <div className="lp-stat-cell">
            <div className="lp-stat-lbl">HOURS SAVED</div>
            <div
              className="lp-stat-num"
              ref={ref3 as React.RefObject<HTMLDivElement>}
            >
              {val3}
            </div>
          </div>
          <div className="lp-stat-cell">
            <div className="lp-stat-lbl">STATUS</div>
            <div className="lp-stat-num lp-o">emty.</div>
          </div>
        </div>
      </section>

      {/* ══ TAPE 1 ══ */}
      <Tape />

      {/* ══ FEATURES ══ */}
      <section className="lp-sec" id="features">
        <div className="lp-sec-hd">
          <span className="lp-sec-lbl">—</span>
          <span className="lp-sec-lbl">WHAT EMTY DOES</span>
        </div>
        <div className="lp-feat-grid">
          {FEATURES.map((f, i) => (
            <div className="lp-feat-card" key={i}>
              <div className="lp-feat-n">{f.n}</div>
              <div className="lp-feat-t">{f.t}</div>
              <div className="lp-feat-d">{f.d}</div>
              <div className="lp-feat-tag">{f.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ EMPTY CONCEPT ══ */}
      <div className="lp-empty-wrap">
        <div className="lp-empty-concept">
          <div className="lp-brk tl" /><div className="lp-brk tr" />
          <div className="lp-brk bl" /><div className="lp-brk br" />
          <div className="lp-empty-inner">
            <div className="lp-empty-rule">[ THIS SPACE IS INTENTIONALLY EMPTY ]</div>
            <div className="lp-empty-void">EMTY</div>
            <div className="lp-empty-tagline">
              This is what your inbox<br />looks like with <span>emty.</span>
            </div>
          </div>
        </div>

        <div className="lp-empty-content">
          <div className="lp-empty-content-top">
            <div>
              <div className="lp-empty-eyebrow">— THE GOAL</div>
              <div className="lp-empty-hl">
                Your inbox,<br />now <span className="lp-o">emty.</span>
              </div>
              <div className="lp-empty-body">
                Not just archived. Not just muted. Actually handled —
                read, understood, prioritised, and cleared.
                emty works through your inbox so you never have to.
              </div>
            </div>
            <div className="lp-empty-cta">
              <a
                className="lp-btn-primary"
                href={DL_PRIMARY}
                style={{ fontSize: 14, padding: '14px 24px' }}
              >
                Download App →
              </a>
              <span className="lp-empty-cta-note">// Gmail · 30 seconds to connect</span>
            </div>
          </div>
          <div className="lp-status-strip">
            {STATUS_CELLS.map((c, i) => (
              <div className="lp-status-cell" key={i}>
                <div className="lp-sc-key">{c.k}</div>
                <div className="lp-sc-val done">{c.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ══ HOW IT WORKS ══ */}
      <section className="lp-sec" id="how-it-works">
        <div className="lp-sec-hd">
          <span className="lp-sec-lbl">—</span>
          <span className="lp-sec-lbl">HOW IT WORKS · 03 STEPS</span>
        </div>
        <div className="lp-hiw-grid">
          <div className="lp-hiw-card">
            <div className="lp-hiw-n">01 · CONNECT</div>
            <div className="lp-hiw-t">Link your Gmail.<br />Takes 30 seconds.</div>
            <div className="lp-hiw-c">
              // read-only access<br />
              // nothing sent or stored<br />
              // emty sees. it doesn't <span className="lp-lit">touch.</span>
            </div>
          </div>
          <div className="lp-hiw-card">
            <div className="lp-hiw-n">02 · DEFINE</div>
            <div className="lp-hiw-t">You set the rules.<br />emty follows them.</div>
            <div className="lp-hiw-c">
              // create your own labels<br />
              // rank what matters, in order<br />
              // fine-tune with <span className="lp-lit">plain-text preferences</span>
            </div>
          </div>
          <div className="lp-hiw-card" style={{ marginRight: 0 }}>
            <div className="lp-hiw-n">03 · EMTY</div>
            <div className="lp-hiw-t">Inbox handled.<br />Nothing missed.</div>
            <div className="lp-hiw-c">
              // zero noise, zero clutter<br />
              // deadlines + events on your <span className="lp-lit">calendar</span><br />
              // just the right info, right now
            </div>
          </div>
        </div>
      </section>

      {/* ══ TAPE 2 (reversed) ══ */}
      <Tape reversed />

      {/* ══ PRIVACY ══ */}
      <section className="lp-sec" id="privacy">
        <div className="lp-priv-grid">
          <div className="lp-priv-left">
            <div className="lp-sec-lbl" style={{ marginBottom: 20 }}>— YOUR RIGHTS</div>
            <div className="lp-priv-big">
              Your data.<br />Your <span className="lp-o">rules.</span>
            </div>
            <div className="lp-priv-sub">
              // no selling. ever.<br />
              // no training on your emails<br />
              // disconnect anytime<br />
              // you own everything
            </div>
          </div>
          <div className="lp-priv-cards">
            {PRIVACY_CARDS.map((c, i) => (
              <div className="lp-priv-card" key={i}>
                <div className="lp-priv-icon">{c.icon}</div>
                <div className="lp-priv-ct">{c.t}</div>
                <div className="lp-priv-cd">{c.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ DOWNLOAD ══ */}
      <section className="lp-sec" id="download">
        <div className="lp-sec-hd">
          <span className="lp-sec-lbl">—</span>
          <span className="lp-sec-lbl">DOWNLOAD APP</span>
        </div>
        <div className="lp-dl-grid">
          {/* Windows */}
          <div className="lp-dl-card">
            <div className="lp-dl-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
              </svg>
            </div>
            <div className="lp-dl-os">WINDOWS</div>
            <div className="lp-dl-ver">{version ? `X64 · ${version}` : 'X64'}</div>
            <a
              className="lp-btn-primary"
              href={DL_WINDOWS}
              style={{ marginTop: 'auto', fontSize: 13, padding: '12px 24px' }}
            >
              Download .exe
            </a>
          </div>

          {/* Mac */}
          <div className="lp-dl-card">
            <div className="lp-dl-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.15 2.65.83 3.32 2.01-2.91 1.76-2.4 5.86.37 7.02-.75 1.54-1.78 3.03-3.1 4.2M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.39 2.31-1.84 4.38-3.74 4.25z"/>
              </svg>
            </div>
            <div className="lp-dl-os">MAC OS</div>
            <div className="lp-dl-ver">{version ? `APPLE SILICON · ${version}` : 'APPLE SILICON'}</div>
            <a
              className="lp-btn-primary"
              href={DL_MAC}
              style={{ marginTop: 'auto', fontSize: 13, padding: '12px 24px' }}
            >
              Download .dmg
            </a>
          </div>

          {/* Linux */}
          <div className="lp-dl-card">
            <div className="lp-dl-icon" style={{ opacity: 0.5 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.666 2.005C8.948 2.128 7.234 4.417 7.234 6.942v1.54c-1.391.808-2.613 1.942-3.327 3.39-1.125 2.274-1.187 4.707-.468 7.043.435 1.411 2.314 2.809 3.518 3.085h10.086c1.204-.276 3.083-1.674 3.518-3.085.719-2.336.657-4.769-.468-7.043-.714-1.448-1.936-2.582-3.327-3.39v-1.54c0-2.525-1.714-4.814-4.432-4.937a5.533 5.533 0 0 0-.668 0zM10 8c.552 0 1 .448 1 1s-.448 1-1 1-1-.448-1-1 .448-1 1-1zm4 0c.552 0 1 .448 1 1s-.448 1-1 1-1-.448-1-1 .448-1 1-1zm-2 5c1.105 0 2 .895 2 2s-.895 2-2 2-2-.895-2-2 .895-2 2-2z"/>
              </svg>
            </div>
            <div className="lp-dl-os" style={{ opacity: 0.5 }}>LINUX</div>
            <div className="lp-dl-ver" style={{ opacity: 0.5 }}>DEB / APPIMAGE</div>
            <div className="lp-btn-outline" style={{ marginTop: 'auto', fontSize: 13, padding: '12px 24px', opacity: 0.5, cursor: 'not-allowed' }}>
              Coming Soon
            </div>
          </div>
        </div>
      </section>

      {/* ══ FAQ ══ */}
      <section className="lp-sec" id="faq">
        <div className="lp-sec-hd">
          <span className="lp-sec-lbl">—</span>
          <span className="lp-sec-lbl">QUESTIONS · ANSWERED</span>
        </div>
        <div className="lp-faq-grid">
          {FAQ_ITEMS.map((item, i) => (
            <div
              key={i}
              className={`lp-faq-item${openFaq === i ? ' open' : ''}`}
              onClick={() => toggleFaq(i)}
            >
              <div className="lp-faq-tag">{item.tag}</div>
              <div className="lp-faq-q">
                <div className="lp-faq-ques">{item.q}</div>
                <div className="lp-faq-tog">+</div>
              </div>
              <div className="lp-faq-ans">{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══ FOOTER ══ */}
      <footer className="lp-footer">
        <div className="lp-foot-top">
          <div>
            <div className="lp-foot-logo">
              <LogoMark size={20} />
              <span className="lp-logo-text" style={{ fontSize: '18px' }}>emty</span>
            </div>
            <div className="lp-foot-tagline">
              Keep it <span className="lp-o">emty.</span><br />
              Your inbox knows.<br />
              Less inbox. More you.
            </div>
          </div>
          {FOOTER_COLS.map(col => (
            <div key={col.title}>
              <div className="lp-foot-col-t">{col.title}</div>
              <ul className="lp-foot-links">
                {col.links.map(l => (
                  <li key={l}><a href="#">{l}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="lp-foot-bot">
          <div className="lp-foot-copy">© 2026 emty. All rights reserved.</div>
          <div className="lp-foot-status">
            <div className="lp-dot" />
            ALL SYSTEMS EMTY
          </div>
        </div>
      </footer>

    </div>
  );
};

export default LandingPage;
