import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import '../styles/Dashboard.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LabelItem {
  id: string;
  name: string;
  desc: string;
  isSystem: boolean;
}

interface OnboardingProps {
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'dashboard') => void;
}

// ─── Chip input component ─────────────────────────────────────────────────────

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
            ×
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

// ─── Section box wrapper ──────────────────────────────────────────────────────

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

// ─── Main Component ───────────────────────────────────────────────────────────

export function Onboarding({ user, theme, setTheme, onNavigate }: OnboardingProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [keywords, setKeywords] = useState<string[]>([]);
  const [senders, setSenders] = useState<string[]>([]);
  const [labelChips, setLabelChips] = useState<string[]>([]);
  const [intentBoxes, setIntentBoxes] = useState<string[]>(['']);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingStep1, setSavingStep1] = useState(false);

  // Step 2 state (existing label priority)
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelDesc, setNewLabelDesc] = useState('');

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const API_URL = 'http://localhost:5000';
  const token = localStorage.getItem('firebaseToken');
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  // Load inferred data from UserIntentProfile on mount
  useEffect(() => {
    const fetchProfile = async () => {
      if (!token) { setLoadingProfile(false); return; }
      try {
        const { data } = await axios.get(`${API_URL}/api/intent/profile`, { headers });
        if (data.success && data.profile) {
          const p = data.profile;
          // Merge inferred + include lists for display (start from what was detected)
          setKeywords([...new Set([...(p.inferredKeywords || []), ...(p.includeKeywords || [])])]);
          setSenders([...new Set([...(p.inferredDomains || []), ...(p.preferredDomains || [])])]);
          setLabelChips([...new Set([...(p.inferredLabels || [])])]);
          if (p.userPrompt && p.userPrompt.length > 0) {
            setIntentBoxes(p.userPrompt);
          }
        }
      } catch (err) {
        console.error('[Onboarding] Failed to load intent profile:', err);
      } finally {
        setLoadingProfile(false);
      }
    };
    void fetchProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load label priorities for step 2
  useEffect(() => {
    const fetchPriorities = async () => {
      if (!user?.gmailAccountId || !token) { setLoadingLabels(false); return; }
      try {
        const { data } = await axios.get(
          `${API_URL}/api/emails/label-priorities?accountId=${user.gmailAccountId}`,
          { headers }
        );
        if (data.success && data.priorities) {
          const mapped: LabelItem[] = data.priorities.map((p: any) => ({
            id: p.labelId,
            name: p.labelNameSnapshot,
            desc: '',
            isSystem: ['Focus', 'Action Required', 'Newsletters'].includes(p.labelNameSnapshot),
          }));
          setLabels(mapped);
        }
      } catch (err) {
        console.error('[Onboarding] Failed to fetch priorities:', err);
      } finally {
        setLoadingLabels(false);
      }
    };
    void fetchPriorities();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ─── Step 1 handlers ───────────────────────────────────────────────────────

  const addIntentBox = () => setIntentBoxes((prev) => [...prev, '']);

  const removeIntentBox = (idx: number) =>
    setIntentBoxes((prev) => prev.filter((_, i) => i !== idx));

  const updateIntentBox = (idx: number, val: string) =>
    setIntentBoxes((prev) => prev.map((v, i) => (i === idx ? val : v)));

  const saveStep1AndContinue = async () => {
    setSavingStep1(true);
    try {
      const filledPrompts = intentBoxes.filter((b) => b.trim().length > 0);
      await axios.post(
        `${API_URL}/api/intent/profile`,
        {
          includeKeywords: keywords,
          preferredDomains: senders,
          inferredLabels: labelChips,
          userPrompt: filledPrompts,
          onboardingCompleted: true,
        },
        { headers }
      );
    } catch (err) {
      console.error('[Onboarding] Failed to save intent profile:', err);
    } finally {
      setSavingStep1(false);
      setStep(2);
    }
  };

  const skipStep1 = async () => {
    try {
      await axios.post(`${API_URL}/api/intent/profile`, { onboardingCompleted: true }, { headers });
    } catch {
      // Non-blocking
    }
    setStep(2);
  };

  // ─── Step 2 handlers (unchanged from original) ─────────────────────────────

  const handleSort = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      const _labels = [...labels];
      const dragged = _labels.splice(dragItem.current, 1)[0];
      _labels.splice(dragOverItem.current, 0, dragged);
      setLabels(_labels);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleAddLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabelName.trim() || !user?.gmailAccountId || !token) return;
    try {
      setSaving(true);
      const { data } = await axios.post(
        `${API_URL}/api/emails/labels`,
        { accountId: user.gmailAccountId, name: newLabelName.trim(), description: newLabelDesc.trim() },
        { headers }
      );
      if (data.success && data.label) {
        setLabels([...labels, { id: data.label._id, name: data.label.name, desc: data.label.description || '', isSystem: false }]);
        setNewLabelName('');
        setNewLabelDesc('');
      }
    } catch (err: any) {
      console.error('[Onboarding] Failed to create label:', err);
      if (err.response?.status === 409) {
        alert('Label already exists.');
      } else {
        alert('Failed to create label.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!user?.gmailAccountId || !token) { onNavigate('dashboard'); return; }
    try {
      setSaving(true);
      await axios.put(
        `${API_URL}/api/emails/label-priorities`,
        { accountId: user.gmailAccountId, orderedLabelIds: labels.map((l) => l.id) },
        { headers }
      );
      await axios.post(
        `${API_URL}/api/emails/label-priorities/review`,
        { accountId: user.gmailAccountId },
        { headers }
      );
      onNavigate('syncing' as any);
    } catch (err) {
      console.error('[Onboarding] Failed to save priorities:', err);
      alert('Failed to save priority order.');
      setSaving(false);
    }
  };

  // ─── Shared header ─────────────────────────────────────────────────────────

  const Header = () => (
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
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 600 }}>
        Emty Setup
      </div>
      <div className="bar-r" style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div className="btn-group" style={{ display: 'flex', margin: 0 }}>
          <button className={`tgl-btn ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>Light</button>
          <button className={`tgl-btn ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>
    </div>
  );

  const StepIndicator = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px' }}>
      {[1, 2].map((s) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: step === s ? 'var(--text-1)' : 'var(--surface-2)',
              border: `1px solid ${step === s ? 'var(--text-1)' : 'var(--border)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: step === s ? 'var(--bg)' : 'var(--text-3)',
            }}
          >
            {s}
          </div>
          {s < 2 && (
            <div style={{ width: '24px', height: '1px', background: 'var(--border)' }} />
          )}
        </div>
      ))}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', marginLeft: '4px' }}>
        Step {step} of 2
      </span>
    </div>
  );

  // ─── Step 1 render ─────────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
        <Header />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: '640px' }}>
            <StepIndicator />

            <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>
              Help us understand your inbox
            </h1>
            <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px', lineHeight: 1.6 }}>
              Based on your recent emails, here are some patterns we noticed.
              Remove anything that does not apply, or add your own.
              {loadingProfile && (
                <span style={{ marginLeft: '8px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                  Loading...
                </span>
              )}
            </p>

            <SectionBox
              title="Topics and keywords we noticed"
              subtitle="These show up often in your emails. Keep the ones that matter to you."
            >
              <ChipInput
                chips={keywords}
                onAdd={(v) => setKeywords((k) => [...k, v])}
                onRemove={(v) => setKeywords((k) => k.filter((x) => x !== v))}
                placeholder="e.g. invoice"
              />
            </SectionBox>

            <SectionBox
              title="Senders we think matter"
              subtitle="These domains send you frequent emails. Remove any that are not important."
            >
              <ChipInput
                chips={senders}
                onAdd={(v) => setSenders((s) => [...s, v])}
                onRemove={(v) => setSenders((s) => s.filter((x) => x !== v))}
                placeholder="e.g. company.com"
              />
            </SectionBox>

            <SectionBox
              title="Labels you care about"
              subtitle="Labels from your inbox we saw being used. Adjust to fit your workflow."
            >
              <ChipInput
                chips={labelChips}
                onAdd={(v) => setLabelChips((l) => [...l, v])}
                onRemove={(v) => setLabelChips((l) => l.filter((x) => x !== v))}
                placeholder="e.g. Action Required"
              />
            </SectionBox>

            <SectionBox
              title="Add specific instructions (optional)"
              subtitle="Tell us exactly what matters, one idea at a time. You can always add more later."
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {intentBoxes.map((box, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                    {intentBoxes.length > 1 && (
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <button
                onClick={skipStep1}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-3)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '8px 0',
                }}
              >
                Skip for now
              </button>
              <button
                onClick={saveStep1AndContinue}
                disabled={savingStep1}
                style={{
                  background: 'var(--text-1)',
                  color: 'var(--bg)',
                  border: '1px solid var(--text-1)',
                  padding: '10px 24px',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-ui)',
                  cursor: savingStep1 ? 'not-allowed' : 'pointer',
                  opacity: savingStep1 ? 0.7 : 1,
                }}
              >
                {savingStep1 ? 'Saving...' : 'Save and continue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2 render (label priority — original content) ─────────────────────

  return (
    <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <div className="onb-inner" style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: '640px' }}>
          <StepIndicator />

          <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>Inbox Priorities</h1>
          <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px', lineHeight: 1.5 }}>
            Define the labels we use to organize your inbox. Drag and drop them to set your routing priority — top is highest priority.
          </p>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: '32px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-lt)', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)' }}>Priority Stack</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', background: 'var(--surface-2)', padding: '2px 6px', border: '1px solid var(--border-lt)', color: 'var(--text-3)' }}>Drag to reorder</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {loadingLabels ? (
                <div style={{ padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)' }}>Loading...</div>
              ) : labels.map((lbl, index) => (
                <div
                  key={lbl.id}
                  draggable
                  onDragStart={(e) => { dragItem.current = index; e.currentTarget.style.opacity = '0.5'; }}
                  onDragEnter={() => { dragOverItem.current = index; }}
                  onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; handleSort(); }}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '16px 20px',
                    borderBottom: index === labels.length - 1 ? 'none' : '1px solid var(--border-lt)',
                    background: 'var(--surface)', cursor: 'grab',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                >
                  <div style={{ marginRight: '16px', color: 'var(--text-3)', cursor: 'grab' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600 }}>{lbl.name}</span>
                      {lbl.isSystem && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8.5px', background: 'var(--border-lt)', padding: '2px 6px', fontWeight: 600 }}>SYSTEM</span>}
                    </div>
                    {lbl.desc && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', marginTop: '4px' }}>{lbl.desc}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: '32px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-lt)', background: 'var(--panel)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)' }}>Add Custom Label</span>
            </div>
            <form onSubmit={handleAddLabel} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '6px' }}>Label Name</label>
                <input type="text" value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} placeholder="e.g. Invoices"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', padding: '10px 14px', color: 'var(--text-1)', fontFamily: 'var(--font-ui)', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '6px' }}>Description (Optional)</label>
                <input type="text" value={newLabelDesc} onChange={(e) => setNewLabelDesc(e.target.value)} placeholder="e.g. Anything related to billing"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', padding: '10px 14px', color: 'var(--text-1)', fontFamily: 'var(--font-ui)', fontSize: '13px' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button type="submit" disabled={!newLabelName.trim() || saving}
                  style={{ background: 'var(--accent)', color: 'var(--accent-inv)', border: '1px solid var(--accent)', padding: '8px 16px', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-ui)', cursor: newLabelName.trim() && !saving ? 'pointer' : 'not-allowed', opacity: newLabelName.trim() && !saving ? 1 : 0.5 }}>
                  {saving ? 'Adding...' : 'Add Label'}
                </button>
              </div>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => onNavigate('dashboard')} disabled={saving}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: '8px 0' }}>
              Skip
            </button>
            <button onClick={handleConfirm} disabled={saving || loadingLabels}
              style={{ background: 'var(--text-1)', color: 'var(--bg)', border: '1px solid var(--text-1)', padding: '10px 24px', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-ui)', cursor: saving || loadingLabels ? 'not-allowed' : 'pointer', opacity: saving || loadingLabels ? 0.7 : 1 }}>
              {saving ? 'Saving...' : 'Confirm Priorities'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
