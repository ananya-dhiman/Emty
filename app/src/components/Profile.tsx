import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import '../styles/Dashboard.css';

const API_URL = 'http://localhost:5000';

interface ProfileProps {
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'dashboard') => void;
  onLogout: () => Promise<void>;
}

interface PreferencesForm {
  keywords: string[];
  senders: string[];
  labelChips: string[];
  intentBoxes: string[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const mergeUnique = (...lists: string[][]): string[] => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const list of lists) {
    for (const item of list) {
      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }

  return merged;
};

function ChipInput({
  chips,
  onAdd,
  onRemove,
  placeholder,
}: {
  chips: string[];
  onAdd: (val: string) => void;
  onRemove: (val: string) => void;
  placeholder: string;
}) {
  const [inputVal, setInputVal] = useState('');

  const handleAdd = () => {
    const trimmed = inputVal.trim();
    if (!trimmed || chips.includes(trimmed)) return;
    onAdd(trimmed);
    setInputVal('');
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
      {chips.map((chip) => (
        <span
          key={chip}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-2)',
          }}
        >
          {chip}
          <button
            onClick={() => onRemove(chip)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-3)',
              fontSize: '13px',
              lineHeight: 1,
              padding: 0,
            }}
          >
            x
          </button>
        </span>
      ))}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            padding: '5px 10px',
            fontSize: '12px',
            fontFamily: 'var(--font-ui)',
            color: 'var(--text-1)',
            width: '160px',
          }}
        />
        <button
          onClick={handleAdd}
          disabled={!inputVal.trim()}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            padding: '5px 10px',
            fontSize: '12px',
            fontFamily: 'var(--font-ui)',
            color: 'var(--text-2)',
            cursor: inputVal.trim() ? 'pointer' : 'not-allowed',
            opacity: inputVal.trim() ? 1 : 0.5,
          }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

