import { useState } from 'react';

interface Account {
  id: string;
  email: string;
  provider: string;
}

interface ProfileProps {
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'dashboard') => void;
}

export function Profile({ user, theme, setTheme, onNavigate }: ProfileProps) {
  const [accounts, setAccounts] = useState<Account[]>([
    { id: '1', email: user?.email || 'user@example.com', provider: 'Google' },
    { id: '2', email: 'work@company.com', provider: 'Google' }
  ]);

  const handleLogoutAccount = (id: string) => {
    // In a real app, this would trigger a backend sign-out for this specific account
    setAccounts(accounts.filter(a => a.id !== id));
  };

  return (
    <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
      {/* Header matching dashboard .bar */}
      <div className="bar" style={{ display: 'flex', alignItems: 'center', padding: '0 24px', borderBottom: '2px solid var(--border)', background: 'var(--surface)', height: '48px' }}>
        <button 
          onClick={() => onNavigate('dashboard')} 
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-2)', fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 600 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          Back to Dashboard
        </button>
        
        <div className="bar-r" style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div className="btn-group" style={{ display: 'flex', margin: 0 }}>
            <button className={`tgl-btn ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')}>Light</button>
            <button className={`tgl-btn ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '60px 20px' }}>
        <div style={{ width: '100%', maxWidth: '600px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Profile Settings</h1>
          <p style={{ color: 'var(--text-3)', fontSize: '13px', marginBottom: '32px' }}>Manage your connected accounts.</p>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'none' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-lt)', background: 'var(--panel)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)' }}>Connected Accounts</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {accounts.map(acc => (
                <div key={acc.id} style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border-lt)' }}>
                  <div style={{ width: '36px', height: '36px', background: 'var(--accent)', color: 'var(--accent-inv)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '14px', marginRight: '16px' }}>
                    {acc.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{acc.email}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', marginTop: '4px' }}>Connected via {acc.provider}</div>
                  </div>
                  <button 
                    onClick={() => handleLogoutAccount(acc.id)}
                    style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-ui)', background: 'var(--surface)', color: 'var(--red)', border: '1px solid var(--border-lt)', cursor: 'pointer', transition: 'background 0.2s' }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'var(--red-bg)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'var(--surface)'}
                  >
                    Log Out
                  </button>
                </div>
              ))}
              {accounts.length === 0 && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-3)', fontSize: '14px' }}>No accounts connected.</div>
              )}
            </div>
            
            <div style={{ padding: '20px', background: 'var(--surface)', display: 'flex', justifyContent: 'center' }}>
              <button 
                style={{ padding: '10px 16px', background: 'transparent', border: '1.5px dashed var(--border)', color: 'var(--text-2)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: '100%', transition: 'background 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                + Add Another Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
