import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../index.css';

interface SyncLoadingProps {
  user: any;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  onNavigate: (route: 'dashboard') => void;
}

export function SyncLoading({ user, theme, setTheme, onNavigate }: SyncLoadingProps) {
  const [progress, setProgress] = useState(1);
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'completed' | 'error'>('syncing');
  const API_URL = 'http://localhost:5000'; 
  
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const hasInitiated = useRef(false);

  useEffect(() => {
    if (hasInitiated.current) return;
    hasInitiated.current = true;

    // 1. Start simulated progress
    progressInterval.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 99) {
          if (progressInterval.current) clearInterval(progressInterval.current);
          return 99;
        }
        
        const increment = Math.floor(Math.random() * 3) + 1;
        if (prev > 80 && Math.random() > 0.3) {
           return prev; 
        }
        
        return Math.min(prev + increment, 99);
      });
    }, 150);

    // 2. Start actual API Sync Call
    const initiateSync = async () => {
      try {
        const token = localStorage.getItem('firebaseToken');
        if (!user || !user.gmailAccountId) {
            console.warn("No user or gmailAccountId found. Skipping sync call.");
        } else {
            console.log("Initiating sync call to backend...");
            const response = await axios.post(`${API_URL}/api/emails/sync`, {
              accountId: user.gmailAccountId
            }, {
              headers: { Authorization: `Bearer ${token}` }
            });
            console.log("Sync call completed successfully.", response.data);
        }
        
        if (progressInterval.current) clearInterval(progressInterval.current);
        setProgress(100);
        setSyncStatus('completed');
        
        setTimeout(() => {
          onNavigate('dashboard');
        }, 1000);

      } catch (err: any) {
        console.error("Initial Sync Failed or Timed Out:", err);
        if (progressInterval.current) clearInterval(progressInterval.current);
        setProgress(99);
        setSyncStatus('error');
      }
    };

    initiateSync();

    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run exactly once on mount 


  return (
    <div style={{ minHeight: '100vh', width: '100vw', background: 'var(--bg)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column' }}>
      {/* Header with Theme Control */}
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

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', flexDirection: 'column' }}>
          <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              width: '100%', 
              maxWidth: '800px',
              gap: '40px',
              flexWrap: 'wrap'
            }}>
              
              {/* Massive Number Left Side */}
              <div style={{ 
                fontSize: 'clamp(8rem, 15vw, 16rem)', 
                fontWeight: 700, 
                fontFamily: 'var(--font-ui)',
                lineHeight: 1,
                color: syncStatus === 'error' ? 'var(--amber, #f8b02b)' : 'var(--text-1)',
                display: 'flex',
                alignItems: 'baseline'
              }}>
                {progress}
                <span style={{ fontSize: 'clamp(3rem, 5vw, 6rem)', color: 'var(--text-3)', marginLeft: '8px' }}>%</span>
              </div>

              {/* Status Message Right Side */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 600, fontFamily: 'var(--font-ui)', margin: 0 }}>
                  {syncStatus === 'syncing' ? 'Syncing your inbox...' : syncStatus === 'error' ? 'Sync taking longer than expected.' : 'Sync Complete!'}
                </h2>
                <p style={{ color: 'var(--text-3)', fontSize: '14px', fontFamily: 'var(--font-ui)', margin: 0, maxWidth: '280px', lineHeight: 1.5 }}>
                  {syncStatus === 'syncing' 
                    ? 'We are securely fetching and organizing your emails into your new priority stack.' 
                    : syncStatus === 'error'
                      ? 'The background sync is still running, but you can head to your dashboard now.'
                      : 'Bringing you to your dashboard now.'}
                </p>

                {/* Optional visual subtle loading bar indicator */}
                <div style={{ width: '100%', maxWidth: '240px', height: '4px', background: 'var(--surface)', borderRadius: '2px', overflow: 'hidden', marginTop: '16px' }}>
                    <div style={{ 
                        height: '100%', 
                        background: syncStatus === 'error' ? 'var(--amber, #f8b02b)' : 'var(--text-1)', 
                        width: `${progress}%`,
                        transition: 'width 0.3s ease-out'
                    }}></div>
                </div>

                {syncStatus === 'error' && (
                   <button 
                     onClick={() => onNavigate('dashboard')}
                     style={{
                        marginTop: '20px',
                        padding: '10px 24px',
                        background: 'var(--text-1)',
                        color: 'var(--bg)',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-ui)'
                     }}>
                     Go to Dashboard
                   </button>
                )}
              </div>
          </div>
      </div>
    </div>
  );
}
