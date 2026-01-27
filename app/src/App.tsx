import { useState } from 'react'
import './App.css'
import { signInWithGoogle, signOutUser } from './utils/firebase'
import { GmailAuthTest } from './pages/GmailAuthTest'
import axios from 'axios'

// Backend API URL - update this to your backend URL
const API_URL = 'http://localhost:5000';

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /**
   * Handle Google Login
   * 1. Sign in with Firebase
   * 2. Send token to backend
   * 3. Store user data
   */
  const handleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      // Step 1: Sign in with Google via Firebase
      const result = await signInWithGoogle();

      if (!result.success) {
        setError(result.error || 'Login failed');
        setLoading(false);
        return;
      }

      console.log('Firebase login successful:', result.user);

      // Step 2: Send token to backend for verification and user creation
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        token: result.token
      });

      const data = response.data;

      if (!data.success) {
        setError(data.message || 'Backend authentication failed');
        setLoading(false);
        return;
      }

      console.log('Backend authentication successful:', data.user);

      // Step 3: Store token and user data
      if (result.token) {
        localStorage.setItem('firebaseToken', result.token);
      }
      setUser(data.user);

    } catch (err: any) {
      console.error('Login error:', err);
      setError(err?.response?.data?.message || err?.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle Logout
   * 1. Sign out from Firebase
   * 2. Clear local storage
   * 3. Clear user state
   */
  const handleLogout = async () => {
    setLoading(true);

    try {
      await signOutUser();
      setUser(null);
      console.log('Logged out successfully');
    } catch (err: any) {
      console.error('Logout error:', err);
      setError(err?.message || 'Logout failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      padding: '40px',
      maxWidth: '600px',
      margin: '0 auto',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h1>Firebase Auth Test</h1>

      {error && (
        <div style={{
          padding: '12px',
          background: '#fee',
          color: '#c33',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          {error}
        </div>
      )}

      {!user ? (
        <div>
          <p>Click the button below to test Firebase authentication:</p>
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: 500,
              background: 'white',
              color: '#3c4043',
              border: '1px solid #dadce0',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              boxShadow: '0 1px 2px 0 rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15)',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15)';
                e.currentTarget.style.backgroundColor = '#f8f9fa';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 1px 2px 0 rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15)';
              e.currentTarget.style.backgroundColor = 'white';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" />
              <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z" />
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" />
            </svg>
            {loading ? 'Loading...' : 'Sign in with Google'}
          </button>
        </div>
      ) : (
        <div>
          <h2>Logged In Successfully!</h2>
          <div style={{
            background: '#f0f0f0',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Name:</strong> {user.name || 'N/A'}</p>
            <p><strong>Firebase ID:</strong> {user.firebaseId}</p>
            <p><strong>Database ID:</strong> {user.id}</p>
            {user.avatar && (
              <img
                src={user.avatar}
                alt="Avatar"
                style={{ width: '60px', height: '60px', borderRadius: '50%' }}
              />
            )}
          </div>
          <button
            onClick={handleLogout}
            disabled={loading}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              background: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? 'Loading...' : 'Logout'}
          </button>

          {/* Gmail OAuth Testing Component */}
          <GmailAuthTest firebaseToken={localStorage.getItem('firebaseToken')} />
        </div>
      )}

      <div style={{
        marginTop: '40px',
        padding: '20px',
        background: '#f9f9f9',
        borderRadius: '8px',
        fontSize: '14px'
      }}>
        <h3>How it works:</h3>
        <ol style={{ textAlign: 'left' }}>
          <li>Click "Login with Google"</li>
          <li>Firebase authenticates you with Google</li>
          <li>Frontend sends Firebase token to backend</li>
          <li>Backend verifies token and creates/finds user in MongoDB</li>
          <li>User data is stored with firebaseId field</li>
          <li>Token is saved in localStorage for future requests</li>
        </ol>
      </div>
    </div>
  )
}

export default App
