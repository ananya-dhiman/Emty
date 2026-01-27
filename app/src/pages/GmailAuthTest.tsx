import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:5000';

interface GmailAccount {
    emailAddress: string;
    createdAt: string;
    updatedAt: string;
}

interface GmailAuthTestProps {
    firebaseToken: string | null;
}

/**
 * GmailAuthTest Component
 * 
 * Tests the Gmail OAuth flow:
 * 1. User clicks "Connect Gmail"
 * 2. Gets authorization URL from backend
 * 3. Redirects to Google login
 * 4. Google redirects back with code
 * 5. Backend exchanges code for tokens
 * 6. Backend saves credentials to MongoDB
 */
export function GmailAuthTest({ firebaseToken }: GmailAuthTestProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([]);
    const [fetchingAccounts, setFetchingAccounts] = useState(false);

    /**
     * Step 1: Initiate Gmail OAuth Flow
     * 
     * Flow:
     * 1. Send Firebase token to backend
     * 2. Backend creates state (security token) and saves to Redis
     * 3. Backend returns Google authorization URL
     * 4. Frontend redirects user to Google login
     */
    const handleConnectGmail = async () => {
        setLoading(true);
        setError('');
        setSuccess('');

        try {
            // Call backend to get authorization URL
            const response = await axios.post(
                `${API_URL}/api/auth/google/initiate`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${firebaseToken}`
                    }
                }
            );

            if (!response.data.success) {
                setError(response.data.message || 'Failed to initiate Gmail auth');
                setLoading(false);
                return;
            }

            console.log('Got authorization URL:', response.data.authorizationUrl);

            // Redirect user to Google login
            // Google will ask user for permissions
            window.location.href = response.data.authorizationUrl;

        } catch (err: any) {
            console.error('Error initiating Gmail auth:', err);
            setError(err?.response?.data?.message || err?.message || 'Failed to connect Gmail');
            setLoading(false);
        }
    };

    /**
     * Step 2: Check if user was redirected back from Google
     * 
     * After user grants permission, Google redirects to:
     * /auth/google/callback?code=...&state=...
     * 
     * Backend handles the callback and saves tokens to MongoDB
     */
    useEffect(() => {
        // Check URL for callback code
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');

        if (code && state) {
            console.log('✅ Received OAuth callback from Google');
            console.log('Code:', code);
            console.log('State:', state);
            
            // The backend already processed this in /auth/google/callback
            // Clean up URL to remove code and state
            window.history.replaceState({}, document.title, window.location.pathname);
            
            setSuccess('Gmail account connected successfully! ✅');
            
            // Refresh the list of Gmail accounts
            setTimeout(() => {
                fetchGmailAccounts();
            }, 1000);
        }
    }, []);

    /**
     * Fetch list of connected Gmail accounts for the user
     * 
     * This would require a new endpoint:
     * GET /api/auth/gmail/accounts
     * 
     * For now, this is a placeholder for future implementation
     */
    const fetchGmailAccounts = async () => {
        if (!firebaseToken) return;

        setFetchingAccounts(true);
        try {
            // TODO: Create this endpoint in backend
            // const response = await axios.get(
            //     `${API_URL}/api/auth/gmail/accounts`,
            //     {
            //         headers: {
            //             'Authorization': `Bearer ${firebaseToken}`
            //         }
            //     }
            // );
            // setGmailAccounts(response.data.accounts || []);
            console.log('Endpoint to fetch Gmail accounts coming soon...');
        } catch (err: any) {
            console.error('Error fetching Gmail accounts:', err);
        } finally {
            setFetchingAccounts(false);
        }
    };

    return (
        <div style={{
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #ddd',
            marginTop: '20px',
            background: '#f9f9f9'
        }}>
            <h2>📧 Gmail OAuth Flow Test</h2>
            
            {error && (
                <div style={{
                    padding: '12px',
                    background: '#fee',
                    color: '#c33',
                    borderRadius: '8px',
                    marginBottom: '20px',
                    border: '1px solid #fcc'
                }}>
                    ❌ {error}
                </div>
            )}

            {success && (
                <div style={{
                    padding: '12px',
                    background: '#efe',
                    color: '#3c3',
                    borderRadius: '8px',
                    marginBottom: '20px',
                    border: '1px solid #cfc'
                }}>
                    ✅ {success}
                </div>
            )}

            <div style={{
                padding: '15px',
                background: '#f0f4ff',
                borderRadius: '6px',
                marginBottom: '20px',
                fontSize: '14px',
                lineHeight: '1.6'
            }}>
                <h3 style={{ marginTop: 0 }}>How Gmail OAuth Flow Works:</h3>
                <ol style={{ textAlign: 'left', margin: 0 }}>
                    <li><strong>Click "Connect Gmail"</strong> - Initiates OAuth flow</li>
                    <li><strong>Backend generates state</strong> - Stores in Redis for security</li>
                    <li><strong>Redirected to Google</strong> - You log in and grant permissions</li>
                    <li><strong>Google redirects back</strong> - With authorization code</li>
                    <li><strong>Backend exchanges code</strong> - Gets access_token + refresh_token</li>
                    <li><strong>Tokens stored in MongoDB</strong> - Under your Gmail account</li>
                    <li><strong>Ready to use Gmail API!</strong> - Can read, send, etc.</li>
                </ol>
            </div>

            <button
                onClick={handleConnectGmail}
                disabled={loading}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '12px 20px',
                    fontSize: '16px',
                    fontWeight: 500,
                    background: '#EA4335',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                    if (!loading) {
                        e.currentTarget.style.background = '#d33425';
                        e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
                    }
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#EA4335';
                    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                }}
            >
                <svg width="20" height="20" viewBox="0 0 20 20" style={{ fill: 'white' }}>
                    <path d="M10 0c5.523 0 10 4.477 10 10s-4.477 10-10 10S0 15.523 0 10 4.477 0 10 0z" fill="white" opacity="0.1"/>
                    <text x="10" y="14" textAnchor="middle" fontSize="12" fill="white" fontWeight="bold">G</text>
                </svg>
                {loading ? 'Connecting...' : 'Connect Gmail Account'}
            </button>

            {gmailAccounts.length > 0 && (
                <div style={{
                    marginTop: '30px',
                    padding: '15px',
                    background: '#fff',
                    borderRadius: '6px',
                    border: '1px solid #ddd'
                }}>
                    <h3>Connected Gmail Accounts:</h3>
                    <ul style={{ margin: '10px 0', paddingLeft: '20px' }}>
                        {gmailAccounts.map((account, idx) => (
                            <li key={idx} style={{ marginBottom: '8px' }}>
                                <strong>{account.emailAddress}</strong>
                                <br />
                                <small style={{ color: '#666' }}>
                                    Connected: {new Date(account.createdAt).toLocaleDateString()}
                                </small>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div style={{
                marginTop: '20px',
                padding: '15px',
                background: '#fffacd',
                borderRadius: '6px',
                border: '1px solid #eee68c',
                fontSize: '14px'
            }}>
                <strong>💡 Tips:</strong>
                <ul style={{ margin: '10px 0 0 0', paddingLeft: '20px' }}>
                    <li>Your tokens are securely stored in MongoDB</li>
                    <li>You can connect multiple Gmail accounts</li>
                    <li>Tokens auto-refresh when expired</li>
                    <li>Check browser console for detailed logs</li>
                </ul>
            </div>
        </div>
    );
}