function SectionBox({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        marginBottom: '20px',
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-lt)',
          background: 'var(--panel)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.07em',
            color: 'var(--text-2)',
          }}
        >
          {title}
        </span>
        {subtitle && (
          <p
            style={{
              margin: '4px 0 0',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-3)',
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      <div style={{ padding: '18px 20px' }}>{children}</div>
    </div>
  );
}

function PreferencesPanel({ accountId }: { accountId: string }) {
  const [form, setForm] = useState<PreferencesForm>({
    keywords: [],
    senders: [],
    labelChips: [],
    intentBoxes: [''],
  });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const token = localStorage.getItem('firebaseToken');

  const loadProfile = useCallback(async () => {
    if (!token) {
      setLoadState('error');
      return;
    }

    setLoadState('loading');
    try {
      const { data } = await axios.get(`${API_URL}/api/intent/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success && data.profile) {
        const p = data.profile;
        setForm({
          keywords: mergeUnique(p.inferredKeywords || [], p.includeKeywords || []),
          senders: mergeUnique(p.inferredDomains || [], p.preferredDomains || []),
          labelChips: mergeUnique(p.inferredLabels || []),
          intentBoxes:
            Array.isArray(p.userPrompt) && p.userPrompt.length > 0
              ? p.userPrompt
              : [''],
        });
        setLoadState('ready');
      } else {
        setLoadState('error');
      }
    } catch {
      setLoadState('error');
    }
  }, [token]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSave = async () => {
    if (!token) {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
      return;
    }

    setSaveState('saving');
    try {
      const payload = {
        includeKeywords: form.keywords,
        preferredDomains: form.senders,
        inferredLabels: form.labelChips,
        userPrompt: form.intentBoxes.map((s) => s.trim()).filter(Boolean),
      };
      const { data } = await axios.post(`${API_URL}/api/intent/profile`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success) {
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 2500);
      } else {
        setSaveState('error');
        setTimeout(() => setSaveState('idle'), 3000);
      }
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  const addIntentBox = () =>
    setForm((prev) => ({ ...prev, intentBoxes: [...prev.intentBoxes, ''] }));

  const removeIntentBox = (idx: number) =>
    setForm((prev) => ({
      ...prev,
      intentBoxes: prev.intentBoxes.filter((_, i) => i !== idx),
    }));

  const updateIntentBox = (idx: number, val: string) =>
    setForm((prev) => ({
      ...prev,
      intentBoxes: prev.intentBoxes.map((entry, i) => (i === idx ? val : entry)),
    }));

  if (loadState === 'loading') {
    return (
      <div style={{ padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)' }}>
        Loading preferences...
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--red)' }}>
          Failed to load preferences.
        </span>
        <button
          onClick={() => void loadProfile()}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-2)',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px 24px', borderTop: '1px solid var(--border-lt)' }}>
      <SectionBox
        title="Topics and keywords we noticed"
        subtitle="These show up often in your emails. Keep the ones that matter to you."
      >
        <ChipInput
          chips={form.keywords}
          onAdd={(val) =>
            setForm((prev) => ({ ...prev, keywords: [...prev.keywords, val] }))
          }
          onRemove={(val) =>
            setForm((prev) => ({
              ...prev,
              keywords: prev.keywords.filter((item) => item !== val),
            }))
          }
          placeholder="e.g. invoice"
        />
      </SectionBox>

      <SectionBox
        title="Senders we think matter"
        subtitle="These domains send you frequent emails. Remove any that are not important."
      >
        <ChipInput
          chips={form.senders}
          onAdd={(val) =>
            setForm((prev) => ({ ...prev, senders: [...prev.senders, val] }))
          }
          onRemove={(val) =>
            setForm((prev) => ({
              ...prev,
              senders: prev.senders.filter((item) => item !== val),
            }))
          }
          placeholder="e.g. company.com"
        />
      </SectionBox>

      <SectionBox
        title="Labels you care about"
        subtitle="Labels from your inbox we saw being used. Adjust to fit your workflow."
      >
        <ChipInput
          chips={form.labelChips}
          onAdd={(val) =>
            setForm((prev) => ({ ...prev, labelChips: [...prev.labelChips, val] }))
          }
          onRemove={(val) =>
            setForm((prev) => ({
              ...prev,
              labelChips: prev.labelChips.filter((item) => item !== val),
            }))
          }
          placeholder="e.g. Action Required"
        />
      </SectionBox>

      <SectionBox
        title="Add specific instructions (optional)"
        subtitle="Tell us exactly what matters, one idea at a time. You can always add more later."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {form.intentBoxes.map((box, idx) => (
            <div key={`${accountId}-instruction-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={box}
                onChange={(e) => updateIntentBox(idx, e.target.value)}
                placeholder='e.g. "Emails from my manager about the project"'
                style={{
                  flex: 1,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  padding: '10px 14px',
                  color: 'var(--text-1)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: '13px',
                }}
              />
              {form.intentBoxes.length > 1 && (
                <button
                  onClick={() => removeIntentBox(idx)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    padding: '9px 14px',
                    fontSize: '12px',
                    color: 'var(--text-3)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addIntentBox}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: '1px dashed var(--border)',
              padding: '8px 14px',
              fontSize: '12px',
              color: 'var(--text-3)',
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              marginTop: '4px',
            }}
          >
            + Add another instruction
          </button>
        </div>
      </SectionBox>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          id={`save-prefs-${accountId}`}
          onClick={() => void handleSave()}
          disabled={saveState === 'saving'}
          style={{
            padding: '10px 24px',
            fontFamily: 'var(--font-ui)',
            fontSize: '13px',
            fontWeight: 600,
            background: saveState === 'error' ? 'var(--red)' : 'var(--text-1)',
            color: saveState === 'error' ? '#fff' : 'var(--bg)',
            border: `1px solid ${saveState === 'error' ? 'var(--red)' : 'var(--text-1)'}`,
            cursor: saveState === 'saving' ? 'default' : 'pointer',
            opacity: saveState === 'saving' ? 0.7 : 1,
            transition: 'opacity .15s',
          }}
        >
          {saveState === 'saving'
            ? 'Saving...'
            : saveState === 'saved'
            ? 'Saved'
            : saveState === 'error'
            ? 'Save failed'
            : 'Save Preferences'}
        </button>
        {saveState === 'saved' && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--green)' }}>
            Changes saved successfully.
          </span>
        )}
      </div>
    </div>
  );
}

export function Profile({ user, theme, setTheme, onNavigate, onLogout }: ProfileProps) {
  const [openPrefPanel, setOpenPrefPanel] = useState<string | null>(null);

  const accountId = user?.gmailAccountId || 'primary';
  const email = user?.email || 'user@example.com';
  const initials = email.charAt(0).toUpperCase();

  const togglePanel = (id: string) =>
    setOpenPrefPanel((prev) => (prev === id ? null : id));

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'var(--bg)',
        color: 'var(--text-1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
          height: '48px',
        }}
      >
        <button
          id="profile-back-btn"
          onClick={() => onNavigate('dashboard')}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--text-2)',
            fontFamily: 'var(--font-ui)',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Dashboard
        </button>

        <div
          className="bar-r"
          style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}
        >
          <div className="btn-group" style={{ display: 'flex', margin: 0 }}>
            <button className={`tgl-btn ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>
              Light
            </button>
            <button className={`tgl-btn ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')}>
              Dark
            </button>
          </div>
        </div>
      </div>

      <div
        className="onb-inner"
        style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '60px 20px' }}
      >
        <div style={{ width: '100%', maxWidth: '680px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px', fontFamily: 'var(--font-ui)' }}>
            Profile &amp; Preferences
          </h1>
          <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px' }}>
            Manage your connected accounts and customize how the AI prioritizes your inbox.
          </p>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border-lt)',
                background: 'var(--panel)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--text-2)',
                }}
              >
                Connected Account
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px',
                padding: '16px 20px',
                borderBottom: openPrefPanel === accountId ? '1px solid var(--border-lt)' : 'none',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  background: 'var(--accent)',
                  color: 'var(--accent-inv)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  fontSize: '14px',
                  flexShrink: 0,
                }}
              >
                {initials}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-1)' }}>
                  {email}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    color: 'var(--text-3)',
                    marginTop: '3px',
                  }}
                >
                  Connected via Google
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                <button
                  id={`toggle-prefs-${accountId}`}
                  onClick={() => togglePanel(accountId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-ui)',
                    background: openPrefPanel === accountId ? 'var(--accent)' : 'var(--surface)',
                    color: openPrefPanel === accountId ? 'var(--accent-inv)' : 'var(--text-2)',
                    border: `1px solid ${openPrefPanel === accountId ? 'var(--accent)' : 'var(--border-lt)'}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                  }}
                  onMouseOver={(e) => {
                    if (openPrefPanel !== accountId) {
                      e.currentTarget.style.background = 'var(--surface-2)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (openPrefPanel !== accountId) {
                      e.currentTarget.style.background = 'var(--surface)';
                    }
                  }}
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Preferences
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      transform: openPrefPanel === accountId ? 'rotate(180deg)' : 'none',
                      transition: 'transform 0.2s',
                    }}
                  >
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                <button
                  id="profile-logout-btn"
                  onClick={onLogout}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-ui)',
                    background: 'var(--surface)',
                    color: 'var(--red)',
                    border: '1px solid var(--border-lt)',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--red-bg)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                >
                  Log Out
                </button>
              </div>
            </div>

            {openPrefPanel === accountId && user?.gmailAccountId && (
              <PreferencesPanel accountId={user.gmailAccountId} />
            )}

            {openPrefPanel === accountId && !user?.gmailAccountId && (
              <div
                style={{
                  padding: '16px 20px',
                  borderTop: '1px solid var(--border-lt)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--text-3)',
                }}
              >
                Preferences are available after connecting a Gmail account.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
