import { useState, useRef } from 'react';

interface LabelItem {
  id: string;
  name: string;
  desc: string;
  isSystem: boolean;
}

interface OnboardingProps {
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'dashboard') => void;
}

export function Onboarding({ theme, setTheme, onNavigate }: OnboardingProps) {
  const [labels, setLabels] = useState<LabelItem[]>([
    { id: '1', name: 'Focus', desc: 'High priority threads and internal team messages', isSystem: true },
    { id: '2', name: 'Action Required', desc: 'Emails directly demanding your response or attention', isSystem: true },
    { id: '3', name: 'Newsletters', desc: 'Subscriptions, updates, and general reading', isSystem: true },
  ]);

  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelDesc, setNewLabelDesc] = useState('');

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

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

  const handleAddLabel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabelName.trim()) return;
    
    const newLabel: LabelItem = {
      id: Date.now().toString(),
      name: newLabelName.trim(),
      desc: newLabelDesc.trim(),
      isSystem: false
    };
    
    // Add to top of stack by default or bottom? The requirements say "gets added in a stack like structure"
    setLabels([...labels, newLabel]);
    setNewLabelName('');
    setNewLabelDesc('');
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
                <button type="submit" disabled={!newLabelName.trim()} style={{ background: 'var(--accent)', color: 'var(--accent-inv)', border: '1px solid var(--accent)', padding: '8px 16px', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-ui)', cursor: newLabelName.trim() ? 'pointer' : 'not-allowed', opacity: newLabelName.trim() ? 1 : 0.5 }}>
                  Add Label
                </button>
              </div>
            </form>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button 
              onClick={() => onNavigate('dashboard')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', padding: '8px 0' }}
            >
              Skip
            </button>
            <button 
              onClick={() => onNavigate('dashboard')}
              style={{ background: 'var(--text-1)', color: 'var(--bg)', border: '1px solid var(--text-1)', padding: '10px 24px', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-ui)', cursor: 'pointer' }}
            >
              Confirm Priorities
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
