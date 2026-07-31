/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useEffect } from 'react';
import { GraduationCap, Briefcase, Settings } from 'lucide-react';
import axios from 'axios';
import '../styles/Dashboard.css';
import { API_BASE_URL } from '../utils/api';

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
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [profileType, setProfileType] = useState<'student' | 'working_professional' | 'custom' | null>(null);

  // Step 2 state (previously Step 1)
  const [keywords, setKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [senders, setSenders] = useState<string[]>([]);
  const [blockedDomains, setBlockedDomains] = useState<string[]>([]);
  const [labelChips, setLabelChips] = useState<string[]>([]);
  const [intentBoxes, setIntentBoxes] = useState<string[]>(['']);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingStep2, setSavingStep2] = useState(false);

  // Step 3 state — Groq API key
  const [groqApiKey, setGroqApiKey]         = useState('');
  const [groqVerifying, setGroqVerifying]   = useState(false);
  const [groqError, setGroqError]           = useState<string | null>(null);
  const [groqVerified, setGroqVerified]     = useState(false);

  // Step 4 state (previously Step 3 — label priority)
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelDesc, setNewLabelDesc] = useState('');

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const token = localStorage.getItem('firebaseToken');
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  // Load existing preference data from UserIntentProfile on mount
  useEffect(() => {
    const fetchProfile = async () => {
      if (!token) { setLoadingProfile(false); return; }
      try {
        const { data } = await axios.get(`${API_BASE_URL}/api/intent/profile`, { headers });
        if (data.success && data.profile) {
          const p = data.profile;
          if (p.profileType) setProfileType(p.profileType);
          setKeywords([...new Set([...(p.includeKeywords || [])])]);
          setExcludeKeywords([...new Set([...(p.excludeKeywords || [])])]);
          setSenders([...new Set([...(p.preferredDomains || [])])]);
          setBlockedDomains([...new Set([...(p.blockedDomains || [])])]);
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

  // Load label priorities for step 3
  useEffect(() => {
    const fetchPriorities = async () => {
      if (!user?.gmailAccountId || !token) { setLoadingLabels(false); return; }
      try {
        const { data } = await axios.get(
          `${API_BASE_URL}/api/emails/label-priorities?accountId=${user.gmailAccountId}`,
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

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleProfileSelect = (type: 'student' | 'working_professional' | 'custom') => {
    setProfileType(type);
    let newKeywords: string[] = [];
    let newExcludeKeywords: string[] = [];
    let newSenders: string[] = [];
    let newBlockedDomains: string[] = [];
    let newLabels: string[] = [];

    const emailDomain = user?.email?.split('@')[1];

    if (type === 'student') {
      newSenders = [
        'internshala.com', 'unstop.com', 'naukri.com', 'linkedin.com', 'wellfound.com', 'glassdoor.co.in',
        'geeksforgeeks.org', 'hackerrank.com', 'leetcode.com', 'hackerearth.com', 'codechef.com', 'codeforces.com',
        'github.com', 'stackoverflow.com', 'udemy.com', 'coursera.org', 'nptel.ac.in',
        'devfolio.co', 'mlh.io', 'aicte-india.org', 'ugc.ac.in', 'mygov.in'
      ];
      newKeywords = [
        'internship', 'placement', 'job opportunity', 'hiring', 'recruitment', 'interview', 'application', 'shortlisted', 'selected', 'offer letter',
        'assignment', 'submission', 'deadline', 'exam', 'result', 'grade', 'project', 'semester',
        'hackathon', 'competition', 'workshop', 'webinar', 'conference', 'scholarship', 'fellowship',
        'action required', 'urgent', 'important', 'verify', 'confirm'
      ];
      newExcludeKeywords = [
        'casino', 'betting', 'lottery', 'prize won', 'congratulations you won', 'click here to claim', 'limited time offer', 'buy now', 'shop now',
        'personal loan', 'credit card offer', 'instant loan', 'easy money',
        'dating', 'singles near you', 'meet singles',
        'unsubscribe here', 'stop receiving', 'mlm', 'multi-level marketing'
      ];
      newBlockedDomains = ['*.casino', '*.betting', '*.loan', '*.dating'];
      newLabels = ['Needs Action', 'Opportunities', 'Academic'];
    } else if (type === 'working_professional') {
      newSenders = [
        'slack.com', 'teams.microsoft.com', 'zoom.us', 'meet.google.com', 'webex.com',
        'atlassian.com', 'asana.com', 'monday.com', 'trello.com', 'notion.so', 'clickup.com',
        'linkedin.com', 'github.com', 'gitlab.com',
        'adp.com', 'workday.com', 'greythr.com', 'darwinbox.com', 'razorpay.com', 'stripe.com',
        'aws.amazon.com', 'azure.microsoft.com', 'cloud.google.com', 'vercel.com', 'netlify.com',
        'calendly.com', 'cal.com'
      ];
      newKeywords = [
        'meeting', 'call scheduled', 'calendar invite', 'reschedule',
        'deadline', 'due date', 'action required', 'urgent', 'priority', 'approval needed', 'review required', 'sign off',
        'project update', 'status report', 'milestone', 'deliverable', 'sprint', 'standup',
        'payroll', 'leave', 'attendance', 'timesheet', 'expense', 'reimbursement',
        'invoice', 'payment', 'contract', 'agreement', 'NDA', 'policy',
        'training', 'certification', 'performance review', 'feedback'
      ];
      newExcludeKeywords = [
        'unsubscribe', 'promotional', 'newsletter', 'weekly digest', 'marketing', 'advertisement',
        'sale', 'discount', 'offer', 'deal', 'coupon', 'shop now',
        'earn money', 'work from home opportunity', 'side hustle', 'make money online', 'casino', 'lottery', 'prize'
      ];
      newBlockedDomains = ['*.promotional', '*.marketing', 'noreply@offers'];
      newLabels = ['Needs Action', 'Meetings', 'Projects', 'HR & Admin'];
    } else if (type === 'custom') {
      newSenders = [];
      newKeywords = ['urgent', 'action required', 'deadline', 'important'];
      newExcludeKeywords = ['casino', 'lottery', 'betting', 'you won', 'claim prize'];
      newBlockedDomains = [];
      newLabels = ['Needs Action'];
    }

    if (emailDomain && !newSenders.includes(emailDomain)) {
      newSenders.unshift(emailDomain);
    }

    setKeywords(newKeywords);
    setExcludeKeywords(newExcludeKeywords);
    setSenders(newSenders);
    setBlockedDomains(newBlockedDomains);
    setLabelChips(newLabels);
    setStep(2);
  };

  // ─── Step 1 handlers ───────────────────────────────────────────────────────

  const addIntentBox = () => setIntentBoxes((prev) => [...prev, '']);

  const removeIntentBox = (idx: number) =>
    setIntentBoxes((prev) => prev.filter((_, i) => i !== idx));

  const updateIntentBox = (idx: number, val: string) =>
    setIntentBoxes((prev) => prev.map((v, i) => (i === idx ? val : v)));

  const saveStep2AndContinue = async () => {
    setSavingStep2(true);
    try {
      const filledPrompts = intentBoxes.filter((b) => b.trim().length > 0);
      await axios.post(
        `${API_BASE_URL}/api/intent/profile`,
        {
          profileType,
          includeKeywords: keywords,
          excludeKeywords,
          preferredDomains: senders,
          blockedDomains,
          inferredLabels: labelChips,
          userPrompt: filledPrompts,
        },
        { headers }
      );
    } catch (err) {
      console.error('[Onboarding] Failed to save intent profile:', err);
    } finally {
      setSavingStep2(false);
      setStep(3); // advance to Groq key step
    }
  };

  const skipStep2 = async () => {
    setStep(3); // skip preferences, still show Groq step
  };

  // ─── Step 3 handlers (Groq key) ────────────────────────────────────────────

  const handleVerifyAndSaveGroqKey = async () => {
    const trimmed = groqApiKey.trim();
    if (!trimmed) return;
    setGroqVerifying(true);
    setGroqError(null);
    try {
      // Verify with Groq — just a model-list call, zero email data sent
      const verifyRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!verifyRes.ok) {
        setGroqError('Invalid key — please check and try again');
        return;
      }
      // Persist encrypted key to backend
      await axios.post(
        `${API_BASE_URL}/api/intent/profile`,
        { groqApiKey: trimmed },
        { headers }
      );
      setGroqVerified(true);
      setTimeout(() => setStep(4), 800); // brief success pause before advancing
    } catch {
      setGroqError('Verification failed — check your connection and try again');
    } finally {
      setGroqVerifying(false);
    }
  };

  const handleSkipGroq = async () => {
    try {
      await axios.post(
        `${API_BASE_URL}/api/intent/profile`,
        { aiProvider: null },
        { headers }
      );
    } catch {
      // Non-blocking — skip silently
    }
    setStep(4);
  };

  const handleSort = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      const _labels = [...labels];
      const dragged = _labels.splice(dragItem.current, 1)[0];
      _labels.splice(dragOverItem.current, 0, dragged);
      setLabels(_labels);
    }
  };

  const handleAddLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabelName.trim() || !user?.gmailAccountId || !token) return;
    try {
      setSaving(true);
      const { data } = await axios.post(
        `${API_BASE_URL}/api/emails/labels`,
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

  const completeOnboardingAndStartProcessing = async () => {
    await axios.post(
      `${API_BASE_URL}/api/intent/profile`,
      { onboardingCompleted: true },
      { headers }
    );
  };

  const handleConfirm = async () => {
    console.log('[Onboarding] handleConfirm called. gmailAccountId:', user?.gmailAccountId, 'hasToken:', !!token);
    if (!user?.gmailAccountId || !token) { onNavigate('dashboard'); return; }
    try {
      setSaving(true);
      await axios.put(
        `${API_BASE_URL}/api/emails/label-priorities`,
        { accountId: user.gmailAccountId, orderedLabelIds: labels.map((l) => l.id) },
        { headers }
      );
      await axios.post(
        `${API_BASE_URL}/api/emails/label-priorities/review`,
        { accountId: user.gmailAccountId },
        { headers }
      );

      await completeOnboardingAndStartProcessing();
      
      // User opted for live-stream dashboard! Route immediately to dashboard
      // where emails will pop in as the background worker runs.
      onNavigate('dashboard');
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
      {[1, 2, 3, 4].map((s) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: step >= s ? 'var(--text-1)' : 'var(--surface-2)',
              border: `1px solid ${step >= s ? 'var(--text-1)' : 'var(--border)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: step >= s ? 'var(--bg)' : 'var(--text-3)',
            }}
          >
            {s}
          </div>
          {s < 4 && (
            <div style={{ width: '24px', height: '1px', background: step > s ? 'var(--text-1)' : 'var(--border)' }} />
          )}
        </div>
      ))}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', marginLeft: '4px' }}>
        Step {step} of 4
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
              What best describes you?
            </h1>
            <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px', lineHeight: 1.6 }}>
              Pick a profile to pre-fill smart defaults for your inbox.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div 
                onClick={() => handleProfileSelect('student')}
                style={{ 
                  padding: '24px', border: '1px solid var(--border)', borderRadius: '12px', 
                  display: 'flex', alignItems: 'center', gap: '20px', cursor: 'pointer',
                  background: 'var(--surface)', transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-1)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: '50%' }}>
                  <GraduationCap size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px 0' }}>Student</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>Internships, placements, and academic emails</p>
                </div>
              </div>

              <div 
                onClick={() => handleProfileSelect('working_professional')}
                style={{ 
                  padding: '24px', border: '1px solid var(--border)', borderRadius: '12px', 
                  display: 'flex', alignItems: 'center', gap: '20px', cursor: 'pointer',
                  background: 'var(--surface)', transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-1)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: '50%' }}>
                  <Briefcase size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px 0' }}>Working Professional</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>Meetings, projects, and work communications</p>
                </div>
              </div>

              <div 
                onClick={() => handleProfileSelect('custom')}
                style={{ 
                  padding: '24px', border: '1px solid var(--border)', borderRadius: '12px', 
                  display: 'flex', alignItems: 'center', gap: '20px', cursor: 'pointer',
                  background: 'var(--surface)', transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--text-1)'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: '50%' }}>
                  <Settings size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px 0' }}>Custom</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-3)' }}>Start from scratch — Emty learns as you go</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2 render (previously Step 1) ─────────────────────────────────────

  if (step === 2) {
    return (
      <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
        <Header />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: '640px' }}>
            <StepIndicator />

            <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>
              Tune your inbox filter
            </h1>
            <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px', lineHeight: 1.6 }}>
              Review the defaults we set for your profile. Remove anything that doesn't fit, or add your own.
              {loadingProfile && (
                <span style={{ marginLeft: '8px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                  Loading...
                </span>
              )}
            </p>

            <SectionBox
              title="Custom instructions (optional)"
              subtitle="Describe what matters to you. Add one idea per line."
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

            <SectionBox
              title="Keywords to watch"
              subtitle="Keep topics that appear often in emails you care about."
            >
              <ChipInput
                chips={keywords}
                onAdd={(v) => setKeywords((k) => [...k, v])}
                onRemove={(v) => setKeywords((k) => k.filter((x) => x !== v))}
                placeholder="e.g. invoice"
              />
            </SectionBox>

            <SectionBox
              title="Important senders"
              subtitle="Domains whose emails you want prioritized. Remove any that don't apply."
            >
              <ChipInput
                chips={senders}
                onAdd={(v) => setSenders((s) => [...s, v])}
                onRemove={(v) => setSenders((s) => s.filter((x) => x !== v))}
                placeholder="e.g. company.com"
              />
            </SectionBox>

            <SectionBox
              title="Labels"
              subtitle="Labels used to sort your inbox. Add or remove to match your workflow."
            >
              <ChipInput
                chips={labelChips}
                onAdd={(v) => setLabelChips((l) => [...l, v])}
                onRemove={(v) => setLabelChips((l) => l.filter((x) => x !== v))}
                placeholder="e.g. Action Required"
              />
            </SectionBox>



            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <button
                onClick={skipStep2}
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
                onClick={saveStep2AndContinue}
                disabled={savingStep2}
                style={{
                  background: 'var(--text-1)',
                  color: 'var(--bg)',
                  border: '1px solid var(--text-1)',
                  padding: '10px 24px',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-ui)',
                  cursor: savingStep2 ? 'not-allowed' : 'pointer',
                  opacity: savingStep2 ? 0.7 : 1,
                }}
              >
                {savingStep2 ? 'Saving...' : 'Save and continue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 3 render — Groq API key ──────────────────────────────────────────

  if (step === 3) {
    return (
      <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
        <Header />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: '640px' }}>
            <StepIndicator />

            <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>
              Add your Groq API key
            </h1>
            <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '8px', lineHeight: 1.6 }}>
              Groq powers Emty's AI analysis using Llama 3.3 70B — it's free (14,400 requests/day) and required to continue.
            </p>
            <p style={{ color: 'var(--text-3)', fontSize: '12px', marginBottom: '28px', lineHeight: 1.6 }}>
              Sensitive emails (financial, medical, legal) are always processed locally — never sent to any cloud.
            </p>

            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '20px', marginBottom: '20px' }}>
              <label
                htmlFor="groq-key-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)', display: 'block', marginBottom: '10px' }}
              >
                Groq API Key
              </label>
              <input
                id="groq-key-input"
                type="password"
                value={groqApiKey}
                onChange={(e) => { setGroqApiKey(e.target.value); setGroqError(null); }}
                placeholder="gsk_..."
                disabled={groqVerifying || groqVerified}
                style={{
                  width: '100%',
                  background: 'var(--bg)',
                  border: `1px solid ${groqError ? 'var(--red)' : 'var(--border)'}`,
                  padding: '10px 14px',
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-1)',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ marginTop: '10px' }}>
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)' }}
                >
                  Get your free Groq API key at console.groq.com/keys
                </a>
              </div>

              {groqError && (
                <p style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--red)' }}>
                  {groqError}
                </p>
              )}

              {groqVerified && (
                <p style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--green)' }}>
                  Key verified and saved successfully
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button
                id="groq-verify-btn"
                onClick={handleVerifyAndSaveGroqKey}
                disabled={!groqApiKey.trim() || groqVerifying || groqVerified}
                style={{
                  background: 'var(--text-1)',
                  color: 'var(--bg)',
                  border: '1px solid var(--text-1)',
                  padding: '10px 24px',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-ui)',
                  cursor: (!groqApiKey.trim() || groqVerifying || groqVerified) ? 'not-allowed' : 'pointer',
                  opacity: (!groqApiKey.trim() || groqVerifying || groqVerified) ? 0.6 : 1,
                }}
              >
                {groqVerifying ? 'Verifying...' : groqVerified ? 'Verified' : 'Verify & Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 4 render (label priority — original Step 3 content) ──────────────

  return (
    <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <div className="onb-inner" style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 20px', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: '640px' }}>
          <StepIndicator />

          <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>Set your priorities</h1>
          <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px', lineHeight: 1.5 }}>
            Drag the labels below to rank what matters most. The top item gets the highest priority.
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
                  onDragStart={(e) => {
                    dragItem.current = index;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', index.toString());
                    const el = e.currentTarget as HTMLElement;
                    requestAnimationFrame(() => {
                      el.style.opacity = '0.4';
                    });
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    if (dragItem.current !== null && dragItem.current !== index) {
                      dragOverItem.current = index;
                      handleSort();
                      dragItem.current = index; // Update dragItem current to new position after sort
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDragEnd={(e) => {
                    e.currentTarget.style.opacity = '1';
                    dragItem.current = null;
                    dragOverItem.current = null;
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dragItem.current = null;
                    dragOverItem.current = null;
                  }}
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
            <button
              onClick={async () => {
                console.log('[Onboarding] Step 2 Skip -> dashboard');
                if (!token) { onNavigate('dashboard'); return; }
                try {
                  setSaving(true);
                  await completeOnboardingAndStartProcessing();
                } catch (err) {
                  console.error('[Onboarding] Failed to complete onboarding on skip:', err);
                } finally {
                  onNavigate('dashboard');
                }
              }}
              disabled={saving}
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
