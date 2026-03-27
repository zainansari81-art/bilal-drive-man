import { useState } from 'react';
import Head from 'next/head';
import { getSessionFromRequest } from '../lib/auth';

export async function getServerSideProps(context) {
  const session = getSessionFromRequest(context.req);
  if (session) {
    return { redirect: { destination: '/', permanent: false } };
  }
  return { props: {} };
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (res.ok) {
        window.location.href = '/';
      } else {
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - Bilal Drive Man</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%23c8e600'/><text x='50' y='68' text-anchor='middle' font-family='Arial' font-weight='900' font-size='55' fill='%231a1a2e'>B</text></svg>" />
      </Head>

      <div style={styles.wrapper}>
        <div style={styles.card}>
          <div style={styles.logoRow}>
            <div style={styles.logoCircle}>B</div>
            <div>
              <div style={styles.logoText}>Bilal - Drive Man</div>
              <div style={styles.logoSub}>by TXB</div>
            </div>
          </div>
          <p style={styles.subtitle}>Sign in to your account</p>

          <form onSubmit={handleSubmit} style={styles.form}>
            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.field}>
              <label style={styles.label}>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={styles.input}
                placeholder="Enter username"
                autoFocus
                required
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                placeholder="Enter password"
                required
              />
            </div>

            <button type="submit" style={styles.button} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    background: '#f4f5f7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  card: {
    background: '#fff',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
    border: '1px solid #e8eaed',
    boxShadow: '0 4px 24px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '6px',
  },
  logoCircle: {
    width: '42px',
    height: '42px',
    background: '#c8e600',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: '13px',
    color: '#1a1a2e',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: 800,
    color: '#1a1a2e',
  },
  logoSub: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#8c8ca1',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    marginTop: '1px',
  },
  subtitle: {
    fontSize: '14px',
    color: '#8c8ca1',
    marginBottom: '28px',
    marginTop: '4px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#4a4a6a',
  },
  input: {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
    fontSize: '14px',
    fontFamily: 'inherit',
    color: '#1a1a2e',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  button: {
    background: '#c8e600',
    color: '#1a1a2e',
    border: 'none',
    padding: '12px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: '4px',
    transition: 'background 0.15s',
  },
  error: {
    background: '#fee2e2',
    color: '#ef4444',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 500,
  },
};
