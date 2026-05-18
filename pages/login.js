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
  const [showPassword, setShowPassword] = useState(false);
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
        <title>Login — Bilal Drive Man</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* Font links live in pages/_document.js — adding a stylesheet via
            next/head triggers Next's body{display:none} FOUC guard. */}
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='5' y='15' width='90' height='70' rx='10' fill='%2318181B'/><rect x='12' y='22' width='76' height='40' rx='5' fill='%2384CC16'/></svg>" />
      </Head>

      <div style={{
        minHeight: '100vh',
        background: 'var(--bg, #F8F8F7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}>
        <div style={{
          background: 'var(--panel, #fff)',
          borderRadius: 12,
          padding: '40px',
          width: '100%',
          maxWidth: '380px',
          border: '1px solid var(--rule, #E5E4E1)',
          boxShadow: '0 1px 3px rgba(24,24,27,0.05), 0 1px 2px rgba(24,24,27,0.03)',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--ink, #18181B)',
              display: 'grid', placeItems: 'center',
              fontWeight: 700, fontSize: 16, color: '#fff', letterSpacing: '-0.01em',
            }}>B</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink, #18181B)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                Bilal Drive Man
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-mute, #71717A)' }}>TXB Studios</div>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--ink-mute, #71717A)', marginBottom: 24 }}>
            Sign in to your account
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{
                background: 'var(--alert-bg, #FEF2F2)',
                color: 'var(--alert-fg, #991B1B)',
                padding: '10px 14px',
                borderRadius: 6,
                fontSize: 13,
                border: '1px solid var(--alert, #DC2626)',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2, #3F3F46)' }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                autoFocus
                required
                style={{
                  padding: '9px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--rule, #E5E4E1)',
                  fontSize: 13.5,
                  fontFamily: 'inherit',
                  color: 'var(--ink, #18181B)',
                  outline: 'none',
                  background: 'var(--panel, #fff)',
                  transition: 'border-color 0.12s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--ink, #18181B)'; e.target.style.boxShadow = '0 0 0 3px rgba(24,24,27,0.05)'; }}
                onBlur={e => { e.target.style.borderColor = 'var(--rule, #E5E4E1)'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2, #3F3F46)' }}>
                Password
              </label>
              <div style={{ position: 'relative', display: 'flex' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  style={{
                    flex: 1,
                    padding: '9px 56px 9px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--rule, #E5E4E1)',
                    fontSize: 13.5,
                    fontFamily: 'inherit',
                    color: 'var(--ink, #18181B)',
                    outline: 'none',
                    background: 'var(--panel, #fff)',
                    transition: 'border-color 0.12s',
                  }}
                  onFocus={e => { e.target.style.borderColor = 'var(--ink, #18181B)'; e.target.style.boxShadow = '0 0 0 3px rgba(24,24,27,0.05)'; }}
                  onBlur={e => { e.target.style.borderColor = 'var(--rule, #E5E4E1)'; e.target.style.boxShadow = 'none'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  tabIndex={-1}
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    padding: '4px 8px',
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: 'var(--ink-mute, #71717A)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                background: 'var(--ink, #18181B)',
                color: '#fff',
                border: 'none',
                padding: '10px',
                borderRadius: 6,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                marginTop: 4,
                transition: 'background 0.12s',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
