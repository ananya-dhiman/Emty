import { Logo } from './Logo';

interface ConnectGmailProps {
  onConnect: () => void;
  loading?: boolean;
}

export function ConnectGmail({ onConnect, loading }: ConnectGmailProps) {
  return (
    <div className="auth-container">
      <div className="shell auth-shell" style={{ minHeight: '360px' }}>
        <div className="bar auth-bar">
          <div className="bar-logo" style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <div className="logo-block" style={{color: 'var(--accent-inv)'}}>
              <Logo size={14} onAccent />
            </div>
            <span style={{color: 'var(--accent-inv)', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600}}>Emty</span>
          </div>
        </div>
        <div className="auth-content">
          <div className="auth-form" style={{ textAlign: 'center' }}>
            <h2 className="auth-title">Connect your Inbox</h2>
            <p className="auth-subtitle">Emty requires access to your Gmail to organize your messages.</p>
            
            <button
              onClick={onConnect}
              disabled={loading}
              className="btn-primary auth-btn"
              style={{ background: '#EA4335', color: '#fff', borderColor: '#EA4335', marginTop: '16px' }}
              onMouseEnter={(e) => {
                  if (!loading) {
                      e.currentTarget.style.background = '#d33425';
                      e.currentTarget.style.borderColor = '#d33425';
                  }
              }}
              onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#EA4335';
                  e.currentTarget.style.borderColor = '#EA4335';
              }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" style={{ fill: 'white', marginRight: '8px' }}>
                  <path d="M10 0c5.523 0 10 4.477 10 10s-4.477 10-10 10S0 15.523 0 10 4.477 0 10 0z" fill="white" opacity="0.1"/>
                  <text x="10" y="14" textAnchor="middle" fontSize="12" fill="white" fontWeight="bold">G</text>
              </svg>
              {loading ? 'Connecting...' : 'Authorize Gmail Access'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
