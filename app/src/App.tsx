import { useState, useEffect } from 'react'
import './App.css'
import { signInWithGoogle, signOutUser, auth } from './utils/firebase'
import { onIdTokenChanged } from 'firebase/auth'
import axios from 'axios'
import { ConnectGmail } from './components/ConnectGmail'
import { Dashboard } from './components/Dashboard'
import { Profile } from './components/Profile'
import { Onboarding } from './components/Onboarding'
import { SyncLoading } from './components/SyncLoading'
import  LandingPage  from './components/LandingPage'

// Backend API URL - update this to your backend URL
const API_URL = 'http://localhost:5000';

// Global Axios Interceptor to automatically append the freshest Firebase token
axios.interceptors.request.use(async (config) => {
  if (auth.currentUser) {
    try {
      const freshToken = await auth.currentUser.getIdToken(false);
      config.headers.Authorization = `Bearer ${freshToken}`;
      localStorage.setItem('firebaseToken', freshToken);
    } catch (e) {
      console.error('Failed to get fresh Firebase token:', e);
    }
  } else {
    // Fallback if SDK hasn't loaded but a token exists
    const local = localStorage.getItem('firebaseToken');
    if (local && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${local}`;
    }
  }
  return config;
}, (err) => Promise.reject(err));

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [route, setRoute] = useState<'dashboard' | 'profile' | 'onboarding' | 'syncing'>('dashboard');
  const [loggedOutView, setLoggedOutView] = useState<'landing' | 'signin'>('landing');
  
  // NEW: track if user has connected gmail in frontend flow
  const [isGmailConnected, setIsGmailConnected] = useState(false);

  // Check session and URL params on mount
  useEffect(() => {
    // 1. Check URL parameters for OAuth redirect status
    const params = new URLSearchParams(window.location.search);
    const gmailSuccess = params.get('gmail_success');
    const gmailError = params.get('gmail_error');

    if (gmailSuccess === 'true') {
      setIsGmailConnected(true);
      setRoute('onboarding');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (gmailError) {
      if (gmailError === 'true') {
         setError('Failed to securely connect Gmail account. Please try again.');
      } else {
         setError(`Gmail connection error: ${gmailError.replace('_', ' ')}`);
      }
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Check for existing session token and auto-refresh using Firebase listener
    let hasLoadedInitialSession = false;
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          if (!hasLoadedInitialSession) setLoading(true);
          const token = await firebaseUser.getIdToken();
          localStorage.setItem('firebaseToken', token);
          
          if (!user) {
            const response = await axios.get(`${API_URL}/api/auth/verify`);
            if (response.data.success) {
              setUser(response.data.user);
              if (response.data.user.isGmailConnected) {
                setIsGmailConnected(true);
              }
            } else {
               localStorage.removeItem('firebaseToken');
               setUser(null);
            }
          }
        } catch (err) {
           console.error('Session check failed', err);
           // Fallback cleanup if backend verify totally fails
           localStorage.removeItem('firebaseToken');
           setUser(null);
        } finally {
          hasLoadedInitialSession = true;
          setLoading(false);
        }
      } else {
         localStorage.removeItem('firebaseToken');
         setUser(null);
         if (!hasLoadedInitialSession) setLoading(false);
         hasLoadedInitialSession = true;
      }
    });
    
    return () => unsubscribe();
  }, [user]); // Run on mount and react if `user` is modified

  // Apply theme class to document
  useEffect(() => {
    document.documentElement.setAttribute('data-mode', theme);
  }, [theme]);

  /**
   * Handle Google Login
   */
  const handleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await signInWithGoogle();

      if (!result.success) {
        setError(result.error || 'Login failed');
        setLoading(false);
        return;
      }
      
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        token: result.token
      });

      const data = response.data;

      if (!data.success) {
        setError(data.message || 'Backend authentication failed');
        setLoading(false);
        return;
      }

      if (result.token) {
        localStorage.setItem('firebaseToken', result.token);
      }
      setUser(data.user);
      if (data.user.isGmailConnected) {
        setIsGmailConnected(true);
      }

    } catch (err: any) {
      console.error('Login error:', err);
      setError(err?.response?.data?.message || err?.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Connect Gmail OAuth Flow
   */
  const handleConnectGmail = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('firebaseToken');
      if (!token) {
        throw new Error('No authentication token found. Please log in again.');
      }

      const response = await axios.post(`${API_URL}/api/auth/google/initiate`, {}, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = response.data;
      if (data.success && data.authorizationUrl) {
        // Redirect to Google Consent screen
        window.location.href = data.authorizationUrl;
      } else {
        throw new Error(data.message || 'Failed to initiate Gmail connection');
      }
    } catch (err: any) {
        console.error('Connect Gmail error:', err);
        setError(err?.response?.data?.message || err?.message || 'An error occurred initiating Gmail connection');
        setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    setError(null);
    try {
      await signOutUser();
    } catch (err: any) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('firebaseToken');
      setUser(null);
      setIsGmailConnected(false);
      setRoute('dashboard');
      setLoggedOutView('landing');
      setLoading(false);
    }
  };

  if (user && isGmailConnected) {
    if (route === 'profile') {
      return <Profile user={user} theme={theme} setTheme={setTheme} onNavigate={setRoute as any} onLogout={handleLogout} />;
    }
    if (route === 'syncing') {
      return <SyncLoading user={user} theme={theme} setTheme={setTheme} onNavigate={setRoute as any} />;
    }
    if (route === 'onboarding') {
      return <Onboarding user={user} theme={theme} setTheme={setTheme} onNavigate={setRoute as any} />;
    }
    return <Dashboard user={user} theme={theme} setTheme={setTheme} onNavigate={setRoute as any} />;
  }

  if (user && !isGmailConnected) {
    return (
      <>
         {/* Theme Controls for Connect screen */}
         <div className="controls" style={{ position: 'absolute', top: 20, right: 20 }}>
          <span className="ctrl-label">Theme</span>
          <div className="btn-group">
            <button 
              className={`tgl-btn ${theme === 'light' ? 'on' : ''}`} 
              onClick={() => setTheme('light')}
            >Light</button>
            <button 
              className={`tgl-btn ${theme === 'dark' ? 'on' : ''}`} 
              onClick={() => setTheme('dark')}
            >Dark</button>
          </div>
        </div>
        <ConnectGmail onConnect={handleConnectGmail} loading={loading} />
      </>
    );
  }

  if (loggedOutView === 'landing') {
    return (
      <LandingPage
        theme={theme}
        setTheme={setTheme}
        onSignInClick={() => {
          setError(null);
          setLoggedOutView('signin');
        }}
      />
    );
  }

  return (
    <div className="auth-container">
      {/* Theme Controls */}
      <div className="controls" style={{ position: 'absolute', top: 20, right: 20 }}>
        <span className="ctrl-label">Theme</span>
        <div className="btn-group">
          <button
            className={`tgl-btn ${theme === 'light' ? 'on' : ''}`}
            onClick={() => setTheme('light')}
          >
            Light
          </button>
          <button
            className={`tgl-btn ${theme === 'dark' ? 'on' : ''}`}
            onClick={() => setTheme('dark')}
          >
            Dark
          </button>
        </div>
      </div>

      <div className="shell auth-shell">
        <div className="bar auth-bar">
          <div className="bar-logo">
            <div className="logo-block">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <rect x="1" y="1" width="9" height="1.8" fill="var(--accent-inv)" />
                <rect x="1" y="4.6" width="9" height="1.8" fill="var(--accent-inv)" />
                <rect x="1" y="8.2" width="5.5" height="1.8" fill="var(--accent-inv)" />
              </svg>
            </div>
            Emty
          </div>
        </div>

        <div className="auth-content">
          <div className="auth-form">
            <h1 className="auth-title">Welcome to Emty</h1>
            <p className="auth-subtitle">Sign in to continue to your workspace.</p>

            {error && (
              <div className="error-banner">
                {error}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="btn-primary auth-btn"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: '10px' }}>
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
                <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" />
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" />
              </svg>
              {loading ? 'Authenticating...' : 'Sign in with Google'}
            </button>
            <button
              type="button"
              className="btn-secondary auth-btn"
              onClick={() => {
                setError(null);
                setLoggedOutView('landing');
              }}
            >
              Back to landing
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
