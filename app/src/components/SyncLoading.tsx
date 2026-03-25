import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { auth } from '../utils/firebase';
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
  const [stageLabel, setStageLabel] = useState('Initializing sync');
  const [statusDetail, setStatusDetail] = useState('We are securely fetching and organizing your emails into your new priority stack.');
  const [typedDetail, setTypedDetail] = useState('');
  const API_URL = 'http://localhost:5000'; 
  
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitiated = useRef(false);
  const lastBackendMovementAt = useRef<number>(Date.now());
  const lastBackendPercent = useRef<number>(0);
  const syncStatusRef = useRef<'syncing' | 'completed' | 'error'>('syncing');
  const syncRequestDone = useRef(false);
  const completionHandled = useRef(false);

  const stageText: Record<string, string> = {
    initializing: 'Initializing sync',
    auth_setup: 'Authenticating access',
    fetch_candidates: 'Fetching candidate emails',
    metadata_filtering: 'Filtering metadata',
    processing_emails: 'Processing inbox content',
    finalizing: 'Finalizing',
    completed: 'Completed',
    error: 'Sync issue',
  };

  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  useEffect(() => {
    const sourceText =
      syncStatus === 'syncing'
        ? statusDetail
        : syncStatus === 'error'
          ? 'The background sync is still running, but you can head to your dashboard now.'
          : 'Bringing you to your dashboard now.';

    setTypedDetail('');
    let index = 0;
    const typingTimer = setInterval(() => {
      index += 1;
      setTypedDetail(sourceText.slice(0, index));
      if (index >= sourceText.length) clearInterval(typingTimer);
    }, 14);

    return () => clearInterval(typingTimer);
  }, [statusDetail, syncStatus]);

  useEffect(() => {
    const finalizeSuccess = () => {
      if (completionHandled.current) return;
      completionHandled.current = true;
      setProgress(100);
      setSyncStatus('completed');
      setStageLabel('Completed');
      setStatusDetail('Bringing you to your dashboard now.');
      completionTimer.current = setTimeout(() => {
        onNavigate('dashboard');
      }, 1000);
    };

    const applyProgressFromBackend = (data: any) => {
      const backendPercent = Math.max(0, Math.min(100, Number(data?.progressPercent ?? 0)));

      if (backendPercent > lastBackendPercent.current) {
        lastBackendPercent.current = backendPercent;
        lastBackendMovementAt.current = Date.now();
      }

      setProgress((prev) => Math.max(prev, backendPercent));
      setStageLabel(stageText[data?.progressStage] || 'Syncing inbox');
      setStatusDetail(
        data?.progressMessage?.trim() ||
          'We are securely fetching and organizing your emails into your new priority stack.'
      );

      if (backendPercent >= 100 || data?.progressStage === 'completed') {
        if (syncRequestDone.current) {
          finalizeSuccess();
        }
      }
      if (data?.syncState === 'error' || data?.progressStage === 'error') {
        setSyncStatus('error');
      }
    };

    const getAuthHeaders = async () => {
      let token = localStorage.getItem('firebaseToken');
      if (!token && auth.currentUser) {
        token = await auth.currentUser.getIdToken();
        if (token) localStorage.setItem('firebaseToken', token);
      }
      return token ? { Authorization: `Bearer ${token}` } : undefined;
    };

    const fetchProgress = async () => {
      if (!user?.gmailAccountId) return;
      try {
        const headers = await getAuthHeaders();
        const { data } = await axios.get(
          `${API_URL}/api/emails/sync-progress?accountId=${user.gmailAccountId}`,
          headers ? { headers } : undefined
        );
        if (data?.success) applyProgressFromBackend(data);
      } catch (err) {
        const status = (err as any)?.response?.status;
        if (status) {
          console.warn(`[SyncLoading] progress poll failed with status ${status}`);
        }
      }
    };

    // Poll backend progress every 1s so UI follows backend stages closely.
    pollInterval.current = setInterval(() => {
      void fetchProgress();
    }, 1000);

    // Fallback heartbeat: if backend progress is stale for 30s, nudge by +1 up to 95.
    fallbackInterval.current = setInterval(() => {
      if (syncStatusRef.current !== 'syncing') return;
      const isStale = Date.now() - lastBackendMovementAt.current >= 30000;
      if (!isStale) return;
      setProgress((prev) => Math.min(prev + 1, 95));
    }, 30000);

    // Start actual API Sync Call
    const initiateSync = async () => {
      try {
        if (!user || !user.gmailAccountId) {
            console.warn("No user or gmailAccountId found. Skipping sync call.");
            syncRequestDone.current = true;
            finalizeSuccess();
            return;
        } else {
            console.log("Initiating sync call to backend...");
            const headers = await getAuthHeaders();
            const response = await axios.post(`${API_URL}/api/emails/sync`, {
              accountId: user.gmailAccountId
            }, headers ? { headers } : undefined);
            console.log("Sync call completed successfully.", response.data);

            if (!response?.data?.success) {
              throw new Error(response?.data?.message || 'Sync failed');
            }
        }

        syncRequestDone.current = true;
        await fetchProgress();
        if (lastBackendPercent.current >= 100) {
          finalizeSuccess();
        } else {
          setStageLabel('Finalizing');
          setStatusDetail('Finalizing sync...');
        }

      } catch (err: any) {
        console.error("Initial Sync Failed or Timed Out:", err);
        setProgress((prev) => Math.max(prev, 1));
        setSyncStatus('error');
        setStageLabel('Sync issue');
        setStatusDetail('The background sync may still continue. You can go to your dashboard now.');
      }
    };

    if (!hasInitiated.current) {
      hasInitiated.current = true;
      void fetchProgress();
      void initiateSync();
    }

    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
      if (fallbackInterval.current) clearInterval(fallbackInterval.current);
      if (completionTimer.current) clearTimeout(completionTimer.current);
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

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 20px' }}>
          <div style={{
            width: '100%',
            maxWidth: '980px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '48px',
            flexWrap: 'wrap',
            border: '1px solid var(--border)',
            background: 'linear-gradient(145deg, var(--surface) 0%, var(--panel) 100%)',
            padding: '36px',
            boxShadow: '0 10px 24px rgba(0,0,0,0.08)'
          }}>
            <div style={{ flex: '1 1 320px', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '24px' }}>
              <span style={{
                width: 'fit-content',
                border: '1px solid var(--border-lt)',
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '4px 8px'
              }}>
                {stageLabel}
              </span>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-2)', lineHeight: 1.55 }}>
                <div style={{ marginBottom: '3px' }}>[{String(progress).padStart(3, '0')}%] {syncStatus === 'syncing' ? 'sync/live' : syncStatus === 'error' ? 'sync/error' : 'sync/done'}</div>
                <div style={{ color: 'var(--text-3)', minHeight: '34px' }}>
                  {typedDetail}
                  <span className="typing-cursor">|</span>
                </div>
              </div>

              <div style={{ width: '100%', maxWidth: '420px', height: '8px', background: 'var(--surface-2)', borderRadius: '999px', overflow: 'hidden', marginTop: '10px', border: '1px solid var(--border-lt)' }}>
                  <div style={{
                      height: '100%',
                      background: syncStatus === 'error' ? 'var(--amber, #f8b02b)' : 'var(--text-1)',
                      width: `${progress}%`,
                      transition: 'width 0.45s ease-out'
                  }}></div>
              </div>

              {syncStatus === 'error' && (
                 <button
                   onClick={() => onNavigate('dashboard')}
                   style={{
                      marginTop: '10px',
                      width: 'fit-content',
                      padding: '10px 22px',
                      background: 'var(--text-1)',
                      color: 'var(--bg)',
                      border: '1px solid var(--text-1)',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-ui)'
                   }}>
                   Go to Dashboard
                 </button>
              )}
            </div>

            <div style={{
              flex: '0 1 360px',
              minWidth: '240px',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'flex-start',
              color: syncStatus === 'error' ? 'var(--amber, #f8b02b)' : 'var(--text-1)',
              fontFamily: 'var(--font-ui)',
              lineHeight: 1
            }}>
              <span style={{
                fontSize: 'clamp(7rem, 14vw, 14rem)',
                fontWeight: 700,
                transition: 'all 0.35s ease-out'
              }}>
                {progress}
              </span>
              <span style={{ fontSize: 'clamp(2.6rem, 5vw, 5rem)', color: 'var(--text-3)', marginLeft: '10px' }}>%</span>
            </div>
          </div>
      </div>
    </div>
  );
}
