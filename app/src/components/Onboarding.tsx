import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

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

export function Onboarding({ user, theme, setTheme, onNavigate }: OnboardingProps) {
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelDesc, setNewLabelDesc] = useState('');

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const API_URL = 'http://localhost:5000';
  const token = localStorage.getItem('firebaseToken');

  useEffect(() => {
    const fetchInitialPriorities = async () => {
      if (!user?.gmailAccountId || !token) return;
      
      try {
        setLoading(true);
        const { data } = await axios.get(`${API_URL}/api/emails/labels/priority?accountId=${user.gmailAccountId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (data.success && data.priorities) {
          // Map backend priorities to UI LabelItem
          const mappedLabels: LabelItem[] = data.priorities.map((p: any) => ({
             id: p.labelId,
             name: p.labelNameSnapshot,
             desc: '', // Priorities payload doesn't include desc, but that's fine for UI
             isSystem: ['Focus', 'Action Required', 'Newsletters'].includes(p.labelNameSnapshot)
          }));
          setLabels(mappedLabels);
        }
      } catch (err) {
        console.error('Failed to fetch initial priorities', err);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialPriorities();
  }, [user]);

  const handleSort = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      const _labels = [...labels];
      const draggedItemContent = _labels.splice(dragItem.current, 1)[0];
      _labels.splice(dragOverItem.current, 0, draggedItemContent);
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
      const { data } = await axios.post(`${API_URL}/api/emails/labels`, {
        accountId: user.gmailAccountId,
        name: newLabelName.trim(),
        description: newLabelDesc.trim()
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (data.success && data.label) {
        const newLabel: LabelItem = {
          id: data.label._id,
          name: data.label.name,
          desc: data.label.description || '',
          isSystem: false
        };
        
        // Add to bottom of stack
        setLabels([...labels, newLabel]);
        setNewLabelName('');
        setNewLabelDesc('');
      }
    } catch (err: any) {
      console.error('Failed to create label', err);
      if (err.response?.status === 409) {
          alert('Label already exists. It may be hidden or already active.');
      } else {
          alert('Failed to create label.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (!user?.gmailAccountId || !token) {
      onNavigate('dashboard');
      return;
    }

    try {
      setSaving(true);
      // 1. Save priority order
      const orderedLabelIds = labels.map(l => l.id);
      await axios.put(`${API_URL}/api/emails/labels/priority`, {
        accountId: user.gmailAccountId,
        orderedLabelIds
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // 2. Mark as reviewed
      await axios.post(`${API_URL}/api/emails/labels/priority/review`, {
        accountId: user.gmailAccountId
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      onNavigate('dashboard');
    } catch (err) {
      console.error('Failed to save priorities', err);
      alert('Failed to save priority order.');
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header */}
      <div className="bar" style={{ display: 'flex', alignItems: 'center', padding: '0 24px', borderBottom: '2px solid var(--border)', background: 'var(--surface)', height: '48px' }}>
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

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '60px 20px', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: '640px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Inbox Priorities</h1>
          <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px', lineHeight: 1.5 }}>
            Define the labels we use to organize your inbox. Drag and drop them to set your routing priority (top is highest priority).
          </p>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: '32px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-lt)', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)' }}>Priority Stack</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', background: 'var(--surface-2)', padding: '2px 6px', border: '1px solid var(--border-lt)', color: 'var(--text-3)' }}>Drag to reorder</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {labels.map((lbl, index) => (
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
                    background: 'var(--surface)', cursor: 'grab' 
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'var(--surface)'}
                >
                  <div style={{ marginRight: '16px', color: 'var(--text-3)', cursor: 'grab' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
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
                <input 
                  type="text" 
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  placeholder="e.g. Invoices"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', padding: '10px 14px', color: 'var(--text-1)', fontFamily: 'var(--font-ui)', fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '6px' }}>Description (Optional)</label>
                <input 
                  type="text" 
                  value={newLabelDesc}
                  onChange={(e) => setNewLabelDesc(e.target.value)}
                  placeholder="e.g. Anything related to billing"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', padding: '10px 14px', color: 'var(--text-1)', fontFamily: 'var(--font-ui)', fontSize: '13px' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button type="submit" disabled={!newLabelName.trim() || saving} style={{ background: 'var(--accent)', color: 'var(--accent-inv)', border: '1px solid var(--accent)', padding: '8px 16px', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-ui)', cursor: newLabelName.trim() && !saving ? 'pointer' : 'not-allowed', opacity: newLabelName.trim() && !saving ? 1 : 0.5 }}>
                  {saving ? 'Adding...' : 'Add Label'}
                </button>
              </div>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button 
              onClick={() => onNavigate('dashboard')}
              disabled={saving}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: '8px 0' }}
            >
              Skip
            </button>
            <button 
              onClick={handleConfirm}
              disabled={saving || loading}
              style={{ background: 'var(--text-1)', color: 'var(--bg)', border: '1px solid var(--text-1)', padding: '10px 24px', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-ui)', cursor: saving || loading ? 'not-allowed' : 'pointer', opacity: saving || loading ? 0.7 : 1 }}
            >
              {saving ? 'Saving...' : 'Confirm Priorities'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
