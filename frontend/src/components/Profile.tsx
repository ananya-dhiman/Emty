/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import '../styles/Dashboard.css';
import { API_BASE_URL } from '../utils/api';


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
      const { data } = await axios.get(`${API_BASE_URL}/api/intent/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success && data.profile) {
        const p = data.profile;
        setForm({
          keywords: mergeUnique(p.includeKeywords || []),
          senders: mergeUnique(p.preferredDomains || []),
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
    setTimeout(() => void loadProfile(), 0);
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
      const { data } = await axios.post(`${API_BASE_URL}/api/intent/profile`, payload, {
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

  // Ollama + GPU info (desktop only)
  const [ollamaInfo, setOllamaInfo] = useState<{
    source: string;
    status: string;
    model: string;
    origin: string;
  } | null>(null);
  const [gpuInfo, setGpuInfo] = useState<{
    detected: boolean;
    name: string | null;
    acceleration_likely: boolean;
    display_message: string;
  } | null>(null);

  const isTauri = typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

  const loadOllamaInfo = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const [ollama, gpu] = await Promise.all([
        invoke('get_ollama_status') as Promise<any>,
        invoke('get_gpu_info') as Promise<any>,
      ]);
      setOllamaInfo(ollama);
      setGpuInfo(gpu);
    } catch (e) {
      console.error('Failed to load Ollama/GPU info:', e);
    }
  }, [isTauri]);

  useEffect(() => {
    loadOllamaInfo();
  }, [loadOllamaInfo]);

  // Groq API key status
  const [groqStatus, setGroqStatus] = useState<{
    connected: boolean;
    rateLimits: { remaining: number; limit: number; lastUpdated: number } | null;
  }>({ connected: false, rateLimits: null });
  const [showGroqKeyInput, setShowGroqKeyInput] = useState(false);
  const [groqKeyDraft, setGroqKeyDraft]         = useState('');
  const [groqKeyError, setGroqKeyError]         = useState<string | null>(null);
  const [groqKeyVerifying, setGroqKeyVerifying] = useState(false);
  const [groqKeySaved, setGroqKeySaved]         = useState(false);

  const token = localStorage.getItem('firebaseToken');

  // Load Groq status from profile on mount
  useEffect(() => {
    const load = async () => {
      if (!token) return;
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/intent/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (data.success && data.profile) {
          setGroqStatus({
            connected:  data.profile.aiProvider === 'groq',
            rateLimits: data.profile.groqRateLimits || null,
          });
        }
      } catch {
        // Non-blocking
      }
    };
    void load();
  }, [token]);

  const handleVerifyAndUpdateGroqKey = async () => {
    const trimmed = groqKeyDraft.trim();
    if (!trimmed) return;
    setGroqKeyVerifying(true);
    setGroqKeyError(null);
    try {
      const verifyRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!verifyRes.ok) {
        setGroqKeyError('Invalid key — please check and try again');
        return;
      }
      await axios.post(
        `${API_BASE_URL}/api/intent/profile`,
        { groqApiKey: trimmed },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setGroqStatus(prev => ({ ...prev, connected: true }));
      setGroqKeySaved(true);
      setGroqKeyDraft('');
      setTimeout(() => { setGroqKeySaved(false); setShowGroqKeyInput(false); }, 1500);
    } catch {
      setGroqKeyError('Verification failed — check your connection and try again');
    } finally {
      setGroqKeyVerifying(false);
    }
  };

  const timeAgo = (ms: number): string => {
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)  return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const handleRestartOllama = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('restart_ollama') as any;
      setOllamaInfo(result);
    } catch (e) {
      console.error('Failed to restart Ollama:', e);
    }
  };

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

          {/* Local AI Engine Info -- desktop only */}
          {isTauri && (
            <div
              id="local-ai-engine-section"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                marginTop: '20px',
              }}
            >
              <div
                style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid var(--border-lt)',
                  background: 'var(--panel)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
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
                  Local AI Engine
                </span>
                {ollamaInfo && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      padding: '2px 8px',
                      border: '1px solid',
                      borderColor: ollamaInfo.source !== 'None'
                        ? 'var(--green, #22c55e)'
                        : 'var(--text-3)',
                      color: ollamaInfo.source !== 'None'
                        ? 'var(--green, #22c55e)'
                        : 'var(--text-3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {ollamaInfo.source !== 'None' ? 'Active' : 'Unavailable'}
                  </span>
                )}
              </div>

              <div style={{ padding: '16px 20px' }}>
                {/* Status row */}
                {ollamaInfo ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '9px',
                          color: 'var(--text-3)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          marginBottom: '3px',
                        }}>
                          Status
                        </div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          color: 'var(--text-1)',
                        }}>
                          {ollamaInfo.source !== 'None'
                            ? `Running (${gpuInfo?.acceleration_likely ? 'GPU' : 'CPU'} mode)`
                            : 'Not running'}
                        </div>
                      </div>
                      <div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '9px',
                          color: 'var(--text-3)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          marginBottom: '3px',
                        }}>
                          Model
                        </div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          color: 'var(--text-1)',
                        }}>
                          {ollamaInfo.model}
                        </div>
                      </div>
                      <div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '9px',
                          color: 'var(--text-3)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          marginBottom: '3px',
                        }}>
                          Source
                        </div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '12px',
                          color: 'var(--text-1)',
                        }}>
                          {ollamaInfo.source === 'System'
                            ? 'System installed'
                            : ollamaInfo.source === 'Bundled'
                            ? 'Bundled'
                            : '--'}
                        </div>
                      </div>
                    </div>

                    {/* GPU info */}
                    {gpuInfo && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '10px 12px',
                        background: 'var(--bg)',
                        border: '1px solid var(--border-lt)',
                        marginTop: '4px',
                      }}>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--text-3)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ flexShrink: 0, marginTop: '1px' }}
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <div>
                          <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            color: 'var(--text-2)',
                            lineHeight: 1.5,
                          }}>
                            {gpuInfo.detected && gpuInfo.name
                              ? `GPU: ${gpuInfo.name}`
                              : 'No dedicated GPU detected'}
                          </div>
                          <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            color: 'var(--text-3)',
                            lineHeight: 1.5,
                            marginTop: '2px',
                          }}>
                            GPU acceleration is optional and only enhances performance.
                            It will not hamper functioning of the app.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Retry button when unavailable */}
                    {ollamaInfo.source === 'None' && (
                      <button
                        id="ollama-retry-btn"
                        onClick={handleRestartOllama}
                        style={{
                          alignSelf: 'flex-start',
                          padding: '6px 14px',
                          fontSize: '11px',
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono)',
                          background: 'var(--surface)',
                          color: 'var(--text-2)',
                          border: '1px solid var(--border)',
                          cursor: 'pointer',
                          marginTop: '4px',
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-3)',
                  }}>
                    Loading AI engine info...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Groq Cloud AI Status Card */}
          <div
            id="groq-api-section"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
              marginTop: '20px',
            }}
          >
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid var(--border-lt)',
                background: 'var(--panel)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)' }}>
                Cloud AI (Groq)
              </span>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

              {/* Connection status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '9px', color: groqStatus.connected ? 'var(--green)' : 'var(--text-3)' }}>
                  {groqStatus.connected ? 'CONNECTED' : 'NOT CONNECTED'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: groqStatus.connected ? 'var(--text-1)' : 'var(--text-3)' }}>
                  {groqStatus.connected
                    ? 'Groq API active — Llama 3.3 70B'
                    : 'Running in local-only mode.'}
                </span>
              </div>

              {/* Rate limits — only shown when connected and data exists */}
              {groqStatus.connected && groqStatus.rateLimits && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-2)' }}>
                    Requests remaining today: {groqStatus.rateLimits.remaining} / {groqStatus.rateLimits.limit}
                  </span>
                  <div style={{ height: '4px', background: 'var(--surface-2)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, ((groqStatus.rateLimits.limit - groqStatus.rateLimits.remaining) / groqStatus.rateLimits.limit) * 100)}%`,
                        background: 'var(--accent)',
                        borderRadius: '2px',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)' }}>
                    Last updated: {timeAgo(groqStatus.rateLimits.lastUpdated)}
                  </span>
                </div>
              )}

              {/* Add key prompt when not connected */}
              {!groqStatus.connected && (
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)' }}
                >
                  Get a free key at console.groq.com/keys
                </a>
              )}

              {/* Update / Add API key button */}
              <div>
                <button
                  id="groq-update-key-btn"
                  onClick={() => { setShowGroqKeyInput(v => !v); setGroqKeyError(null); }}
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-ui)',
                    background: 'var(--surface)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border-lt)',
                    cursor: 'pointer',
                  }}
                >
                  {groqStatus.connected ? 'Update API Key' : 'Add API Key'}
                </button>
              </div>

              {/* Inline key input form */}
              {showGroqKeyInput && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    id="groq-key-update-input"
                    type="password"
                    value={groqKeyDraft}
                    onChange={(e) => { setGroqKeyDraft(e.target.value); setGroqKeyError(null); }}
                    placeholder="gsk_..."
                    disabled={groqKeyVerifying || groqKeySaved}
                    style={{
                      background: 'var(--bg)',
                      border: `1px solid ${groqKeyError ? 'var(--red)' : 'var(--border)'}`,
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-1)',
                    }}
                  />
                  {groqKeyError && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--red)' }}>
                      {groqKeyError}
                    </span>
                  )}
                  {groqKeySaved && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--green)' }}>
                      Key updated successfully
                    </span>
                  )}
                  <button
                    id="groq-key-save-btn"
                    onClick={handleVerifyAndUpdateGroqKey}
                    disabled={!groqKeyDraft.trim() || groqKeyVerifying || groqKeySaved}
                    style={{
                      alignSelf: 'flex-start',
                      padding: '6px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-ui)',
                      background: 'var(--text-1)',
                      color: 'var(--bg)',
                      border: '1px solid var(--text-1)',
                      cursor: (!groqKeyDraft.trim() || groqKeyVerifying || groqKeySaved) ? 'not-allowed' : 'pointer',
                      opacity: (!groqKeyDraft.trim() || groqKeyVerifying || groqKeySaved) ? 0.6 : 1,
                    }}
                  >
                    {groqKeyVerifying ? 'Verifying...' : groqKeySaved ? 'Saved' : 'Verify & Save'}
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
